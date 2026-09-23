const env = import.meta.env;
export const appBase = env?.VITE_APP_BASE || '/';
export const apiOrigin = (env?.VITE_API_ORIGIN || '').replace(/\/$/, '');
export const remoteApi = Boolean(apiOrigin);

export function sitePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return value;
  if (appBase === '/') return value;
  const match = value.match(/^([^?#]*)(.*)$/)!;
  const route = match[1].replace(/^\/+|\/+$/g, '');
  return appBase + (route ? route + '/' : '') + match[2];
}

export function appPath(pathname: string): string {
  const value =
    appBase !== '/' && pathname.startsWith(appBase)
      ? '/' + pathname.slice(appBase.length)
      : pathname;
  return value.replace(/\/+$/, '') || '/';
}

export function backendUrl(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') ? apiOrigin + value : value;
}

export function isBackendResource(value: string): boolean {
  return /^\/(api|auth|releases)\//.test(value);
}
