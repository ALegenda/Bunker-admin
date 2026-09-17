import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { Card, PublicCard } from '../../shared/contracts.js';
import { transaction } from '../db/index.js';
import {
  metadataPlanSchema,
  enrichCardMetadata,
  type MetadataPlan,
} from '../domain/card-metadata.js';
import { rowCard } from './workspace.js';
import { audit } from './audit.js';

export async function applyMetadataPlan(input: MetadataPlan, checksum: string) {
  const plan = metadataPlanSchema.parse(input);
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(473911)');
    const prior = (await c.query('SELECT * FROM source_migrations WHERE id=$1', [plan.id])).rows[0];
    if (prior) {
      if (prior.manifest_sha256 !== checksum || prior.source_sha256 !== plan.sourceSha256)
        throw Error('Applied metadata migration checksum mismatch');
      return { applied: false, report: prior.report };
    }
    const workspace = (await c.query('SELECT * FROM workspace WHERE id=1 FOR UPDATE')).rows[0];
    if (!workspace) throw Error('Initialize source rules before metadata migration');
    const rows = (await c.query('SELECT * FROM cards ORDER BY position FOR UPDATE')).rows;
    const published = (await c.query('SELECT * FROM public_cards ORDER BY position FOR UPDATE'))
      .rows;
    const backupId = randomUUID();
    await c.query('INSERT INTO import_backups(id,payload) VALUES($1,$2)', [
      backupId,
      JSON.stringify({ migration: plan.id, workspace, cards: rows, publicCards: published }),
    ]);
    // Metadata updates retain the current catalog edition, including a newer user release.
    const edition =
      (
        await c.query(`SELECT title FROM (
      SELECT title,created_at AS published_at FROM releases
      UNION ALL SELECT report->>'title',applied_at FROM source_migrations
    ) editions ORDER BY published_at DESC LIMIT 1`)
      ).rows[0]?.title || 'Исходная редакция';
    const report = {
      title: edition,
      backupId,
      updated: { draft: [] as string[], baseline: [] as string[], published: [] as string[] },
      skipped: [] as { layer: string; id: string; reason: string }[],
    };
    const assets = new Map(
      (await c.query('SELECT id,sha256 FROM assets')).rows.map((r) => [
        '/api/assets/' + r.id,
        r.sha256 as string,
      ]),
    );
    const entries = new Map(plan.entries.map((entry) => [entry.id, entry]));
    const fix = <T extends PublicCard>(card: T, layer: keyof typeof report.updated): T => {
      const entry = entries.get(card.id);
      if (!entry) return card;
      const result = enrichCardMetadata(card, entry, assets.get(card.image));
      for (const reason of result.skipped) report.skipped.push({ layer, id: card.id, reason });
      if (result.card !== card) report.updated[layer].push(card.id);
      return result.card;
    };
    for (const row of rows) {
      const before = rowCard(row);
      const after = fix(before, 'draft');
      if (after === before) continue;
      await c.query(
        'UPDATE cards SET tags=$2,card_color=$3,effects=$4,version=version+1,updated_at=now() WHERE id=$1',
        [
          row.id,
          after.attributes.tags,
          after.attributes.cardColor || '',
          after.attributes.effects || [],
        ],
      );
      await audit(c, null, 'source.metadata', row.id, before, after);
    }
    const baseline = (workspace.baseline as Card[]).map((card) => fix(card, 'baseline'));
    for (const row of published) {
      const after = fix(row.data as PublicCard, 'published');
      if (after === row.data) continue;
      await c.query('UPDATE public_cards SET data=$2 WHERE id=$1', [row.id, JSON.stringify(after)]);
      await audit(c, null, 'source.metadata.public', row.id, row.data, after);
    }
    if (Object.values(report.updated).some((ids) => ids.length)) {
      await c.query(
        "UPDATE workspace SET baseline=$1,revision=revision+1,changelog_stamp='',updated_at=now() WHERE id=1",
        [JSON.stringify(baseline)],
      );
    }
    await c.query(
      'INSERT INTO source_migrations(id,source_sha256,manifest_sha256,backup_id,report) VALUES($1,$2,$3,$4,$5)',
      [plan.id, plan.sourceSha256, checksum, backupId, JSON.stringify(report)],
    );
    await audit(
      c,
      null,
      'source.metadata.migration',
      plan.id,
      { revision: workspace.revision },
      report,
    );
    return { applied: true, report };
  });
}

export async function enrichSourceMetadata() {
  const bytes = await readFile('resources/rules-2026-05-24/metadata-enrichment.json');
  const plan = metadataPlanSchema.parse(JSON.parse(bytes.toString()));
  const result = await applyMetadataPlan(plan, createHash('sha256').update(bytes).digest('hex'));
  console.log(JSON.stringify({ migration: plan.id, ...result }));
  return result;
}
