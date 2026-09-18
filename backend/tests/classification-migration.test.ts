import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { cardSchema } from '../../shared/schema.js';

test('classification migration is atomic, replay-safe and preserves independent edits and history', async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'classification_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { refreshCatalog, catalog } = await import('../services/catalog.js');
  const { normalizeCardClassification } = await import('../services/classification-migration.js');
  try {
    await migrate();
    const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
    const originals = ['4', '8', '20', '94'].map((id) =>
      cardSchema.parse({ ...source.entries.find((c: { id: string }) => c.id === id), image: '' }),
    );
    originals[0].attributes.effects = ['Опасная личность'];
    originals[1].attributes.effects = ['Бессмертие', 'Забей'];
    originals[1].attributes.tags = ['Бессмертие', 'Защита'];
    originals[1].attributes.usageFrequency = 'одноразовое, трёхразовое';
    const drafts = structuredClone(originals);
    drafts[2].description = 'Ручная механика, которую нельзя менять';
    drafts[2].note = 'Сохранить заметку';
    const releaseId = randomUUID();
    await transaction(async (c) => {
      await upsertCards(c, drafts);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [JSON.stringify(originals)]);
      await refreshCatalog(c, originals);
      await c.query(
        "INSERT INTO pdf_jobs(id,status,workspace_revision,snapshot,template_version) VALUES($1,'ready',0,$2,'classification-test')",
        [releaseId, JSON.stringify({ cards: originals })],
      );
      await c.query(
        "INSERT INTO releases(id,title,workspace_revision,snapshot,changelog,pdf_job_id) VALUES($1,'Тестовая редакция',0,$2,'',$1)",
        [releaseId, JSON.stringify({ cards: originals })],
      );
    });
    const before = await readWorkspace();
    await pool.query(`CREATE FUNCTION reject_classification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
      CREATE TRIGGER reject_classification BEFORE UPDATE ON public_cards FOR EACH ROW EXECUTE FUNCTION reject_classification()`);
    await assert.rejects(normalizeCardClassification(), /test rollback/);
    assert.deepEqual(await readWorkspace(), before);
    assert.equal((await pool.query('SELECT count(*)::int n FROM import_backups')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM source_migrations')).rows[0].n, 0);
    await pool.query('DROP TRIGGER reject_classification ON public_cards');
    const results = await Promise.all([
      normalizeCardClassification(),
      normalizeCardClassification(),
    ]);
    assert.equal(results.filter((result) => result.applied).length, 1);
    const after = await readWorkspace();
    const pub = await catalog();
    assert.equal(after.revision, before.revision + 1);
    assert.equal(pub.title, 'Тестовая редакция');
    assert.deepEqual(after.cards[0].attributes.effects, undefined);
    assert.deepEqual(after.cards[0].attributes.tags, []);
    assert.equal(after.cards[0].attributes.dangerousPersonality, true);
    assert.equal(pub.cards[0].attributes.dangerousPersonality, true);
    assert.deepEqual(after.cards[1].attributes.effects, ['бессмертие', 'забей']);
    assert.deepEqual(after.cards[1].attributes.tags, ['защита']);
    assert.equal(after.cards[1].attributes.usageFrequency, 'по условию');
    assert.equal(after.cards[1].attributes.usageCondition, 'одноразовая / трёхразовая');
    assert.equal(pub.cards[1].attributes.usageCondition, 'одноразовая / трёхразовая');
    assert.equal(after.cards[2].description, drafts[2].description);
    assert.equal(after.cards[2].note, drafts[2].note);
    assert.deepEqual(after.cards[2].attributes.usageLocation, ['внутри бункера']);
    assert.deepEqual(pub.cards[2].attributes.usageLocation, ['внутри бункера', 'снаружи']);
    const report = results.find((result) => result.applied)!.report;
    assert.ok(
      report.skipped.some(
        (entry: { id: string; layer: string }) => entry.id === '20' && entry.layer === 'draft',
      ),
    );
    const backup = (
      await pool.query('SELECT payload FROM import_backups WHERE id=$1', [report.backupId])
    ).rows[0].payload;
    assert.deepEqual(backup.workspace.baseline, originals);
    assert.deepEqual(
      (await pool.query('SELECT snapshot FROM releases WHERE id=$1', [releaseId])).rows[0].snapshot
        .cards,
      originals,
    );
    assert.equal((await normalizeCardClassification()).applied, false);
    assert.deepEqual(await readWorkspace(), after);
    const { saveCard } = await import('../services/cards.js');
    const edited = await saveCard(
      {
        ...after.cards[0],
        attributes: {
          ...after.cards[0].attributes,
          dangerousPersonality: false,
          usageFrequency: 'по условию',
          usageCondition: 'После голосования',
        },
      },
      after.versions[after.cards[0].id],
      null,
    );
    assert.equal(edited.card.attributes.dangerousPersonality, undefined);
    const saved = await readWorkspace();
    assert.equal(saved.cards[0].attributes.dangerousPersonality, undefined);
    assert.equal(saved.cards[0].attributes.usageCondition, 'После голосования');
    await transaction((c) => upsertCards(c, saved.cards));
    assert.deepEqual((await readWorkspace()).cards, saved.cards);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
