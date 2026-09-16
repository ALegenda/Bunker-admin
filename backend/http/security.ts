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
  app.addHook('onRequest', async (req, reply) => {
    const path = req.routeOptions.url || req.url.split('?')[0];
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
      req.actor = await sessionActor(req.cookies.bunker_session);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== config.PUBLIC_ORIGIN &&
        !(config.AUTH_MODE === 'local' && [`http://${host}`, `https://${host}`].includes(origin))
      )
        throw new AppError(403, 'Недопустимый источник запроса');
      if (path !== '/auth/local' && (!req.actor || req.headers['x-csrf-token'] !== req.actor.csrf))
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
    if (path.startsWith('/api/') && !publicRoute && !communityRoute) requireRole(req, 'admin');
    if (communityRoute) requireRole(req, 'trusted', 'admin');
  });
}
