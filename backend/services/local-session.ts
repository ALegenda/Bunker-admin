import { randomToken, hash, type Actor } from './auth.js';
import { config } from '../config.js';
import { AppError } from '../domain/schema.js';
// Explicit development sessions. Never available in production; reset on restart.
const sessions = new Map<string, { expires: number; csrf: string }>();
export function issueLocalSession() {
  if (config.AUTH_MODE !== 'local' || config.NODE_ENV === 'production')
    throw new AppError(404, 'Страница не найдена');
  for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
  const token = randomToken(),
    csrf = randomToken();
  sessions.set(hash(token), { csrf, expires: Date.now() + 8 * 3600 * 1000 });
  return { token, csrf };
}
export function localActor(token?: string): Actor | null {
  if (config.AUTH_MODE !== 'local' || config.NODE_ENV === 'production' || !token) return null;
  const session = sessions.get(hash(token));
  if (!session || session.expires < Date.now()) return null;
  return { id: null, role: 'admin', display_name: 'Локальный администратор', csrf: session.csrf };
}
export function revokeLocalSession(token?: string) {
  if (token) sessions.delete(hash(token));
}
