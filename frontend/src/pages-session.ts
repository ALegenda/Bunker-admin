import { remoteApi } from './urls.js';

const key = 'bunker-pages-session-v1';
export function sessionToken(): string {
  if (!remoteApi || typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(key) || '';
}
export function saveSession(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Некорректный ответ входа');
  sessionStorage.setItem(key, token);
}
export function clearSession() {
  if (remoteApi) sessionStorage.removeItem(key);
}
