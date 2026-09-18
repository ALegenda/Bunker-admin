import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { Card, PublicCard } from '../../shared/contracts.js';
import { normalizeAttributes } from '../../shared/card-classification.js';
import { cardSchema } from '../domain/schema.js';
import { tagDescriptionHash } from '../domain/card-tags.js';
import { transaction } from '../db/index.js';
import { rowCard } from './workspace.js';
import { audit } from './audit.js';

const migrationId = 'card-classification-2026-09-18-v3';
// This migration is additive to the immutable source plans already applied in production.
const checksum = createHash('sha256').update(migrationId).digest('hex');
type SourceCard = Pick<PublicCard, 'id' | 'name' | 'cardType' | 'description' | 'attributes'>;
export function classifyCard<T extends PublicCard>(
  card: T,
  sources: SourceCard[],
  correctLocations = true,
) {
  const attributes = normalizeAttributes(card.attributes);
  let skipped: string | undefined;
  if (correctLocations && ['20', '94'].includes(card.id)) {
    const source = sources.find((entry) => entry.id === card.id);
    if (
      source &&
      card.name === source.name &&
      card.cardType === source.cardType &&
      tagDescriptionHash(card.description) === tagDescriptionHash(source.description) &&
      isDeepStrictEqual(
        attributes.usageLocation,
        normalizeAttributes(source.attributes).usageLocation,
      )
    ) {
      attributes.usageLocation = ['внутри бункера', 'снаружи'];
    } else if (!attributes.usageLocation.includes('снаружи')) {
      skipped = 'Место: карта изменена относительно источника, проверьте применение снаружи';
    }
  }
  // Do not truncate user data if moving a status would exceed a field limit.
  const validation = cardSchema.safeParse({ ...card, attributes });
  if (!validation.success)
    return {
      card,
      skipped: 'Нормализация превышает ограничения карточки; требуется ручная проверка',
    };
  return {
    card: isDeepStrictEqual(card.attributes, attributes) ? card : { ...card, attributes },
    skipped,
  };
}

export async function normalizeCardClassification() {
  const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8')) as {
    sourceSha256: string;
    entries: SourceCard[];
  };
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(473911)');
    const prior = (await c.query('SELECT * FROM source_migrations WHERE id=$1', [migrationId]))
      .rows[0];
    if (prior) {
      if (prior.manifest_sha256 !== checksum || prior.source_sha256 !== source.sourceSha256)
        throw Error('Classification migration checksum mismatch');
      return { applied: false, report: prior.report };
    }
    const workspace = (await c.query('SELECT * FROM workspace WHERE id=1 FOR UPDATE')).rows[0];
    if (!workspace) throw Error('Initialize source rules before classification migration');
    const rows = (await c.query('SELECT * FROM cards ORDER BY position FOR UPDATE')).rows;
    const published = (await c.query('SELECT * FROM public_cards ORDER BY position FOR UPDATE'))
      .rows;
    const backupId = randomUUID();
    await c.query('INSERT INTO import_backups(id,payload) VALUES($1,$2)', [
      backupId,
      JSON.stringify({ migration: migrationId, workspace, cards: rows, publicCards: published }),
    ]);
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
    const correctLocations = !(
      await c.query(
        "SELECT 1 FROM source_migrations WHERE id IN ('card-classification-2026-09-18-v1','card-classification-2026-09-18-v2') LIMIT 1",
      )
    ).rowCount;
    const fix = <T extends PublicCard>(card: T, layer: keyof typeof report.updated): T => {
      const result = classifyCard(card, source.entries, correctLocations);
      if (result.skipped) report.skipped.push({ layer, id: card.id, reason: result.skipped });
      if (result.card !== card) report.updated[layer].push(card.id);
      return result.card;
    };
    for (const row of rows) {
      const before = rowCard(row);
      const after = fix(before, 'draft');
      if (after === before) continue;
      const a = after.attributes;
      await c.query(
        'UPDATE cards SET activation_time=$2,usage_frequency=$3,usage_location=$4,tags=$5,effects=$6,dangerous_personality=$7,usage_condition=$8,card_color=$9,version=version+1,updated_at=now() WHERE id=$1',
        [
          row.id,
          a.activationTime,
          a.usageFrequency,
          a.usageLocation,
          a.tags,
          a.effects || [],
          a.dangerousPersonality || false,
          a.usageCondition || '',
          a.cardColor || '',
        ],
      );
      await audit(c, null, 'source.classification', row.id, before, after);
    }
    const baseline = (workspace.baseline as Card[]).map((card) => fix(card, 'baseline'));
    for (const row of published) {
      const after = fix(row.data as PublicCard, 'published');
      if (after === row.data) continue;
      await c.query('UPDATE public_cards SET data=$2 WHERE id=$1', [row.id, JSON.stringify(after)]);
      await audit(c, null, 'source.classification.public', row.id, row.data, after);
    }
    if (Object.values(report.updated).some((ids) => ids.length)) {
      await c.query(
        "UPDATE workspace SET baseline=$1,revision=revision+1,changelog_stamp='',updated_at=now() WHERE id=1",
        [JSON.stringify(baseline)],
      );
    }
    await c.query(
      'INSERT INTO source_migrations(id,source_sha256,manifest_sha256,backup_id,report) VALUES($1,$2,$3,$4,$5)',
      [migrationId, source.sourceSha256, checksum, backupId, JSON.stringify(report)],
    );
    await audit(
      c,
      null,
      'source.classification.migration',
      migrationId,
      { revision: workspace.revision },
      report,
    );
    return { applied: true, report };
  });
}
