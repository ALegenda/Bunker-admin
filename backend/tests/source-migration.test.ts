import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { descriptionText, descriptionHtml } from '../../shared/rich-text.js';

test('authoritative PDF migration preserves IDs, archives old cards and is replay-safe', async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'source_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { refreshCatalog } = await import('../services/catalog.js');
  const { applySourceManifest, sourceManifestSchema } =
    await import('../services/source-migration.js');
  const { cardSchema } = await import('../../shared/schema.js');
  try {
    await migrate();
    const bytes = await readFile('resources/rules-2026-05-24/manifest.json');
    const manifest = sourceManifestSchema.parse(JSON.parse(bytes.toString()));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      createHash('sha256')
        .update(await readFile('resources/rules-2026-05-24/source.pdf'))
        .digest('hex'),
      manifest.sourceSha256,
    );
    const originals = JSON.parse(await readFile('docs/cards.json', 'utf8')).map(
      (c: any, i: number) => ({ ...c, id: String(i) }),
    );
    const sections = JSON.parse(await readFile('public/assets/rule-sections.json', 'utf8'));
    const original = [...originals, ...sections].map((c) => cardSchema.parse({ ...c, image: '' }));
    const custom = cardSchema.parse({
      id: 'custom',
      name: 'Моя карточка',
      cardType: 'умение',
      description: 'Моя непубликованная правка',
    });
    const customPublic = { ...custom, description: 'Опубликованный текст' };
    const asset = randomUUID();
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO assets(id,object_key,sha256,mime,bytes) VALUES($1,'test','test','image/png',1)",
        [asset],
      );
      original[0].image = '/api/assets/' + asset;
      await upsertCards(c, [...original, custom]);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [
        JSON.stringify([...original, customPublic]),
      ]);
      await refreshCatalog(c, [...original, customPublic]);
    });
    const images = new Map(
      manifest.entries.filter((e) => e.new).map((e) => [e.id, '/api/assets/' + asset]),
    );
    const result = await applySourceManifest(manifest, digest, images);
    assert.equal(result.applied, true);
    assert.equal(result.report.added, 31);
    assert.equal(result.report.updated, 298);
    assert.equal(result.report.archived.length, 3);
    const state = await readWorkspace();
    assert.equal(state.cards.length, 330);
    assert.equal(state.cards.find((c) => c.id === '0')!.image, original[0].image);
    assert.equal(state.cards.find((c) => c.id === 'custom')!.description, custom.description);
    assert.equal(
      state.base.find((c: any) => c.id === 'custom')!.description,
      customPublic.description,
    );
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public_cards')).rows[0].n, 330);
    assert.match(
      state.cards.find((c) => c.name === 'Безумный Макс')!.description,
      /background-color:#808000/,
    );
    assert.match(state.cards.find((c) => c.name === 'Дровосек')!.description, /color:#0070c0/);
    const backup = (
      await pool.query('SELECT payload FROM import_backups WHERE id=$1', [result.report.backupId])
    ).rows[0].payload;
    assert.equal(backup.cards.length, 302);
    assert.equal(backup.publicCards.length, 302);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action='source.archive'"))
        .rows[0].n,
      3,
    );
    await pool.query("UPDATE cards SET description='Новая ручная правка' WHERE id='0'");
    assert.equal((await applySourceManifest(manifest, digest, images)).applied, false);
    assert.equal(
      (await readWorkspace()).cards.find((c) => c.id === '0')!.description,
      'Новая ручная правка',
    );
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n, 1);
    await assert.rejects(applySourceManifest(manifest, 'different', images), /checksum/);
    // Every extracted source line belongs to exactly one card; no content is lost in rich HTML.
    const raw = JSON.parse(bytes.toString());
    let previous = 0;
    for (const entry of raw.entries) {
      assert.equal(entry.source.lineStart, previous);
      previous = entry.source.lineEndExclusive;
      const decoded = descriptionText(entry.description).replace(/\s/g, '');
      const source = entry.sourceText.replace(/\s/g, '');
      assert.ok(source.includes(decoded), 'Source text mismatch: ' + entry.name);
      assert.doesNotMatch(descriptionHtml(entry.description), /<script|onerror|<iframe/);
    }
    assert.equal(previous, raw.sourceLines);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
