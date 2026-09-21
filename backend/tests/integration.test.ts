import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
    await t.test('homepage is complete HTML with only lightweight enhancements', async () => {
      const page = await app.inject({ url: '/', headers: { host: 'localhost' } });
      assert.equal(page.statusCode, 200);
      assert.match(page.headers['cache-control'] || '', /no-cache/);
      assert.match(page.body, /data-prerendered="landing"/);
      assert.match(page.body, /<h1[^>]*>КОНЕЦ СВЕТА\?/);
      assert.match(page.body, /<style>[\s\S]*\.landing/);
      assert.doesNotMatch(page.body, /<link[^>]+rel="stylesheet"/);
      const scripts = [...page.body.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
      assert.equal(scripts.length, 1);
      assert.match(scripts[0][1], /^\/assets\/landing-[\w-]+\.js$/);
      for (const [, url] of page.body.matchAll(
        /<link\b(?=[^>]*\brel="modulepreload")(?=[^>]*\bhref="([^"]+)")[^>]*>/g,
      )) {
        assert.match(url, /^\/assets\/(?:landing-menu|back-to-top|modulepreload-polyfill)-[\w-]+\.js$/);
      }
      assert.ok(
        gzipSync(page.body).length < 20000,
        'Keep the initial HTML and CSS under 20 KB gzip',
      );
      assert.match(page.body, /<details class="landing-mobile-menu">/);
      for (const group of ['role', 'situation']) {
        for (let index = 0; index < 3; index++) {
          assert.match(page.body, new RegExp(`type="radio"[^>]+id="${group}-choice-${index}"`));
          assert.match(page.body, new RegExp(`for="${group}-choice-${index}"`));
        }
      }
      assert.match(page.body, /<source[^>]+type="image\/avif"[^>]+srcSet=/);
      assert.match(page.body, /href="\/catalog"/);
      assert.match(page.body, /href="https:\/\/t\.me\/bunker_vl"/);
      for (const path of ['/catalog', '/profile', '/admin']) {
        const internal = await app.inject({ url: path, headers: { host: 'localhost' } });
        assert.doesNotMatch(internal.body, /data-prerendered="landing"/);
      }
    });
    await t.test('landing and catalog routes preserve old public card links', async () => {
      for (const path of ['/', '/catalog', '/catalog?type=роль', '/profile', '/admin']) {
        const response = await app.inject({ url: encodeURI(path), headers: { host: 'localhost' } });
        assert.equal(response.statusCode, 200, path);
        assert.match(response.headers['content-type'] || '', /text\/html/);
      }
      const legacy = await app.inject({
        url: '/?card=role-medic&tag=one&tag=two',
        headers: { host: 'localhost' },
      });
      assert.equal(legacy.statusCode, 301);
      assert.equal(legacy.headers.location, '/catalog?card=role-medic&tag=one&tag=two');
    });
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
      assert.match((await readWorkspace()).changelog, /Стало: Изменённый Банкир/);
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
        assert.match(combined.changelog, /Заметка из Chrome/);
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
    await t.test(
      'card edits automatically persist the summary and invalidate its review',
      async () => {
        const { saveCard, resetCard, saveReleaseMeta } = await import('../services/cards.js');
        let state = await readWorkspace();
        const card = state.cards[0];
        const saved = await saveCard(
          { ...card, description: 'Новая механика' },
          state.versions[card.id],
          null,
        );
        state = await readWorkspace();
        assert.equal(state.revision, saved.revision);
        assert.match(state.changelog, /Было: Исходный текст\nСтало: Новая механика/);
        await saveReleaseMeta(
          {
            revision: state.revision,
            release: state.release,
            changelog: 'Отредактированная вручную сводка',
            changelogStamp: changeStamp(changes(state.base, state.cards)),
          },
          null,
        );
        state = await readWorkspace();
        assert.equal(state.changelog, 'Отредактированная вручную сводка');
        await saveCard(
          { ...saved.card, note: 'Причина правки', kind: 'Механика и баланс' },
          saved.version,
          null,
        );
        state = await readWorkspace();
        assert.match(state.changelog, /^## Механика и баланс/);
        assert.match(state.changelog, /Причина правки/);
        assert.equal(state.changelogStamp, '');
        await assert.rejects(saveCard(card, saved.version, null), { statusCode: 409 });
        assert.equal((await readWorkspace()).changelog, state.changelog);
        const added = await saveCard(
          { ...original, id: 'temporary-card', name: 'Временная' },
          null,
          null,
        );
        assert.match((await readWorkspace()).changelog, /Добавлено: Временная/);
        await resetCard(added.card.id, added.version, null);
        assert.doesNotMatch((await readWorkspace()).changelog, /Временная/);
        await resetCard(card.id, state.versions[card.id], null);
        assert.equal((await readWorkspace()).changelog, '');
      },
    );
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
    await t.test(
      'formatted descriptions round-trip through PostgreSQL and frozen PDF snapshot',
      async () => {
        const { encodeRichText } = await import('../../shared/rich-text.js');
        const state = await readWorkspace();
        const description = encodeRichText(
          '<p><strong>Форматированный текст</strong> <span style="color: #b42318">красный</span></p>',
        );
        const draft = {
          ...state,
          cards: state.cards.map((card, index) => (index === 0 ? { ...card, description } : card)),
        };
        draft.changelogStamp = changeStamp(changes(draft.base, draft.cards));
        const saved = await saveWorkspace(draft, state.revision);
        assert.equal((await readWorkspace()).cards[0].description, description);
        assert.match(
          await renderRules({ ...state, ...saved }),
          /<strong>Форматированный текст<\/strong>/,
        );
      },
    );
    await t.test(
      'scheduled worker stores the immutable PDF and exits after draining the queue',
      async () => {
        const state = await readWorkspace();
        const job = await createJob(state.revision);
        jobId = job.id;
        assert.equal((await createJob(state.revision)).id, jobId);
        await promisify(execFile)(
          process.execPath,
          ['--import', 'tsx', fileURLToPath(new URL('../worker-once.ts', import.meta.url))],
          { env: process.env, timeout: 30000 },
        );
        const result = await getJob(jobId);
        assert.equal(result.status, 'ready');
        assert.ok(result.report.pages >= 3);
        const pdf = await getObject(result.object_key);
        assert.ok(pdf.data.subarray(0, 4).equals(Buffer.from('%PDF')));
        await mkdir('tmp/backend-tests', { recursive: true });
        await writeFile('tmp/backend-tests/long-description.pdf', pdf.data);
      },
    );
    await t.test('ready PDF survives reload, repeated save and review after building', async () => {
      const state = await readWorkspace();
      const meta = {
        revision: state.revision,
        release: state.release,
        changelog: state.changelog,
        changelogStamp: '',
      };
      const save = async (payload: typeof meta) => {
        const response = await app.inject({
          method: 'PATCH',
          url: '/api/workspace/meta',
          headers: localHeaders,
          payload,
        });
        assert.equal(response.statusCode, 200, response.body);
        return response.json();
      };
      assert.equal((await save(meta)).revision, state.revision);
      await assert.rejects(publish(jobId, state.revision), { statusCode: 409 });
      const current = await app.inject({
        method: 'GET',
        url: '/api/pdf/current',
        headers: localHeaders,
      });
      assert.equal(current.statusCode, 200);
      assert.equal(current.json().job.jobId, jobId);
      assert.equal(current.json().job.status, 'ready');
      assert.equal(current.json().job.revision, state.revision);
      assert.equal(
        (await save({ ...meta, changelogStamp: changeStamp(changes(state.base, state.cards)) }))
          .revision,
        state.revision,
      );
      assert.equal((await createJob(state.revision)).id, jobId);
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
        assert.ok(page.body.includes('КОНЕЦДЛИННОГОПРАВИЛА'));
      },
    );
    await t.test(
      'published and outdated builds cannot be restored for a new revision',
      async () => {
        const current = await app.inject({
          method: 'GET',
          url: '/api/pdf/current',
          headers: localHeaders,
        });
        assert.equal(current.json().job, null);
        const state = await readWorkspace();
        const response = await app.inject({
          method: 'PATCH',
          url: '/api/workspace/meta',
          headers: localHeaders,
          payload: {
            revision: state.revision,
            release: state.release + ' новая',
            changelog: 'Новая сводка',
            changelogStamp: '',
          },
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().revision, state.revision + 1);
        await assert.rejects(publish(jobId, state.revision + 1), { statusCode: 409 });
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
