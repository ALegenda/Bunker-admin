import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { pool, transaction } from '../db/index.js';
import { cardSchema, type Card } from '../domain/schema.js';
import { rowCard, upsertCards } from './workspace.js';
import { refreshCatalog } from './catalog.js';
import { storeImage } from './storage.js';
import { audit } from './audit.js';

const sourceDirectory = 'resources/rules-2026-05-24';
const entrySchema = cardSchema
  .pick({ id: true, name: true, cardType: true, description: true, attributes: true, source: true })
  .extend({
    imageFile: z
      .string()
      .regex(/^images\/[a-z0-9-]+\.png$/)
      .optional(),
    new: z.boolean(),
  });
export const sourceManifestSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceSha256: z.string().length(64),
  entries: z.array(entrySchema),
  retired: z.array(
    z.object({ id: z.string(), name: z.string(), cardType: cardSchema.shape.cardType }),
  ),
});
export type SourceManifest = z.infer<typeof sourceManifestSchema>;

// The transaction retains full pre-migration data and audit history before retiring source cards.
// Custom cards and their unpublished state are kept separately from the authoritative baseline.
export async function applySourceManifest(
  manifest: SourceManifest,
  manifestSha: string,
  images: Map<string, string>,
) {
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(473911)');
    const workspace = (await c.query('SELECT * FROM workspace WHERE id=1 FOR UPDATE')).rows[0];
    if (!workspace) throw Error('Initialize workspace before source migration');
    const applied = (await c.query('SELECT * FROM source_migrations WHERE id=$1', [manifest.id]))
      .rows[0];
    if (applied) {
      if (
        applied.manifest_sha256 !== manifestSha ||
        applied.source_sha256 !== manifest.sourceSha256
      )
        throw Error('Applied source migration checksum mismatch');
      return { applied: false, report: applied.report };
    }
    const rows = (await c.query('SELECT * FROM cards ORDER BY position FOR UPDATE')).rows;
    const oldCards: Card[] = rows.map(rowCard);
    const old = new Map(oldCards.map((card) => [card.id, card]));
    const ids = new Set(manifest.entries.map((e) => e.id));
    const retiredIds = new Set(manifest.retired.map((e) => e.id));
    if (ids.size !== manifest.entries.length || [...retiredIds].some((id) => ids.has(id)))
      throw Error('Invalid source mapping');
    const backupId = randomUUID();
    const published = (await c.query('SELECT * FROM public_cards ORDER BY position')).rows;
    await c.query('INSERT INTO import_backups(id,payload) VALUES($1,$2)', [
      backupId,
      JSON.stringify({ migration: manifest.id, workspace, cards: rows, publicCards: published }),
    ]);
    const canonical = manifest.entries.map((entry) => {
      const before = old.get(entry.id);
      if (before && before.cardType !== entry.cardType)
        throw Error('Card type mismatch: ' + entry.id);
      const image = before?.image || images.get(entry.id) || '';
      if (entry.new && !image) throw Error('Missing image for new card: ' + entry.name);
      return cardSchema.parse({
        ...before,
        ...entry,
        image,
        kind: before?.kind || 'Уточнение',
        note: before?.note || '',
      });
    });
    const custom = oldCards.filter((card) => !ids.has(card.id) && !retiredIds.has(card.id));
    for (const card of canonical)
      await audit(c, null, 'source.migrate', card.id, old.get(card.id) || null, card);
    for (const entry of manifest.retired) {
      const before = old.get(entry.id);
      if (before) {
        if (before.cardType !== entry.cardType)
          throw Error('Retired card type mismatch: ' + entry.id);
        await audit(c, null, 'source.archive', entry.id, before, null);
      }
    }
    await c.query('DELETE FROM cards WHERE id=ANY($1::text[])', [[...retiredIds]]);
    await upsertCards(c, canonical);
    // Place preserved custom entries after the source set without changing their versions or text.
    for (let i = 0; i < custom.length; i++)
      await c.query('UPDATE cards SET position=$2 WHERE id=$1', [
        custom[i].id,
        canonical.length + i,
      ]);
    const oldBaseline: Card[] = workspace.baseline;
    const baseline = [
      ...canonical,
      ...oldBaseline.filter((card) => !ids.has(card.id) && !retiredIds.has(card.id)),
    ];
    await refreshCatalog(c, baseline);
    await c.query(
      "UPDATE workspace SET baseline=$1,revision=revision+1,changelog_stamp='',updated_at=now() WHERE id=1",
      [JSON.stringify(baseline)],
    );
    const report = {
      title: manifest.title,
      sourceCards: canonical.length,
      updated: canonical.filter(
        (card) => old.has(card.id) && !isDeepStrictEqual(old.get(card.id), card),
      ).length,
      added: canonical.filter((card) => !old.has(card.id)).length,
      archived: manifest.retired.filter((e) => old.has(e.id)).map((e) => e.name),
      preservedCustom: custom.length,
      backupId,
    };
    await c.query(
      'INSERT INTO source_migrations(id,source_sha256,manifest_sha256,backup_id,report) VALUES($1,$2,$3,$4,$5)',
      [manifest.id, manifest.sourceSha256, manifestSha, backupId, JSON.stringify(report)],
    );
    await audit(c, null, 'source.migration', manifest.id, { revision: workspace.revision }, report);
    return { applied: true, report };
  });
}

