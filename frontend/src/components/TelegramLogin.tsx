import React, { useEffect, useState } from 'react';
import { api, send } from '../api.js';

type Options = { client_id: number; nonce: string };
type LoginResult = { id_token?: string; error?: string };
declare global {
  interface Window {
    Telegram?: {
      Login: {
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
    script.src = 'https://oauth.telegram.org/js/telegram-login.js?6';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdk = undefined;
      script.remove();
      reject(Error('Не удалось загрузить Telegram. Проверьте соединение.'));
    };
    document.head.appendChild(script);
  }));
}
export function TelegramLogin() {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setOptions(null);
    Promise.all([loadSdk(), api<Options>('/auth/telegram/init')])
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
        onClick={() => {
          setError('');
          if (!options || !window.Telegram?.Login) {
            setAttempt((value) => value + 1);
            return;
          }
          setBusy(true);
          window.Telegram.Login.auth(
            { ...options, scope: ['profile'], lang: 'ru' },
            async (result) => {
              try {
                if (!result?.id_token) throw Error('Вход не завершён. Попробуйте снова.');
                await send('/auth/telegram/complete', { id_token: result.id_token });
                location.reload();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
                setAttempt((value) => value + 1);
              }
            },
          );
        }}
      >
        {busy ? 'Подтвердите вход в Telegram…' : 'Войти через Telegram'}
      </button>
    </>
  );
}
