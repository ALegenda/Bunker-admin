import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { cardSchema } from '../../shared/schema.js';
import { metadataPlanSchema } from '../domain/card-metadata.js';

test('metadata migration preserves edits and history, rolls back, and persists through card saves', async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'metadata_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { writeCard, resetCard } = await import('../services/cards.js');
  const { refreshCatalog, catalog } = await import('../services/catalog.js');
  const { applyMetadataPlan } = await import('../services/metadata-migration.js');
  try {
    await migrate();
    const bytes = await readFile('resources/rules-2026-05-24/metadata-enrichment.json');
    const plan = metadataPlanSchema.parse(JSON.parse(bytes.toString()));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
    const cards = source.entries.map((e: any) => cardSchema.parse({ ...e, image: '' }));
    await transaction(async (c) => {
      for (const entry of plan.entries) {
        if (!entry.imageSha256) continue;
        const asset = randomUUID();
        const stored = await c.query(
          "INSERT INTO assets(id,object_key,sha256,mime,bytes) VALUES($1,$2,$3,'image/webp',1) ON CONFLICT(sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id",
          [asset, asset, entry.imageSha256],
        );
        cards.find((v: any) => v.id === entry.id)!.image = '/api/assets/' + stored.rows[0].id;
      }
    });
    const baseline = structuredClone(cards);
    baseline.find((c: any) => c.id === '0')!.attributes.cardColor = 'красный';
    const edited = cards.find((c: any) => c.id === '120')!;
    edited.description = 'Неопубликованная правка';
    edited.note = 'Не потерять';
    const wrongImage = cards.find((c: any) => c.id === '198')!;
    wrongImage.image = cards.find((c: any) => c.id === '0')!.image;
    const custom = cardSchema.parse({
      id: 'custom',
      name: 'Моя карточка',
      description: 'Своя механика',
      cardType: 'умение',
      attributes: { effects: ['Мой эффект'] },
    });
    cards.push(custom);
    baseline.push(custom);
    await transaction(async (c) => {
      await upsertCards(c, cards);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [JSON.stringify(baseline)]);
      await refreshCatalog(c, baseline);
    });
    const before = await readWorkspace();
    await pool.query(`CREATE FUNCTION reject_metadata() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
   CREATE TRIGGER reject_metadata BEFORE UPDATE ON public_cards FOR EACH ROW EXECUTE FUNCTION reject_metadata()`);
    await assert.rejects(applyMetadataPlan(plan, hash), /test rollback/);
    assert.deepEqual(await readWorkspace(), before);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM source_migrations')).rows[0].n,
      0,
    );
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n, 0);
    await pool.query('DROP TRIGGER reject_metadata ON public_cards');
    const results = await Promise.all([
      applyMetadataPlan(plan, hash),
      applyMetadataPlan(plan, hash),
    ]);
    assert.equal(results.filter((r) => r.applied).length, 1);
    const after = await readWorkspace(),
      pub = await catalog();
    assert.equal(after.cards.find((c) => c.id === '120')!.description, edited.description);
    assert.equal(after.cards.find((c) => c.id === '120')!.note, edited.note);
    assert.equal(after.cards.find((c) => c.id === '120')!.attributes.effects, undefined);
    assert.ok(after.cards.find((c) => c.id === '120')!.attributes.cardColor);
    assert.equal(after.cards.find((c) => c.id === '198')!.attributes.cardColor, undefined);
    assert.ok(pub.cards.find((c) => c.id === '120')!.attributes.effects.includes('Паралич'));
    assert.equal(pub.cards.find((c) => c.id === '0')!.attributes.cardColor, 'красный');
    assert.deepEqual(
      after.cards.find((c) => c.id === 'custom'),
      custom,
    );
    assert.equal(after.revision, before.revision + 1);
    const report = results.find((r) => r.applied)!.report;
    const backup = (
      await pool.query('SELECT payload FROM import_backups WHERE id=$1', [report.backupId])
    ).rows[0].payload;
    assert.deepEqual(backup.workspace.baseline, baseline);
    const same = await readWorkspace();
    assert.equal((await applyMetadataPlan(plan, hash)).applied, false);
    assert.deepEqual(await readWorkspace(), same);
    await assert.rejects(applyMetadataPlan(plan, 'changed'), /checksum/);
    const leader = after.cards.find((c) => c.id === '0')!;
    const update = {
      ...leader,
      attributes: {
        ...leader.attributes,
        cardColor: 'голубой' as const,
        effects: ['мой новый эффект'],
      },
    };
    const saved = await transaction(async (c) => {
      await c.query('SELECT id FROM workspace WHERE id=1 FOR UPDATE');
      return writeCard(c, update, after.versions['0'], null);
    });
    assert.deepEqual(
      (await readWorkspace()).cards.find((c) => c.id === '0'),
      update,
    );
    await resetCard('0', saved.version, null);
    assert.equal(
      (await readWorkspace()).cards.find((c) => c.id === '0')!.attributes.cardColor,
      'красный',
    );
    const reset = await readWorkspace();
    await transaction((c) => upsertCards(c, reset.cards));
    assert.deepEqual((await readWorkspace()).cards, reset.cards);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
