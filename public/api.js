export async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || 'Ошибка сервера');
    error.status = response.status;
    throw error;
  }
  return value;
}
const BACKUP = 'bunker-server-backup-v1';
export async function openWorkspace() {
  let state = await request('/api/workspace');
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem('bunker-draft-v1'));
  } catch {}
  if (state.revision === 0 && !state.legacyImported && Array.isArray(legacy?.cards)) {
    const ids = new Set(legacy.cards.map((c) => c.id));
    const draft = {
      ...legacy,
      cards: [...legacy.cards, ...state.cards.filter((c) => !ids.has(c.id))],
      changelogStamp: '',
    };
    await request('/api/import/legacy', {
      method: 'POST',
      body: JSON.stringify({ revision: 0, draft }),
    });
    state = await request('/api/workspace');
    localStorage.setItem('bunker-legacy-merged-v1', 'true');
  }
  let backup;
  try {
    backup = JSON.parse(localStorage.getItem(BACKUP));
  } catch {}
  const conflict = backup?.dirty && backup.revision !== state.revision;
  if (conflict) {
    localStorage.setItem('bunker-conflict-backup-' + Date.now(), JSON.stringify(backup));
  }

  return {
    ...state,
    recovery: backup?.dirty && backup.revision === state.revision ? backup.draft : null,
    conflictingBackup: conflict ? backup : null,
  };
}
export function createSaver(revision, onState) {
  let pending = null,
    inflight = null,
    timer = null,
    blocked = false,
    last = null;
  const backup = (dirty) => {
    try {
      localStorage.setItem(BACKUP, JSON.stringify({ revision, draft: last, dirty }));
    } catch {
      onState('error', 'Не удалось записать резервную копию. Скачайте черновик.');
    }
  };
  async function flush() {
    clearTimeout(timer);
    if (blocked)
      throw Error('Сохранение остановлено из-за конфликта. Скачайте черновик перед обновлением.');
    if (inflight) {
      await inflight;
      if (pending) return flush();
      return;
    }
    if (!pending) return;
    const snapshot = pending;
    pending = null;
    onState('saving');
    inflight = request('/api/workspace', {
      method: 'PUT',
      body: JSON.stringify({ revision, draft: snapshot }),
    })
      .then((result) => {
        revision = result.revision;
        backup(Boolean(pending));
        onState(pending ? 'saving' : 'saved');
      })
      .catch((error) => {
        pending ??= snapshot;
        backup(true);
        blocked = error.status === 409;
        onState(blocked ? 'conflict' : 'error', error.message);
        if (!blocked && (!error.status || error.status >= 500))
          timer = setTimeout(() => flush().catch(() => {}), 3000);
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
    await inflight;
    if (pending) return flush();
  }
  return {
    get revision() {
      return revision;
    },
    get dirty() {
      return Boolean(pending || inflight);
    },
    update(draft) {
      last = structuredClone(draft);
      pending = last;
      backup(true);
      onState('saving');
      clearTimeout(timer);
      timer = setTimeout(() => flush().catch(() => {}), 700);
    },
    flush,
  };
}
export async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  return request('/api/assets', { method: 'POST', body: form });
}
