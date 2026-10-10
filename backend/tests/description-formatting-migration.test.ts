import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { cardSchema } from '../../shared/schema.js';
import { descriptionFormattingPlanSchema } from '../domain/description-formatting.js';
import { encodeRichText, descriptionHtml } from '../../shared/rich-text.js';

test('formatting migration is atomic, preserves each data layer and history, and applies only once', async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'formatting_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { refreshCatalog, catalog } = await import('../services/catalog.js');
  const { applyDescriptionFormattingPlan } =
    await import('../services/description-formatting-migration.js');
  try {
    await migrate();
    const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
    const bytes = await readFile('resources/rules-2026-05-24/description-formatting.json');
    const plan = descriptionFormattingPlanSchema.parse(JSON.parse(bytes.toString()));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const cards = source.entries.map((e: any) => cardSchema.parse({ ...e, image: '' }));
    const custom = cardSchema.parse({
      id: 'custom',
      name: 'Моя карточка',
      cardType: 'припас',
      description: 'Свои правила',
    });
    const published = [...cards, custom];
    const draft = structuredClone(published);
    draft.find((c: any) => c.id === '0')!.description = 'Новая неопубликованная механика';
    const mixerId = 'pdf24-eb513d34480d';
    const mixer = draft.find((c: any) => c.id === mixerId)!;
    mixer.description = encodeRichText(
      '<blockquote>' + descriptionHtml(mixer.description) + '</blockquote>',
    );
    const axe = draft.find((c: any) => c.id === '198')!;
    axe.note = 'Для будущего выпуска';
    axe.attributes.tags = ['Ручной тег'];
    published.find((c: any) => c.id === '7')!.description = 'Собственная опубликованная версия';
    const jobId = randomUUID(),
      releaseId = randomUUID();
    await transaction(async (c) => {
      await upsertCards(c, draft);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [JSON.stringify(published)]);
      await refreshCatalog(c, published);
      await c.query(
        "INSERT INTO pdf_jobs(id,workspace_revision,snapshot,template_version) VALUES($1,0,$2,'test')",
        [jobId, JSON.stringify(published)],
      );
      await c.query(
        "INSERT INTO releases(id,title,workspace_revision,snapshot,changelog,pdf_job_id) VALUES($1,'Текущая редакция',0,$2,'',$3)",
        [releaseId, JSON.stringify(published), jobId],
      );
    });
    const before = await readWorkspace();
    await pool.query(`CREATE FUNCTION reject_formatting() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
      CREATE TRIGGER reject_formatting BEFORE UPDATE ON public_cards FOR EACH ROW EXECUTE FUNCTION reject_formatting()`);
    await assert.rejects(applyDescriptionFormattingPlan(plan, hash), /test rollback/);
    assert.deepEqual(await readWorkspace(), before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, 0);
    await pool.query('DROP TRIGGER reject_formatting ON public_cards');
    const results = await Promise.all([
      applyDescriptionFormattingPlan(plan, hash),
      applyDescriptionFormattingPlan(plan, hash),
    ]);
    assert.equal(results.filter((r) => r.applied).length, 1);
    const report = results.find((r) => r.applied)!.report;
    assert.equal(report.reviewed, 329);
    assert.deepEqual(
      report.skipped.map((e: any) => [e.layer, e.id]).sort(),
      [
        ['baseline', '7'],
        ['draft', '0'],
        ['draft', mixerId],
        ['published', '7'],
      ].sort(),
    );
    const after = await readWorkspace();
    const publicAfter = await catalog();
    assert.equal(publicAfter.title, 'Текущая редакция');
    assert.equal(after.revision, before.revision + 1);
    for (const id of ['0', mixerId, 'custom'])
      assert.deepEqual(
        after.cards.find((c) => c.id === id),
        before.cards.find((c) => c.id === id),
      );
    assert.ok(publicAfter.cards.find((c) => c.id === mixerId)!.description.includes('<ul><li>'));
    assert.equal(
      publicAfter.cards.find((c) => c.id === '7')!.description,
      'Собственная опубликованная версия',
    );
    const withoutDescription = (items: any[]) => items.map(({ description, ...card }) => card);
    assert.deepEqual(withoutDescription(after.cards), withoutDescription(before.cards));
    assert.deepEqual(withoutDescription(after.base), withoutDescription(before.base));
    assert.equal(after.versions['198'], before.versions['198'] + 1);
    assert.equal(after.versions['0'], before.versions['0']);
    const backup = (
      await pool.query('SELECT payload FROM import_backups WHERE id=$1', [report.backupId])
    ).rows[0].payload;
    assert.deepEqual(backup.workspace.baseline, published);
    assert.deepEqual(
      (await pool.query('SELECT snapshot FROM releases WHERE id=$1', [releaseId])).rows[0].snapshot,
      published,
    );
    assert.deepEqual(
      (await pool.query('SELECT snapshot FROM pdf_jobs WHERE id=$1', [jobId])).rows[0].snapshot,
      published,
    );
    assert.ok(
      (
        await pool.query(
          "SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='source.description-formatting'",
          ['198'],
        )
      ).rowCount,
    );
    await pool.query("UPDATE cards SET description='Поздняя ручная правка' WHERE id='198'");
    const edited = await readWorkspace();
    assert.equal((await applyDescriptionFormattingPlan(plan, hash)).applied, false);
    assert.deepEqual(await readWorkspace(), edited);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n, 1);
    await assert.rejects(
      applyDescriptionFormattingPlan(plan, 'changed checksum'),
      /checksum mismatch/,
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
