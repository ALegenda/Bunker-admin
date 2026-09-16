export type LoginResult = { id_token?: string; error?: string };

// A popup can stay open without ever delivering a callback (or be blocked entirely).
export function telegramResult(
  open: (callback: (result: LoginResult) => void) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (token?: string, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (token) resolve(token);
      else reject(error);
    };
    const abort = () => finish(undefined, signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      open((result) => {
        if (result?.id_token) finish(result.id_token);
        else finish(undefined, Error('Вход не завершён. Попробуйте снова.'));
      });
    } catch (error) {
      finish(undefined, error);
    }
  });
}
