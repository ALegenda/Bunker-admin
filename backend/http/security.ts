import { localActor } from '../services/local-session.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config.js';
import { AppError } from '../domain/schema.js';
import { sessionActor, type Actor, type Role } from '../services/auth.js';
declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    sessionToken: string | null;
  }
}
export function requireRole(req: FastifyRequest, ...roles: Role[]) {
  if (!req.actor) throw new AppError(401, 'Войдите через Telegram');
  if (!roles.includes(req.actor.role)) throw new AppError(403, 'Недостаточно прав');
  return req.actor;
}
export async function security(app: FastifyInstance) {
  if (
    config.AUTH_MODE === 'local' &&
    !['127.0.0.1', 'localhost', '::1'].includes(config.HOST) &&
    config.TRUST_LOCAL_PROXY !== 'true'
  )
    throw Error('Local authentication is restricted to loopback');
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionToken', null);
  app.options('/api/*', async (_req, reply) => reply.code(403).send());
  app.options('/auth/*', async (_req, reply) => reply.code(403).send());
  app.addHook('onRequest', async (req, reply) => {
    const path = req.routeOptions.url || req.url.split('?')[0];
    const pagesOrigin = new URL(config.PAGES_FRONTEND_URL).origin;
    const fromPages = config.AUTH_MODE === 'telegram' && req.headers.origin === pagesOrigin;
    const corsPath =
      req.url.startsWith('/api/') ||
      req.url.split('?')[0] === '/auth/pages/exchange' ||
      req.url.split('?')[0] === '/auth/logout';
    if (corsPath) reply.header('Vary', 'Origin');
    if (fromPages && corsPath) {
      reply.header('Access-Control-Allow-Origin', pagesOrigin);
      reply.header('Access-Control-Expose-Headers', 'Content-Disposition');
    }
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://oauth.telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://oauth.telegram.org; frame-src https://oauth.telegram.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (config.NODE_ENV === 'production')
      reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (path.startsWith('/api/') || path.startsWith('/auth/'))
      reply.header('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    if (config.AUTH_MODE === 'local') {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
        throw new AppError(403, 'Недопустимый адрес сервера');
      req.actor = localActor(req.cookies.bunker_local);
    } else {
      if (host !== new URL(config.PUBLIC_ORIGIN).host)
        throw new AppError(403, 'Недопустимый адрес сервера');
      if (req.method === 'OPTIONS' && fromPages && corsPath) {
        const method = req.headers['access-control-request-method'] || '';
        const headers = String(req.headers['access-control-request-headers'] || '')
          .toLowerCase()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) ||
          headers.some((h) => !['authorization', 'content-type', 'x-csrf-token'].includes(h))
        )
          throw new AppError(403, 'Недопустимый запрос');
        return reply
          .header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD')
          .header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token')
          .header('Access-Control-Max-Age', '600')
          .code(204)
          .send();
      }
      if (req.headers.authorization) {
        if (!fromPages || !/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization))
          throw new AppError(401, 'Недопустимая сессия');
        req.sessionToken = req.headers.authorization.slice(7);
      } else if (!fromPages) {
        req.sessionToken = req.cookies.bunker_session || null;
      }
      req.actor = await sessionActor(req.sessionToken || undefined);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== config.PUBLIC_ORIGIN &&
        !fromPages &&
        !(config.AUTH_MODE === 'local' && [`http://${host}`, `https://${host}`].includes(origin))
      )
        throw new AppError(403, 'Недопустимый источник запроса');
      if (path === '/auth/telegram/complete' && origin !== config.PUBLIC_ORIGIN)
        throw new AppError(403, 'Недопустимый источник запроса');
      if (
        !['/auth/local', '/auth/telegram/complete', '/auth/pages/exchange'].includes(path) &&
        (!req.actor || req.headers['x-csrf-token'] !== req.actor.csrf)
      )
        throw new AppError(403, 'Обновите страницу и повторите действие');
    }
    const publicRoute = new Set([
      '/api/me',
      '/api/health',
      '/api/catalog',
      '/api/assets/:id',
      '/auth/telegram',
      '/auth/callback',
      '/auth/logout',
      '/releases/:id',
      '/releases/:id/pdf',
    ]).has(path);
    const communityRoute = path.startsWith('/api/proposals');
    const profileRoute = path === '/api/profile';
    const tipsRoute = path === '/api/catalog/:cardId/tips';
    if (path.startsWith('/api/') && !publicRoute && !communityRoute && !profileRoute && !tipsRoute)
      requireRole(req, 'admin');
    if (communityRoute) requireRole(req, 'trusted', 'admin');
    if (profileRoute) requireRole(req, 'player', 'trusted', 'admin');
  });
}
