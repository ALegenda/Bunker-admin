import { issueLocalSession, revokeLocalSession } from '../../services/local-session.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool } from '../../db/index.js';
import { AppError } from '../../domain/schema.js';
import { hash, randomToken, verifyTelegramToken, issueSession } from '../../services/auth.js';
import { createHash } from 'node:crypto';
import { issuePagesCode, exchangePagesCode } from '../../services/pages-login.js';
export async function authRoutes(app: FastifyInstance) {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: config.PUBLIC_ORIGIN.startsWith('https:'),
    sameSite: 'lax' as const,
  };
  app.post(
    '/auth/local',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (config.AUTH_MODE !== 'local' || config.NODE_ENV === 'production')
        throw new AppError(404, 'Страница не найдена');
      if (!req.headers.origin) throw new AppError(403, 'Откройте страницу локального редактора');
      const { token } = issueLocalSession();
      revokeLocalSession(req.cookies.bunker_local);
      reply.setCookie('bunker_local', token, {
        ...cookieOptions,
        maxAge: 8 * 3600,
      });
      return { ok: true };
    },
  );
  app.get('/api/me', async (req) => ({
    user: req.actor && {
      id: req.actor.id,
      role: req.actor.role,
      name: req.actor.display_name,
    },
    csrf: req.actor?.csrf || '',
    authMode: config.AUTH_MODE,
  }));
  app.get(
    '/auth/telegram/init',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      if (config.AUTH_MODE !== 'telegram') throw new AppError(404, 'Страница не найдена');
      const nonce = randomToken(),
        browser = randomToken();
      await pool.query('DELETE FROM login_attempts WHERE expires_at < now()');
      await pool.query(
        "INSERT INTO login_attempts(state_hash,browser_hash,verifier,expires_at) VALUES($1,$2,'sdk',now()+interval '10 minutes')",
        [hash(nonce), hash(browser)],
      );
      reply.setCookie('bunker_login', browser, {
        ...cookieOptions,
        maxAge: 600,
      });
      return { client_id: Number(config.TELEGRAM_CLIENT_ID), nonce };
    },
  );
  app.post(
    '/auth/telegram/complete',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (config.AUTH_MODE !== 'telegram') throw new AppError(404, 'Страница не найдена');
      const { id_token } = z.object({ id_token: z.string().min(20).max(16384) }).parse(req.body);
      let identity;
      try {
        identity = await verifyTelegramToken(id_token);
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 503) throw error;
        throw new AppError(401, 'Telegram не подтвердил вход. Попробуйте снова.');
      }
      if (!identity.nonce) throw new AppError(401, 'Вход устарел. Попробуйте снова.');
      const attempt = await pool.query(
        "DELETE FROM login_attempts WHERE state_hash=$1 AND browser_hash=$2 AND verifier='sdk' AND expires_at>now() RETURNING state_hash",
        [hash(identity.nonce), hash(req.cookies.bunker_login || '')],
      );
      if (!attempt.rowCount) throw new AppError(401, 'Вход устарел. Попробуйте снова.');
      const token = await issueSession(identity);
      if (req.cookies.bunker_session)
        await pool.query('DELETE FROM sessions WHERE token_hash=$1', [
          hash(req.cookies.bunker_session),
        ]);
      reply.clearCookie('bunker_login', cookieOptions);
      reply.setCookie('bunker_session', token, {
        ...cookieOptions,
        maxAge: 7 * 24 * 3600,
      });
      return { ok: true };
    },
  );
  app.get(
    '/auth/telegram',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (config.AUTH_MODE !== 'telegram')
        throw new AppError(503, 'Вход через Telegram ещё не настроен');
      await pool.query('DELETE FROM login_attempts WHERE expires_at < now()');
      const input = z
        .object({
          client: z.literal('pages').optional(),
          challenge: z
            .string()
            .regex(/^[A-Za-z0-9_-]{43}$/)
            .optional(),
        })
        .parse(req.query);
      if (Boolean(input.client) !== Boolean(input.challenge))
        throw new AppError(400, 'Некорректный запрос входа');
      const state = randomToken(),
        browser = randomToken(),
        verifier = randomToken();
      await pool.query(
        "INSERT INTO login_attempts(state_hash,browser_hash,verifier,pages_challenge,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
        [hash(state), hash(browser), verifier, input.challenge || null],
      );
      reply.setCookie('bunker_login', browser, {
        ...cookieOptions,
        maxAge: 600,
      });
      const query = new URLSearchParams({
        client_id: config.TELEGRAM_CLIENT_ID,
        redirect_uri: config.PUBLIC_ORIGIN + '/auth/callback',
        response_type: 'code',
        scope: 'openid profile',
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      });
      return reply.redirect('https://oauth.telegram.org/auth?' + query);
    },
  );
  app.get(
    '/auth/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const q = z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().min(1).max(4096),
        })
        .parse(req.query);
      const attempt = await pool.query(
        'DELETE FROM login_attempts WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING verifier,pages_challenge',
        [hash(q.state), hash(req.cookies.bunker_login || '')],
      );
      if (!attempt.rowCount) throw new AppError(401, 'Вход устарел. Попробуйте снова.');
      reply.clearCookie('bunker_login', cookieOptions);
      const result = await fetch('https://oauth.telegram.org/token', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(config.TELEGRAM_CLIENT_ID + ':' + config.TELEGRAM_CLIENT_SECRET).toString(
              'base64',
            ),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: q.code,
          redirect_uri: config.PUBLIC_ORIGIN + '/auth/callback',
          client_id: config.TELEGRAM_CLIENT_ID,
          code_verifier: attempt.rows[0].verifier,
        }),
      });
      if (!result.ok) throw new AppError(401, 'Telegram не подтвердил вход. Попробуйте снова.');
      const body = z.object({ id_token: z.string() }).parse(await result.json());
      const identity = await verifyTelegramToken(body.id_token);
      const token = await issueSession(identity);
      if (attempt.rows[0].pages_challenge) {
        const code = await issuePagesCode(token, attempt.rows[0].pages_challenge);
        return reply.redirect(config.PAGES_FRONTEND_URL + 'auth/callback/#code=' + code);
      }
      if (req.cookies.bunker_session)
        await pool.query('DELETE FROM sessions WHERE token_hash=$1', [
          hash(req.cookies.bunker_session),
        ]);
      reply.setCookie('bunker_session', token, {
        ...cookieOptions,
        maxAge: 7 * 24 * 3600,
      });
      return reply.redirect('/profile');
    },
  );
  app.post(
    '/auth/pages/exchange',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      if (
        config.AUTH_MODE !== 'telegram' ||
        req.headers.origin !== new URL(config.PAGES_FRONTEND_URL).origin
      )
        throw new AppError(403, 'Недопустимый источник запроса');
      const body = z
        .object({
          code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .parse(req.body);
      return { token: await exchangePagesCode(body.code, body.verifier) };
    },
  );
  app.post('/auth/logout', async (req, reply) => {
    revokeLocalSession(req.cookies.bunker_local);
    reply.clearCookie('bunker_local', cookieOptions);
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(req.sessionToken || '')]);
    reply.clearCookie('bunker_session', cookieOptions);
    return { ok: true };
  });
}
