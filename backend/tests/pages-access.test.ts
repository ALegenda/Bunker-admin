import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

await test('Pages login, CORS and bearer sessions preserve server authorization', async (t) => {
  const control = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'pages_test_' + randomUUID().replaceAll('-', '');
  await control.query(`CREATE SCHEMA ${schema}`);
  const dbUrl = new URL(process.env.DATABASE_URL!);
  dbUrl.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = dbUrl.toString();
  const { config } = await import('../config.js');
  config.AUTH_MODE = 'telegram';
  config.PUBLIC_ORIGIN = 'https://bunker.example';
  config.TELEGRAM_CLIENT_ID = '123';
  config.TELEGRAM_CLIENT_SECRET = 'test-only';
  config.TELEGRAM_ADMIN_IDS = '100';
  const { pool } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { security } = await import('../http/security.js');
  const { authRoutes } = await import('../http/routes/auth.js');
  const { issueSession, sessionActor, randomToken } = await import('../services/auth.js');
  const { issuePagesCode, pagesChallenge } = await import('../services/pages-login.js');
  await migrate();
  const app = Fastify();
  await security(app);
  await authRoutes(app);
  app.get('/api/catalog', async () => ({ cards: [] }));
  app.get('/api/workspace', async (req) => ({ role: req.actor?.role }));
  app.put('/api/cards/:id', async () => ({ saved: true }));
  const origin = new URL(config.PAGES_FRONTEND_URL).origin;
  const base = { host: 'bunker.example', origin };
  const adminToken = await issueSession({
    telegramId: '100',
    name: 'Admin',
    username: 'a',
  });
  const playerToken = await issueSession({
    telegramId: '200',
    name: 'Player',
    username: 'p',
  });
  const admin = {
    ...base,
    authorization: 'Bearer ' + adminToken,
    'x-csrf-token': (await sessionActor(adminToken))!.csrf,
  };
  const exchange = (code: string, verifier: string, headers = base) =>
    app.inject({
      method: 'POST',
      url: '/auth/pages/exchange',
      headers,
      payload: { code, verifier },
    });
  try {
    await t.test(
      'preflight is exact-origin and exact-header; public requests work without cookies',
      async () => {
        const good = await app.inject({
          method: 'OPTIONS',
          url: '/api/cards/test',
          headers: {
            ...base,
            'access-control-request-method': 'PUT',
            'access-control-request-headers': 'authorization,content-type,x-csrf-token',
          },
        });
        assert.equal(good.statusCode, 204);
        assert.equal(good.headers['access-control-allow-origin'], origin);
        assert.equal(good.headers['access-control-allow-credentials'], undefined);
        for (const badOrigin of ['https://evil.example', origin + '.evil.example', 'null']) {
          const bad = await app.inject({
            method: 'OPTIONS',
            url: '/api/catalog',
            headers: {
              ...base,
              origin: badOrigin,
              'access-control-request-method': 'GET',
            },
          });
          assert.notEqual(bad.statusCode, 204);
          assert.equal(bad.headers['access-control-allow-origin'], undefined);
        }
        const response = await app.inject({
          url: '/api/catalog',
          headers: base,
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['access-control-allow-origin'], origin);
        const anonymous = await app.inject({
          url: '/api/me',
          headers: { ...base, cookie: 'bunker_session=' + adminToken },
        });
        assert.equal(anonymous.json().user, null, 'Pages must not use ambient cookies');
      },
    );
    await t.test(
      'roles, CSRF, origin checks and the original cookie login remain enforced',
      async () => {
        assert.equal((await app.inject({ url: '/api/workspace', headers: base })).statusCode, 401);
        assert.equal(
          (
            await app.inject({
              url: '/api/workspace',
              headers: { ...base, authorization: 'Bearer ' + playerToken },
            })
          ).statusCode,
          403,
        );
        assert.equal((await app.inject({ url: '/api/workspace', headers: admin })).statusCode, 200);
        assert.equal(
          (
            await app.inject({
              url: '/api/workspace',
              headers: { ...admin, origin: 'https://evil.example' },
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: '/api/cards/test',
              headers: { ...admin, 'x-csrf-token': 'wrong' },
              payload: {},
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: '/api/cards/test',
              headers: admin,
              payload: {},
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await app.inject({
              url: '/api/workspace',
              headers: {
                host: 'bunker.example',
                cookie: 'bunker_session=' + adminToken,
              },
            })
          ).statusCode,
          200,
        );
      },
    );
    await t.test('handoff is verifier-bound, short-lived and single-use', async () => {
      const verifier = randomToken();
      const code = await issuePagesCode(adminToken, pagesChallenge(verifier));
      assert.equal(
        (
          await exchange(code, verifier, {
            ...base,
            origin: 'https://evil.example',
          })
        ).statusCode,
        403,
      );
      assert.equal((await exchange(code, randomToken())).statusCode, 401);
      const response = await exchange(code, verifier);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().token, adminToken);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal((await exchange(code, verifier)).statusCode, 401);
      const expired = await issuePagesCode(adminToken, pagesChallenge(verifier));
      await pool.query("UPDATE pages_login_codes SET expires_at=now()-interval '1 second'");
      assert.equal((await exchange(expired, verifier)).statusCode, 401);
    });
    await t.test(
      'Telegram callback returns only a bound one-time code to the fixed Pages URL',
      async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'pages-jwks-'));
        const previousFetch = globalThis.fetch;
        try {
          const { privateKey, publicKey } = await generateKeyPair('RS256');
          config.TELEGRAM_JWKS_FILE = path.join(dir, 'jwks.json');
          await writeFile(
            config.TELEGRAM_JWKS_FILE,
            JSON.stringify({
              fetchedAt: new Date().toISOString(),
              keys: [
                {
                  ...(await exportJWK(publicKey)),
                  kid: 'pages-test',
                  alg: 'RS256',
                },
              ],
            }),
          );
          const idToken = await new SignJWT({ id: 100, name: 'Admin' })
            .setProtectedHeader({ alg: 'RS256', kid: 'pages-test' })
            .setIssuer('https://oauth.telegram.org')
            .setAudience('123')
            .setSubject('100')
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey);
          globalThis.fetch = async () =>
            new Response(JSON.stringify({ id_token: idToken }), {
              headers: { 'content-type': 'application/json' },
            });
          const verifier = randomToken();
          const start = await app.inject({
            url: '/auth/telegram?client=pages&challenge=' + pagesChallenge(verifier),
            headers: { host: 'bunker.example' },
          });
          assert.equal(start.statusCode, 302);
          const state = new URL(String(start.headers.location)).searchParams.get('state');
          const cookie =
            'bunker_login=' + start.cookies.find((c) => c.name === 'bunker_login')!.value;
          const url = '/auth/callback?state=' + state + '&code=telegram-test-code';
          assert.equal(
            (await app.inject({ url, headers: { host: 'bunker.example' } })).statusCode,
            401,
          );
          const callback = await app.inject({
            url,
            headers: { host: 'bunker.example', cookie },
          });
          assert.equal(callback.statusCode, 302);
          assert.ok(
            String(callback.headers.location).startsWith(
              config.PAGES_FRONTEND_URL + 'auth/callback/#code=',
            ),
          );
          assert.equal(
            callback.cookies.some((c) => c.name === 'bunker_session'),
            false,
          );
          const code = new URLSearchParams(
            new URL(String(callback.headers.location)).hash.slice(1),
          ).get('code')!;
          const token = (await exchange(code, verifier)).json().token;
          assert.equal((await sessionActor(token))?.role, 'admin');
          assert.equal(
            (
              await app.inject({
                url,
                headers: { host: 'bunker.example', cookie },
              })
            ).statusCode,
            401,
          );
        } finally {
          globalThis.fetch = previousFetch;
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
    await t.test('logout revokes the bearer session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: admin,
        payload: {},
      });
      assert.equal(response.statusCode, 200);
      assert.equal(await sessionActor(adminToken), null);
      assert.equal((await app.inject({ url: '/api/workspace', headers: admin })).statusCode, 401);
    });
  } finally {
    await app.close();
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  }
});
