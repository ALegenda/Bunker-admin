import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
// Every run uses its own schema. Never edit the user's workspace during tests.
await test('PostgreSQL, S3, API and PDF integration', async (t) => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'bunker_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { upsertCards, readWorkspace, saveWorkspace, mergeLegacyDraft } =
    await import('../services/workspace.js');
  const { ensureBucket, storeImage, resolveImage, getObject } =
    await import('../services/storage.js');
  const { createJob, getJob, publish } = await import('../services/jobs.js');
  const { cardSchema } = await import('../domain/schema.js');
  const { changes, changeStamp } = await import('../../shared/model.js');
  const { createApp } = await import('../http/app.js');
  const { runOne } = await import('../worker.js');
  const { renderRules } = await import('../services/print-template.js');
  const app = await createApp();
  const { issueLocalSession } = await import('../services/local-session.js');
  const local = issueLocalSession();
  const localHeaders = {
    host: 'localhost',
    cookie: 'bunker_local=' + local.token,
    'x-csrf-token': local.csrf,
  };
  try {
    await migrate();
    await migrate();
    await ensureBucket();
    const original = cardSchema.parse({
      id: 'test-card',
      name: 'Проверка',
      cardType: 'умение',
      description: 'Исходный текст',
      attributes: {},
      image: '',
    });
    await transaction(async (c) => {
      await upsertCards(c, [original]);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [
        JSON.stringify([original]),
      ]);
    });
    await t.test('S3 image upload validates and deduplicates content', async () => {
      const png = await sharp({
        create: { width: 180, height: 260, channels: 3, background: '#efce30' },
      })
        .png()
        .toBuffer();
      const image = await storeImage(png);
      assert.equal(await storeImage(png), image);
      await assert.rejects(storeImage(Buffer.from('<script>bad</script>')));
      await assert.rejects(resolveImage('https://example.com/image.jpg'));
      original.image = image;
    });
    await t.test('legacy migration preserves description and stores backup only once', async () => {
      const state = await readWorkspace();
      const draft = {
        ...state,
        cards: [{ ...original, description: 'Изменённый Банкир — кириллица Ёё' }],
      };
      const saved = await saveWorkspace(draft, 0, true);
      assert.equal(saved.revision, 1);
      assert.equal((await readWorkspace()).cards[0].description, draft.cards[0].description);
      assert.equal(
        (await pool.query('SELECT count(*)::int AS n FROM import_backups')).rows[0].n,
        1,
      );
      await assert.rejects(saveWorkspace(draft, 0, true), { statusCode: 409 });
    });
    await t.test(
      'second browser merge keeps server edits and rejects same-field conflicts',
      async () => {
        const state = await readWorkspace();
        const incoming = {
          ...state,
          cards: [{ ...original, description: 'Исходный текст', note: 'Заметка из Chrome' }],
        };
        const merged = await mergeLegacyDraft(incoming, state.revision);
        assert.deepEqual(merged.mergedNames, ['Проверка']);
        const combined = await readWorkspace();
        assert.equal(combined.cards[0].description, 'Изменённый Банкир — кириллица Ёё');
        assert.equal(combined.cards[0].note, 'Заметка из Chrome');
        await assert.rejects(
          mergeLegacyDraft(
            {
              ...incoming,
              cards: [{ ...incoming.cards[0], description: 'Другая конфликтующая правка' }],
            },
            combined.revision,
          ),
          { statusCode: 409 },
        );
      },
    );
    await t.test('concurrent saves cannot overwrite a newer draft', async () => {
      const state = await readWorkspace();
      const results = await Promise.allSettled([
        saveWorkspace({ ...state, release: 'Первый' }, state.revision),
        saveWorkspace({ ...state, release: 'Второй' }, state.revision),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
      assert.equal((await readWorkspace()).revision, state.revision + 1);
    });
    await t.test('local visitors remain anonymous until explicit development login', async () => {
      const guest = await app.inject({ url: '/api/me', headers: { host: 'localhost' } });
      assert.equal(guest.json().user, null);
      assert.equal(
        (await app.inject({ url: '/api/workspace', headers: { host: 'localhost' } })).statusCode,
        401,
      );
      assert.equal(
        (await app.inject({ url: '/api/proposals', headers: { host: 'localhost' } })).statusCode,
        401,
      );
      const login = await app.inject({
        method: 'POST',
        url: '/auth/local',
        headers: { host: 'localhost', origin: 'http://localhost' },
        payload: {},
      });
      assert.equal(login.statusCode, 200);
      const sessionCookie = String(login.headers['set-cookie']).split(';')[0];
      const me = (
        await app.inject({ url: '/api/me', headers: { host: 'localhost', cookie: sessionCookie } })
      ).json();
      assert.equal(me.user.role, 'admin');
      const logout = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { host: 'localhost', cookie: sessionCookie, 'x-csrf-token': me.csrf },
        payload: {},
      });
      assert.equal(logout.statusCode, 200);
      assert.equal(
        (
          await app.inject({
            url: '/api/me',
            headers: { host: 'localhost', cookie: sessionCookie },
          })
        ).json().user,
        null,
      );
    });
    await t.test('API validates revisions and rejects cross-origin writes', async () => {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/pdf/build',
        headers: localHeaders,
        payload: { revision: 'wrong' },
      });
      assert.equal(invalid.statusCode, 400);
      const cross = await app.inject({
        method: 'POST',
        url: '/api/pdf/build',
        headers: { ...localHeaders, origin: 'https://untrusted.example' },
        payload: { revision: 2 },
      });
      assert.equal(cross.statusCode, 403);
      const missing = await app.inject({
        method: 'GET',
        url: '/api/assets/not-a-uuid',
        headers: localHeaders,
      });
      assert.equal(missing.statusCode, 400);
    });
    await t.test('HTML escapes card text and supports newly added long descriptions', async () => {
      const state = await readWorkspace();
      state.cards.push(
        cardSchema.parse({
          id: 'new-card',
          name: '<script>test</script>',
          cardType: 'умение',
          description:
            'Длинное правило для проверки переноса на следующую страницу. '.repeat(200) +
            'КОНЕЦДЛИННОГОПРАВИЛА',
          image: '',
        }),
      );
      const html = await renderRules(state);
      assert.ok(html.includes('&lt;script&gt;test&lt;/script&gt;'));
      assert.ok(!html.includes('<script>test</script>'));
      assert.ok(html.includes('КОНЕЦДЛИННОГОПРАВИЛА'));
      state.changelog = '## Уточнения\n\n### Новые правила\n\nПроверка длинного описания.';
      state.changelogStamp = changeStamp(changes(state.base, state.cards));
      await saveWorkspace(state, state.revision);
    });
    let jobId = '';
    await t.test('worker renders immutable database snapshot and stores PDF in S3', async () => {
      const state = await readWorkspace();
      const job = await createJob(state.revision);
      jobId = job.id;
      assert.equal((await createJob(state.revision)).id, jobId);
      await runOne();
      const result = await getJob(jobId);
      assert.equal(result.status, 'ready');
      assert.ok(result.report.pages >= 3);
      const pdf = await getObject(result.object_key);
      assert.ok(pdf.data.subarray(0, 4).equals(Buffer.from('%PDF')));
      await mkdir('tmp/backend-tests', { recursive: true });
      await writeFile('tmp/backend-tests/long-description.pdf', pdf.data);
    });
    await t.test(
      'release freezes PDF and changelog, advances baseline, rejects stale job',
      async () => {
        const state = await readWorkspace();
        const release = await publish(jobId, state.revision);
        const frozen = (await pool.query('SELECT * FROM releases WHERE id=$1', [release.id]))
          .rows[0];
        assert.equal(frozen.changelog, state.changelog);
        const newer = await readWorkspace();
        assert.equal(newer.revision, state.revision + 1);
        assert.equal(changes(newer.base, newer.cards).length, 0);
        await assert.rejects(publish(jobId, newer.revision), { statusCode: 409 });
        const page = await app.inject({
          method: 'GET',
          url: `/releases/${release.id}`,
          headers: localHeaders,
        });
        assert.equal(page.statusCode, 200);
        assert.ok(page.body.includes('Проверка длинного описания'));
      },
    );
    await t.test('expired worker lease returns the job to the queue', async () => {
      const id = randomUUID();
      const state = await readWorkspace();
      await pool.query(
        "INSERT INTO pdf_jobs(id,status,workspace_revision,snapshot,template_version,attempts,lease_until) VALUES($1,'running',$2,$3,'test',3,now()-interval '1 minute')",
        [id, state.revision, JSON.stringify(state)],
      );
      await runOne();
      assert.equal((await getJob(id)).status, 'failed');
    });
  } finally {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
