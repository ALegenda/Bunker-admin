import { apiOrigin, backendUrl, remoteApi } from './urls.js';
import { sessionToken } from './pages-session.js';
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function apiResponse(url: string, options: RequestInit = {}): Promise<Response> {
  const target = backendUrl(url);
  if (remoteApi && new URL(target).origin !== apiOrigin) throw Error('Недопустимый адрес API');
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const token = sessionToken();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  let response: Response;
  try {
    response = await fetch(target, {
      ...options,
      credentials: remoteApi ? 'omit' : 'same-origin',
      headers,
      signal: options.signal || AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      'Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.',
      0,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error || 'Ошибка сервера', response.status);
  }
  return response;
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await apiResponse(url, options);
  const body = await response.json();
  return body;
}
export const send = <T>(url: string, body: unknown, method = 'POST') =>
  api<T>(url, { method, body: JSON.stringify(body) });
export function downloadDraft(data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bunker-draft.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
