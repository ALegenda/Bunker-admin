import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
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
