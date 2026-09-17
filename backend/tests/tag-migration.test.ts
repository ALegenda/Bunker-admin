import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { cardSchema } from '../../shared/schema.js';
import { tagPlanSchema } from '../domain/card-tags.js';

test('tag migration is atomic, preserves independent draft/public state and is replay safe', async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'tags_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { refreshCatalog, catalog } = await import('../services/catalog.js');
  const { applyTagPlan } = await import('../services/tag-migration.js');
  try {
    await migrate();
    const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
    const bytes = await readFile('resources/rules-2026-05-24/tag-enrichment.json');
    const plan = tagPlanSchema.parse(JSON.parse(bytes.toString()));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const cards = source.entries.map((e: any) => cardSchema.parse({ ...e, image: '' }));
    const custom = cardSchema.parse({
      id: 'custom',
      name: 'Ручная карточка',
      cardType: 'припас',
      description: 'Своя механика',
      attributes: { tags: ['Мой тег'] },
    });
    const published = [...cards, custom];
    const draft = structuredClone(published);
    const leader = draft.find((c: any) => c.id === '0')!;
    leader.description = 'Новая, ещё не опубликованная механика';
    const axe = draft.find((c: any) => c.id === '198')!;
    axe.attributes.tags = ['Мой тег', 'МЕТАЛЛИЧЕСКИЙ'];
    axe.note = 'Заметка для будущего выпуска';
    // A published-only text change must not prevent enrichment of an unchanged draft.
    published.find((c: any) => c.id === '205')!.description = 'Своя опубликованная версия';
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
        "INSERT INTO releases(id,title,workspace_revision,snapshot,changelog,pdf_job_id) VALUES($1,'Моя редакция',0,$2,'',$3)",
        [releaseId, JSON.stringify(published), jobId],
      );
    });
    const before = await readWorkspace();
    // Fail after draft updates to prove the backup, audit and all three data layers roll back.
    await pool.query(`CREATE FUNCTION reject_tag_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
      CREATE TRIGGER reject_tag_update BEFORE UPDATE ON public_cards FOR EACH ROW EXECUTE FUNCTION reject_tag_update()`);
    await assert.rejects(applyTagPlan(plan, hash), /test rollback/);
    assert.deepEqual(await readWorkspace(), before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, 0);
    await pool.query('DROP TRIGGER reject_tag_update ON public_cards');
    const results = await Promise.all([applyTagPlan(plan, hash), applyTagPlan(plan, hash)]);
    assert.equal(results.filter((r) => r.applied).length, 1);
    const report = results.find((r) => r.applied)!.report;
    assert.ok(report.skipped.some((e: any) => e.layer === 'draft' && e.id === '0'));
    assert.ok(report.skipped.some((e: any) => e.layer === 'published' && e.id === '205'));
    const after = await readWorkspace();
    const publicAfter = await catalog();
    assert.equal(publicAfter.title, 'Моя редакция');
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(
      after.cards.find((c) => c.id === '0'),
      leader,
    );
    assert.ok(publicAfter.cards.find((c) => c.id === '0')!.attributes.tags.includes('Лидерство'));
    assert.ok(after.cards.find((c) => c.id === '205')!.attributes.tags.includes('металлический'));
    assert.equal(
      publicAfter.cards.find((c) => c.id === '205')!.description,
      'Своя опубликованная версия',
    );
    const enrichedAxe = after.cards.find((c) => c.id === '198')!;
    assert.deepEqual(enrichedAxe.attributes.tags.slice(0, 2), ['Мой тег', 'МЕТАЛЛИЧЕСКИЙ']);
    assert.equal(
      enrichedAxe.attributes.tags.filter((t) => t.toLowerCase() === 'металлический').length,
      1,
    );
    assert.equal(enrichedAxe.note, axe.note);
    assert.deepEqual(
      after.cards.find((c) => c.id === 'custom'),
      custom,
    );
    assert.deepEqual(
      after.base,
      publicAfter.cards.map((c) => ({
        ...published.find((p: any) => p.id === c.id),
        attributes: c.attributes,
      })),
    );
    const stripTags = (items: any[]) =>
      items.map((c) => ({ ...c, attributes: { ...c.attributes, tags: [] } }));
    assert.deepEqual(stripTags(after.cards), stripTags(before.cards));
    assert.deepEqual(stripTags(after.base), stripTags(before.base));
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
    // Deleting an assigned tag after migration is a lasting manual choice.
    await pool.query("UPDATE cards SET tags=ARRAY['Мой тег'] WHERE id='198'");
    const edited = await readWorkspace();
    assert.equal((await applyTagPlan(plan, hash)).applied, false);
    assert.deepEqual(await readWorkspace(), edited);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n, 1);
    await assert.rejects(applyTagPlan(plan, 'changed checksum'), /checksum mismatch/);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
