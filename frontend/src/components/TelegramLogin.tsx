import { remoteApi } from '../urls.js';
import { PagesLogin } from './PagesLogin.js';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { telegramResult, type LoginResult } from '../telegram-result.js';

type Options = { client_id: number; nonce: string };
declare global {
  interface Window {
    Telegram?: {
      Login: {
        close(): void;
        auth(
          options: Options & { scope: string[]; lang: string },
          callback: (result: LoginResult) => void,
        ): void;
      };
    };
  }
}
let sdk: Promise<void> | undefined;
function loadSdk() {
  if (window.Telegram?.Login) return Promise.resolve();
  return (sdk ||= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => script.onerror?.(new Event('error')), 15000);
    script.src = 'https://oauth.telegram.org/js/telegram-login.js?6';
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      sdk = undefined;
      script.remove();
      reject(Error('Не удалось загрузить Telegram. Проверьте соединение.'));
    };
    document.head.appendChild(script);
  }));
}
export function TelegramLogin() {
  return remoteApi ? <PagesLogin /> : <CookieTelegramLogin />;
}
function CookieTelegramLogin() {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    let active = true;
    let checking = false;
    const recover = async () => {
      if (checking) return;
      checking = true;
      try {
        const me = await api<{ user: unknown }>('/api/me', {
          signal: AbortSignal.timeout(5000),
        });
        if (active && me.user) location.reload();
      } catch {
        // A transient network error must not cancel the pending Telegram confirmation.
      } finally {
        checking = false;
      }
    };
    window.addEventListener('focus', recover);
    const timer = setInterval(recover, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', recover);
    };
  }, [busy]);
  useEffect(() => {
    let active = true;
    setOptions(null);
    Promise.all([
      loadSdk(),
      api<Options>('/auth/telegram/init', {
        signal: AbortSignal.timeout(15000),
      }),
    ])
      .then(([, value]) => {
        if (active) setOptions(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <button
        className="telegram"
        disabled={busy || (!options && !error)}
        onClick={async () => {
          setError('');
          if (!options || !window.Telegram?.Login) {
            setAttempt((value) => value + 1);
            return;
          }
          setBusy(true);
          const controller = new AbortController();
          pending.current = controller;
          const timer = setTimeout(
            () =>
              controller.abort(
                Error(
                  'Telegram не передал результат входа за 2 минуты. Нажмите «Войти через Telegram» ещё раз.',
                ),
              ),
            120000,
          );
          try {
            const token = await telegramResult(
              (callback) =>
                window.Telegram!.Login.auth(
                  { ...options, scope: ['profile'], lang: 'ru' },
                  callback,
                ),
              controller.signal,
            );
            await api('/auth/telegram/complete', {
              method: 'POST',
              body: JSON.stringify({ id_token: token }),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
            });
            location.reload();
          } catch (e) {
            if (pending.current === controller) {
              setError((e as Error).message);
              setBusy(false);
              setAttempt((value) => value + 1);
            }
          } finally {
            clearTimeout(timer);
            window.Telegram?.Login.close();
            if (pending.current === controller) pending.current = null;
          }
        }}
      >
        {busy ? 'Подтвердите вход в Telegram…' : 'Войти через Telegram'}
      </button>
      {busy && (
        <>
          <p role="status">
            Если подтверждение уже пришло, а окно продолжает ждать, отмените попытку и войдите ещё
            раз.
          </p>
          <button
            onClick={() => pending.current?.abort(Error('Попытка отменена. Можно войти снова.'))}
          >
            Отменить вход
          </button>
        </>
      )}
    </>
  );
}
