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
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      'X-CSRF-Token': csrf,
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error || 'Ошибка сервера', response.status);
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
