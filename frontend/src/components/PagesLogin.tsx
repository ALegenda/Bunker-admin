import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { appBase, backendUrl, sitePath } from '../urls.js';
import { saveSession } from '../pages-session.js';

const verifierKey = 'bunker-pages-verifier-v1';
const returnKey = 'bunker-pages-return-v1';
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

export function PagesLogin() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="telegram"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
            const digest = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(verifier),
            );
            sessionStorage.setItem(verifierKey, verifier);
            sessionStorage.setItem(returnKey, location.pathname + location.search);
            location.assign(
              backendUrl(
                '/auth/telegram?client=pages&challenge=' + base64url(new Uint8Array(digest)),
              ),
            );
          } catch {
            setError(
              'Не удалось начать вход. Разрешите хранение данных для этого сайта и попробуйте снова.',
            );
            setBusy(false);
          }
        }}
      >
        {busy ? 'Открываем Telegram…' : 'Войти через Telegram'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function PagesCallback() {
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(location.hash.slice(1)).get('code');
    history.replaceState(null, '', location.pathname);
    const verifier = sessionStorage.getItem(verifierKey);
    if (!code || !verifier) {
      setError('Попытка входа устарела. Вернитесь в профиль и войдите снова.');
      return;
    }
    api<{ token: string }>('/auth/pages/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, verifier }),
    })
      .then(({ token }) => {
        saveSession(token);
        const target = sessionStorage.getItem(returnKey) || sitePath('/profile');
        sessionStorage.removeItem(verifierKey);
        sessionStorage.removeItem(returnKey);
        const url = new URL(target, location.origin);
        location.replace(
          url.origin === location.origin &&
            url.pathname.startsWith(appBase) &&
            !url.pathname.includes('/auth/callback')
            ? url.href
            : sitePath('/profile'),
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main>
      <h1>Вход в Бункер</h1>
      <p role={error ? 'alert' : 'status'}>{error || 'Завершаем вход…'}</p>
      {error && <a href={sitePath('/profile')}>Вернуться в профиль</a>}
    </main>
  );
}
