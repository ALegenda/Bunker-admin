import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
await test('Production access, sessions, catalogue and proposal workflow', async (t) => {
  const control = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'bunker_test_' + randomUUID().replaceAll('-', '');
  await control.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { config } = await import('../config.js');
  config.AUTH_MODE = 'telegram';
  config.PUBLIC_ORIGIN = 'http://localhost:4173';
  config.TELEGRAM_ADMIN_IDS = '100';
  const { createApp } = await import('../http/app.js');
  const { issueSession, sessionActor, hash } = await import('../services/auth.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { cardSchema } = await import('../domain/schema.js');
  const { refreshCatalog } = await import('../services/catalog.js');
  const { saveCard } = await import('../services/cards.js');
  const { reviewProposal } = await import('../services/proposals.js');
  await migrate();
  const original = cardSchema.parse({
    id: 'card-1',
    name: 'Карточка',
    description: 'Опубликованное описание',
    cardType: 'умение',
  });
  await transaction(async (c) => {
    await upsertCards(c, [original]);
    await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [JSON.stringify([original])]);
    await refreshCatalog(c, [original]);
  });
  const tokens = {
    admin: await issueSession({ telegramId: '100', name: 'Admin', username: 'admin' }),
    trusted: await issueSession({ telegramId: '200', name: 'Trusted', username: 'trusted' }),
    player: await issueSession({ telegramId: '300', name: 'Player', username: 'player' }),
  };
  await pool.query("UPDATE users SET role='trusted' WHERE telegram_id='200'");
  const headers = async (role: keyof typeof tokens) => ({
    host: 'localhost:4173',
    origin: config.PUBLIC_ORIGIN,
    cookie: 'bunker_session=' + tokens[role],
    'x-csrf-token': (await sessionActor(tokens[role]))!.csrf,
  });
  const app = await createApp();
  try {
    await t.test(
      'browser Telegram login verifies signature, nonce, origin, browser binding and replay protection',
      async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'bunker-telegram-test-'));
        const previousKeys = config.TELEGRAM_JWKS_FILE;
        const previousClient = config.TELEGRAM_CLIENT_ID;
        config.TELEGRAM_CLIENT_ID = '12345';
        config.TELEGRAM_JWKS_FILE = path.join(directory, 'jwks.json');
        const { privateKey, publicKey } = await generateKeyPair('RS256');
        const jwk = { ...(await exportJWK(publicKey)), kid: 'sdk-test', alg: 'RS256' };
        const writeKeys = (date: Date) =>
          writeFile(
            config.TELEGRAM_JWKS_FILE,
            JSON.stringify({ fetchedAt: date.toISOString(), keys: [jwk] }),
          );
        await writeKeys(new Date());
        const begin = async () => {
          const r = await app.inject({
            url: '/auth/telegram/init',
            headers: { host: 'localhost:4173' },
          });
          assert.equal(r.statusCode, 200);
          return {
            nonce: r.json().nonce,
            cookie: 'bunker_login=' + r.cookies.find((c) => c.name === 'bunker_login')!.value,
          };
        };
        const sign = (nonce: string, audience = '12345', expires = '5m') =>
          new SignJWT({ id: 100, name: 'Admin', nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'sdk-test' })
            .setIssuer('https://oauth.telegram.org')
            .setAudience(audience)
            .setSubject('100')
            .setIssuedAt()
            .setExpirationTime(expires)
            .sign(privateKey);
        const complete = (
          token: string,
          cookie: string,
          origin: string | undefined = config.PUBLIC_ORIGIN,
        ) =>
          app.inject({
            method: 'POST',
            url: '/auth/telegram/complete',
            payload: { id_token: token },
            headers: { host: 'localhost:4173', cookie, ...(origin ? { origin } : {}) },
          });
        try {
          const first = await begin();
          const token = await sign(first.nonce);
          assert.equal((await complete(token, first.cookie, '')).statusCode, 403);
          assert.equal(
            (await complete(token, first.cookie, 'https://evil.invalid')).statusCode,
            403,
          );
          assert.equal((await complete(token, '')).statusCode, 401);
          assert.equal((await complete(await sign('wrong-nonce'), first.cookie)).statusCode, 401);
          assert.equal(
            (await complete(await sign(first.nonce, 'wrong-audience'), first.cookie)).statusCode,
            401,
          );
          assert.equal(
            (await complete(await sign(first.nonce, '12345', '-1s'), first.cookie)).statusCode,
            401,
          );
          assert.equal(
            (await complete(token.slice(0, -10) + 'tamperedXX', first.cookie)).statusCode,
            401,
          );
          const second = await begin();
          assert.equal((await complete(token, second.cookie)).statusCode, 401);
          const accepted = await complete(token, first.cookie);
          assert.equal(accepted.statusCode, 200);
          const session = accepted.cookies.find((c) => c.name === 'bunker_session')!;
          assert.equal(session.httpOnly, true);
          assert.equal((await sessionActor(session.value))?.role, 'admin');
          assert.equal((await complete(token, first.cookie)).statusCode, 401);
          await pool.query(
            "UPDATE login_attempts SET expires_at=now()-interval '1 second' WHERE state_hash=$1",
            [hash(second.nonce)],
          );
          assert.equal((await complete(await sign(second.nonce), second.cookie)).statusCode, 401);
          const third = await begin();
          await writeKeys(new Date(Date.now() - 8 * 86400000));
          assert.equal((await complete(await sign(third.nonce), third.cookie)).statusCode, 503);
          await writeKeys(new Date());
          assert.equal((await complete(await sign(third.nonce), third.cookie)).statusCode, 200);
        } finally {
          config.TELEGRAM_JWKS_FILE = previousKeys;
          config.TELEGRAM_CLIENT_ID = previousClient;
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
    await t.test(
      'anonymous visitors see released data but cannot read drafts or private jobs',
      async () => {
        const p = await app.inject({ url: '/api/catalog', headers: { host: 'localhost:4173' } });
        assert.equal(p.statusCode, 200);
        assert.equal(p.json().cards[0].description, original.description);
        assert.equal('note' in p.json().cards[0], false);
        assert.equal(
          (await app.inject({ url: '/api/workspace', headers: { host: 'localhost:4173' } }))
            .statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              url: '/api/pdf/jobs/' + randomUUID(),
              headers: { host: 'localhost:4173' },
            })
          ).statusCode,
          401,
        );
      },
    );
    await t.test('role checks and CSRF apply even to direct API calls', async () => {
      assert.equal(
        (await app.inject({ url: '/api/workspace', headers: await headers('trusted') })).statusCode,
        403,
      );
      assert.equal(
        (await app.inject({ url: '/api/proposals', headers: await headers('player') })).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/proposals',
            headers: { host: 'localhost:4173', cookie: 'bunker_session=' + tokens.trusted },
            payload: {},
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/proposals',
            headers: { ...(await headers('trusted')), origin: 'https://evil.invalid' },
            payload: {},
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await app.inject({ url: '/api/me', headers: await headers('player') })).json().user.role,
        'player',
      );
    });
    await t.test(
      'profiles are private; chosen names survive Telegram login and progress is administrator-only',
      async () => {
        const guest = { host: 'localhost:4173' };
        assert.equal((await app.inject({ url: '/api/profile', headers: guest })).statusCode, 401);
        const initial = await app.inject({ url: '/api/profile', headers: await headers('player') });
        assert.equal(initial.statusCode, 200);
        const p = initial.json().profile;
        assert.equal(p.level, 1);
        assert.equal(p.balance, 0);
        assert.deepEqual(p.achievements, []);
        assert.equal('telegram_id' in p, false);
        const update = (payload: Record<string, unknown>) =>
          app.inject({ method: 'PATCH', url: '/api/profile', headers: headersCache, payload });
        const headersCache = await headers('player');
        assert.equal((await update({ name: '  ' })).statusCode, 400);
        assert.equal((await update({ name: 'Игрок', balance: 999 })).statusCode, 400);
        assert.equal((await update({ name: 'a'.repeat(81) })).statusCode, 400);
        assert.equal((await update({ name: 'Имя\nИгрока' })).statusCode, 400);
        const name = 'Таня "Фонтанчик"';
        assert.equal((await update({ name })).json().profile.name, name);
        const login = await issueSession({
          telegramId: '300',
          name: 'Telegram name',
          username: 'updated',
        });
        assert.equal((await sessionActor(login))!.display_name, name);
        assert.equal(
          (await app.inject({ url: '/api/me', headers: await headers('player') })).json().user.name,
          name,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PATCH',
              url: '/api/profile',
              headers: { host: guest.host, cookie: headersCache.cookie },
              payload: { name: 'Other' },
            })
          ).statusCode,
          403,
        );
        const url = '/api/users/' + p.userId + '/profile';
        assert.equal(
          (await app.inject({ url, headers: await headers('trusted') })).statusCode,
          403,
        );
        assert.equal((await app.inject({ url, headers: await headers('player') })).statusCode, 403);
        const achievement = {
          id: randomUUID(),
          title: 'Первая победа',
          description: 'Победа в партии',
          awardedAt: new Date().toISOString(),
        };
        const payload = {
          revision: 0,
          level: 2,
          balance: 100,
          achievements: [achievement],
          reason: 'Победа 17 сентября',
        };
        assert.equal(
          (await app.inject({ method: 'PATCH', url, headers: await headers('player'), payload }))
            .statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ method: 'PATCH', url, headers: await headers('trusted'), payload }))
            .statusCode,
          403,
        );
        for (const bad of [
          { balance: -1 },
          { balance: 2147483648 },
          { level: 0 },
          { level: 1.5 },
          { reason: ' ' },
          { achievements: [achievement, achievement] },
        ]) {
          assert.equal(
            (
              await app.inject({
                method: 'PATCH',
                url,
                headers: await headers('admin'),
                payload: { ...payload, ...bad },
              })
            ).statusCode,
            400,
          );
        }
        const awarded = await app.inject({
          method: 'PATCH',
          url,
          headers: await headers('admin'),
          payload,
        });
        assert.equal(awarded.statusCode, 200, awarded.body);
        assert.equal(awarded.json().profile.balance, 100);
        assert.equal(awarded.json().profile.level, 2);
        assert.deepEqual(awarded.json().profile.achievements, [achievement]);
        assert.equal(awarded.json().history[0].after_data.reason, payload.reason);
        assert.equal(awarded.json().history[0].before_data.balance, 0);
        assert.equal(
          (await app.inject({ method: 'PATCH', url, headers: await headers('admin'), payload }))
            .statusCode,
          409,
        );
        const own = (
          await app.inject({ url: '/api/profile', headers: await headers('player') })
        ).json();
        assert.equal(own.profile.balance, 100);
        assert.equal(own.history.length, 1);
        const corrected = await app.inject({
          method: 'PATCH',
          url,
          headers: await headers('admin'),
          payload: {
            ...payload,
            revision: 1,
            balance: 75,
            achievements: [],
            reason: 'Исправление начисления',
          },
        });
        assert.equal(corrected.statusCode, 200);
        assert.equal(corrected.json().history.length, 2);
        assert.deepEqual(corrected.json().profile.achievements, []);
        assert.equal(
          (
            await app.inject({
              url: '/api/users/' + randomUUID() + '/profile',
              headers: await headers('admin'),
            })
          ).statusCode,
          404,
        );
      },
    );
    await t.test(
      'achievement catalogue and intermediate progress are managed only by administrators',
      async () => {
        const guest = { host: 'localhost:4173' };
        assert.equal(
          (await app.inject({ url: '/api/achievements', headers: guest })).statusCode,
          401,
        );
        for (const role of ['player', 'trusted'] as const) {
          assert.equal(
            (await app.inject({ url: '/api/achievements', headers: await headers(role) }))
              .statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: '/api/achievements',
                headers: await headers(role),
                payload: { title: 'Ветеран', description: 'Сыграть 100 игр', target: 100 },
              })
            ).statusCode,
            403,
          );
        }
        for (const target of [0, -1, 1.5, 1000001]) {
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: '/api/achievements',
                headers: await headers('admin'),
                payload: { title: 'Ветеран', description: '', target },
              })
            ).statusCode,
            400,
          );
        }
        const created = await app.inject({
          method: 'POST',
          url: '/api/achievements',
          headers: await headers('admin'),
          payload: { title: 'Ветеран', description: 'Сыграть 100 игр', target: 100 },
        });
        assert.equal(created.statusCode, 200, created.body);
        const definition = created.json();
        assert.equal(
          (await app.inject({ url: '/api/achievements', headers: await headers('admin') })).json()
            .achievements[0].id,
          definition.id,
        );
        let state = (
          await app.inject({ url: '/api/profile', headers: await headers('player') })
        ).json();
        const url = '/api/users/' + state.profile.userId + '/profile';
        const achievement = {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          target: 100,
          progress: 37,
          awardedAt: null,
        };
        const update = async (progress: number) => {
          const result = await app.inject({
            method: 'PATCH',
            url,
            headers: await headers('admin'),
            payload: {
              revision: state.profile.revision,
              level: state.profile.level,
              balance: state.profile.balance,
              achievements: [{ ...achievement, progress }],
              reason: 'Результаты игр',
            },
          });
          if (result.statusCode === 200) state = result.json();
          return result;
        };
        for (const value of [-1, 101, 0.5]) assert.equal((await update(value)).statusCode, 400);
        assert.equal((await update(37)).statusCode, 200);
        assert.equal(state.profile.achievements[0].progress, 37);
        assert.equal(state.profile.achievements[0].awardedAt, null);
        assert.equal(state.history[0].after_data.achievements[0].progress, 37);
        const own = (
          await app.inject({ url: '/api/profile', headers: await headers('player') })
        ).json();
        assert.equal(own.profile.achievements[0].target, 100);
        assert.equal(own.profile.achievements[0].progress, 37);
        assert.equal((await update(100)).statusCode, 200);
        const completedAt = state.profile.achievements[0].awardedAt;
        assert.ok(Number.isFinite(Date.parse(completedAt)));
        assert.equal((await update(100)).statusCode, 200);
        assert.equal(state.profile.achievements[0].awardedAt, completedAt);
        assert.equal((await update(99)).statusCode, 200);
        assert.equal(state.profile.achievements[0].awardedAt, null);
        assert.equal((await update(0)).statusCode, 200);
        const edit = {
          title: 'Новый ветеран',
          description: 'Сыграть 200 игр',
          target: 200,
          revision: 0,
        };
        assert.equal(
          (
            await app.inject({
              method: 'PATCH',
              url: '/api/achievements/' + definition.id,
              headers: await headers('admin'),
              payload: edit,
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PATCH',
              url: '/api/achievements/' + definition.id,
              headers: await headers('admin'),
              payload: edit,
            })
          ).statusCode,
          409,
        );
        const preserved = (
          await app.inject({ url: '/api/profile', headers: await headers('player') })
        ).json().profile.achievements[0];
        assert.equal(preserved.target, 100);
        assert.equal(preserved.title, 'Ветеран');
        assert.equal(preserved.progress, 0);
      },
    );
    await t.test(
      'tips are shared among trusted players and become public only after administrator approval',
      async () => {
        const guest = { host: 'localhost:4173' },
          url = '/api/catalog/card-1/tips';
        const payload = { body: 'Приберегите умение до голосования.' };
        assert.deepEqual((await app.inject({ url, headers: guest })).json().tips, []);
        assert.equal(
          (await app.inject({ method: 'POST', url, headers: guest, payload })).statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ method: 'POST', url, headers: await headers('player'), payload }))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: { host: guest.host, cookie: 'bunker_session=' + tokens.trusted },
              payload,
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: await headers('trusted'),
              payload: { body: ' ' },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: await headers('trusted'),
              payload: { body: 'a'.repeat(3001) },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: await headers('trusted'),
              payload: { ...payload, status: 'published' },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/catalog/not-released/tips',
              headers: await headers('trusted'),
              payload,
            })
          ).statusCode,
          404,
        );
        const submitted = await app.inject({
          method: 'POST',
          url,
          headers: await headers('trusted'),
          payload,
        });
        assert.equal(submitted.statusCode, 200, submitted.body);
        const id = submitted.json().id;
        assert.deepEqual((await app.inject({ url, headers: guest })).json().tips, []);
        assert.deepEqual(
          (await app.inject({ url, headers: await headers('player') })).json().tips,
          [],
        );
        assert.equal(
          (await app.inject({ url, headers: await headers('trusted') })).json().tips[0].status,
          'pending',
        );
        const otherToken = await issueSession({
          telegramId: '400',
          name: 'Other trusted',
          username: 'other',
        });
        await pool.query("UPDATE users SET role='trusted' WHERE telegram_id='400'");
        const other = { host: guest.host, cookie: 'bunker_session=' + otherToken };
        assert.equal((await app.inject({ url, headers: other })).json().tips[0].id, id);
        const reviewUrl = '/api/tips/' + id + '/review';
        const review = {
          status: 'published',
          expectedStatus: 'pending',
          note: 'Приватный комментарий автору',
        };
        assert.equal((await app.inject({ url: '/api/tips', headers: guest })).statusCode, 401);
        assert.equal(
          (await app.inject({ url: '/api/tips', headers: await headers('trusted') })).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: reviewUrl,
              headers: await headers('trusted'),
              payload: review,
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: reviewUrl,
              headers: await headers('admin'),
              payload: review,
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: reviewUrl,
              headers: await headers('admin'),
              payload: review,
            })
          ).statusCode,
          409,
        );
        const publicTip = (await app.inject({ url, headers: guest })).json().tips[0];
        assert.equal(publicTip.body, payload.body);
        assert.equal(publicTip.status, 'published');
        assert.equal('review_note' in publicTip, false);
        assert.equal('author_id' in publicTip, false);
        assert.equal((await app.inject({ url, headers: other })).json().tips[0].review_note, null);
        assert.equal(
          (await app.inject({ url, headers: await headers('trusted') })).json().tips[0].review_note,
          review.note,
        );
        const name = 'Антон "Крестный отец"';
        await app.inject({
          method: 'PATCH',
          url: '/api/profile',
          headers: await headers('trusted'),
          payload: { name },
        });
        assert.equal((await app.inject({ url, headers: guest })).json().tips[0].author_name, name);
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: reviewUrl,
              headers: await headers('admin'),
              payload: {
                status: 'rejected',
                expectedStatus: 'published',
                note: 'Требует уточнения',
              },
            })
          ).statusCode,
          200,
        );
        assert.deepEqual((await app.inject({ url, headers: guest })).json().tips, []);
        assert.deepEqual((await app.inject({ url, headers: other })).json().tips, []);
        assert.equal(
          (await app.inject({ url, headers: await headers('trusted') })).json().tips[0].status,
          'rejected',
        );
        assert.equal(
          (await app.inject({ url: '/api/tips', headers: await headers('admin') })).json().tips[0]
            .status,
          'rejected',
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: reviewUrl,
              headers: await headers('admin'),
              payload: { status: 'published', expectedStatus: 'rejected' },
            })
          ).statusCode,
          200,
        );
        assert.equal((await app.inject({ url, headers: guest })).json().tips.length, 1);
      },
    );
    let proposal = '';
    await t.test('trusted player proposes; administrator accepts only into draft', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/proposals',
        headers: await headers('trusted'),
        payload: {
          cardId: original.id,
          name: original.name,
          cardType: original.cardType,
          description: 'Новое описание',
          reason: 'Устраняет неоднозначность',
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      proposal = r.json().id;
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/proposals/' + proposal + '/review',
            headers: await headers('trusted'),
            payload: { decision: 'accepted' },
          })
        ).statusCode,
        403,
      );
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/proposals/' + proposal + '/review',
        headers: await headers('admin'),
        payload: { decision: 'accepted', note: 'Спасибо' },
      });
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal((await readWorkspace()).cards[0].description, 'Новое описание');
      assert.equal(
        (await app.inject({ url: '/api/catalog', headers: { host: 'localhost:4173' } })).json()
          .cards[0].description,
        original.description,
      );
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/proposals/' + proposal + '/review',
            headers: await headers('admin'),
            payload: { decision: 'accepted' },
          })
        ).statusCode,
        409,
      );
    });
    await t.test(
      'concurrent description edits stop proposal acceptance without losing either text',
      async () => {
        const r = await app.inject({
          method: 'POST',
          url: '/api/proposals',
          headers: await headers('trusted'),
          payload: {
            cardId: original.id,
            name: original.name,
            cardType: original.cardType,
            description: 'Ещё одно описание',
            reason: 'Сверка',
          },
        });
        await assert.rejects(reviewProposal(r.json().id, 'accepted', '', null), {
          statusCode: 409,
        });
        assert.equal((await readWorkspace()).cards[0].description, 'Новое описание');
      },
    );
    await t.test('per-card versions reject stale saves and preserve unrelated edits', async () => {
      const state = await readWorkspace();
      const updated = { ...state.cards[0], note: 'Комментарий' };
      const r = await saveCard(updated, state.versions[original.id], null);
      assert.equal(r.version, state.versions[original.id] + 1);
      await assert.rejects(
        saveCard({ ...updated, note: 'Устаревший' }, state.versions[original.id], null),
        { statusCode: 409 },
      );
    });
    await t.test('new card proposals and rejections never modify public catalogue', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/proposals',
        headers: await headers('trusted'),
        payload: {
          cardId: null,
          name: 'Новая идея',
          cardType: 'умение',
          description: 'Предложение',
          reason: 'Разнообразие',
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      await reviewProposal(r.json().id, 'accepted', '', null);
      assert.equal((await readWorkspace()).cards.length, 2);
      assert.equal(
        (await app.inject({ url: '/api/catalog', headers: { host: 'localhost:4173' } })).json()
          .cards.length,
        1,
      );
    });
    await t.test(
      'last administrator cannot be removed; revocation invalidates sessions immediately',
      async () => {
        const admin = (await sessionActor(tokens.admin))!;
        const trusted = (await sessionActor(tokens.trusted))!;
        const last = await app.inject({
          method: 'PATCH',
          url: '/api/users/' + admin.id,
          headers: await headers('admin'),
          payload: { role: 'player', disabled: false },
        });
        assert.equal(last.statusCode, 409, last.body);
        const revoked = await app.inject({
          method: 'PATCH',
          url: '/api/users/' + trusted.id,
          headers: await headers('admin'),
          payload: { role: 'player', disabled: true },
        });
        assert.equal(revoked.statusCode, 200, revoked.body);
        assert.equal(await sessionActor(tokens.trusted), null);
        assert.equal(
          (
            await app.inject({
              url: '/api/proposals',
              headers: { host: 'localhost:4173', cookie: 'bunker_session=' + tokens.trusted },
            })
          ).statusCode,
          401,
        );
      },
    );
    await t.test(
      'invalid login callbacks cannot create a session and expired sessions fail closed',
      async () => {
        const r = await app.inject({
          url: '/auth/callback?state=abcdefghijklmnopqrstuv&code=fake',
          headers: { host: 'localhost:4173' },
        });
        assert.equal(r.statusCode, 401);
        await pool.query(
          "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
          [hash(tokens.player)],
        );
        assert.equal(await sessionActor(tokens.player), null);
      },
    );
  } finally {
    await app.close();
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  }
});