export async function migrateSourceRules() {
  const bytes = await readFile(path.join(sourceDirectory, 'manifest.json'));
  const manifest = sourceManifestSchema.parse(JSON.parse(bytes.toString()));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const prior = (
    await pool.query('SELECT manifest_sha256 FROM source_migrations WHERE id=$1', [manifest.id])
  ).rows[0];
  if (prior) {
    if (prior.manifest_sha256 !== sha) throw Error('Applied source migration checksum mismatch');
    console.log('Source rules already current');
    return;
  }
  const images = new Map<string, string>();
  for (const entry of manifest.entries) {
    if (entry.imageFile)
      images.set(
        entry.id,
        await storeImage(await readFile(path.join(sourceDirectory, entry.imageFile))),
      );
  }
  const result = await applySourceManifest(manifest, sha, images);
  console.log(JSON.stringify(result));
  return result;
}

export async function correctSourceAttributes() {
  const bytes = await readFile(path.join(sourceDirectory, 'attribute-corrections.json'));
  const plan = z
    .object({
      id: z.string(),
      sourceSha256: z.string().length(64),
      entries: z.array(
        z.object({
          id: z.string(),
          before: cardSchema.shape.attributes,
          after: cardSchema.shape.attributes,
        }),
      ),
    })
    .parse(JSON.parse(bytes.toString()));
  const sha = createHash('sha256').update(bytes).digest('hex');
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(473911)');
    const workspace = (await c.query('SELECT * FROM workspace WHERE id=1 FOR UPDATE')).rows[0];
    const prior = (
      await c.query('SELECT manifest_sha256 FROM source_migrations WHERE id=$1', [plan.id])
    ).rows[0];
    if (prior) {
      if (prior.manifest_sha256 !== sha)
        throw Error('Applied attribute correction checksum mismatch');
      return { applied: false };
    }
    if (!workspace) throw Error('Initialize source rules before attribute corrections');
    const rows = (await c.query('SELECT * FROM cards ORDER BY position FOR UPDATE')).rows;
    const published = (await c.query('SELECT * FROM public_cards ORDER BY position')).rows;
    const backupId = randomUUID();
    await c.query('INSERT INTO import_backups(id,payload) VALUES($1,$2)', [
      backupId,
      JSON.stringify({ migration: plan.id, workspace, cards: rows, publicCards: published }),
    ]);
    const corrected: string[] = [],
      skipped: string[] = [];
    for (const entry of plan.entries) {
      const row = rows.find((r) => r.id === entry.id);
      if (!row) continue;
      const before = rowCard(row);
      if (!isDeepStrictEqual(before.attributes, entry.before)) {
        skipped.push(entry.id);
        continue;
      }
      const a = entry.after;
      await c.query(
        'UPDATE cards SET activation_time=$2,usage_frequency=$3,usage_location=$4,tags=$5,version=version+1,updated_at=now() WHERE id=$1',
        [entry.id, a.activationTime, a.usageFrequency, a.usageLocation, a.tags],
      );
      await audit(c, null, 'source.attributes', entry.id, before, { ...before, attributes: a });
      corrected.push(entry.id);
    }
    const fix = (card: Card): Card => {
      const entry = plan.entries.find((e) => e.id === card.id);
      return entry && isDeepStrictEqual(card.attributes, entry.before)
        ? { ...card, attributes: entry.after }
        : card;
    };
    await c.query(
      "UPDATE workspace SET baseline=$1,revision=revision+1,changelog_stamp='',updated_at=now() WHERE id=1",
      [JSON.stringify(workspace.baseline.map(fix))],
    );
    for (const row of published) {
      const after = fix(row.data);
      if (after !== row.data)
        await c.query('UPDATE public_cards SET data=$2 WHERE id=$1', [
          row.id,
          JSON.stringify(after),
        ]);
    }
    const report = { title: 'Правила от 24.05.2026', corrected, skipped, backupId };
    await c.query(
      'INSERT INTO source_migrations(id,source_sha256,manifest_sha256,backup_id,report) VALUES($1,$2,$3,$4,$5)',
      [plan.id, plan.sourceSha256, sha, backupId, JSON.stringify(report)],
    );
    console.log(JSON.stringify({ applied: true, migration: plan.id, report }));
    return { applied: true, report };
  });
}
