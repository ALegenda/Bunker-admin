import { useEffect, useRef, useState } from 'react';
import type { Card, Workspace } from '../../shared/contracts.js';
import { api, send, ApiError } from './api.js';
const backupKey = 'bunker-component-draft-v1';
export function useEditor(initial: Workspace) {
  const [cards, setCards] = useState(initial.cards),
    [base, setBase] = useState(initial.base),
    [status, setStatus] = useState('Сохранено в базе'),
    [dirty, setDirty] = useState(false),
    [resetting, setResetting] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(() => {
    try {
      return localStorage.getItem(backupKey);
    } catch {
      return null;
    }
  });
  const state = useRef({
    cards: initial.cards,
    versions: { ...initial.versions },
    pending: new Map<string, Card | null>(),
    running: false,
    blocked: false,
    conflict: false,
    timer: 0,
  });
  function backup() {
    try {
      localStorage.setItem(
        backupKey,
        JSON.stringify({
          cards: state.current.cards,
          versions: state.current.versions,
          pending: [...state.current.pending.keys()],
        }),
      );
    } catch {
      setStatus('Не удалось сохранить копию в браузере — скачайте черновик');
    }
  }
  async function flush() {
    const s = state.current;
    if (s.running || s.blocked) return;
    s.running = true;
    try {
      while (s.pending.size) {
        const [id, card] = s.pending.entries().next().value!;
        if (card === null) setResetting(true);
        setStatus('Сохраняем…');
        const result = await send<{ version: number | null; card: Card | null }>(
          '/api/cards/' + encodeURIComponent(id) + (card === null ? '/reset' : ''),
          { ...(card === null ? {} : { card }), version: s.versions[id] ?? null },
          card === null ? 'POST' : 'PUT',
        );
        if (result.version === null) delete s.versions[id];
        else s.versions[id] = result.version;
        if (card === null && s.pending.get(id) === null) {
          s.cards = result.card
            ? s.cards.map((c) => (c.id === id ? result.card! : c))
            : s.cards.filter((c) => c.id !== id);
          setCards(s.cards);
          setBase((previous) => [
            ...previous.filter((c) => c.id !== id),
            ...(result.card ? [result.card] : []),
          ]);
        }
        if (s.pending.get(id) === card) s.pending.delete(id);
        backup();
      }
      setDirty(false);
      setStatus('Сохранено в базе');
      localStorage.removeItem(backupKey);
    } catch (e) {
      s.blocked = true;
      s.conflict = e instanceof ApiError && e.status === 409;
      setStatus((e as Error).message + ' Ваши правки сохранены в браузере.');
      backup();
    } finally {
      s.running = false;
      setResetting(false);
    }
  }
  function update(card: Card) {
    const s = state.current;
    s.cards = s.cards.some((c) => c.id === card.id)
      ? s.cards.map((c) => (c.id === card.id ? card : c))
      : [...s.cards, card];
    s.pending.set(card.id, card);
    if (!s.conflict) s.blocked = false;
    setCards(s.cards);
    setDirty(true);
    setStatus('Есть несохранённые правки');
    backup();
    clearTimeout(s.timer);
    s.timer = window.setTimeout(flush, 700);
  }
  function updateImage(id: string, image: string) {
    if (state.current.pending.get(id) === null) return;
    const card = state.current.cards.find((c) => c.id === id);
    if (card) update({ ...card, image });
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state.current.pending.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearTimeout(state.current.timer);
    };
  }, []);
  return {
    cards,
    base,
    status,
    dirty,
    resetting,
    recovery,
    update,
    updateImage,
    reset: (id: string) => {
      const s = state.current;
      s.pending.set(id, null);
      if (!s.conflict) s.blocked = false;
      setDirty(true);
      setResetting(true);
      backup();
      clearTimeout(s.timer);
      if (s.blocked) setResetting(false);
      else void flush();
    },
    retry: () => {
      state.current.blocked = false;
      void flush();
    },
    dismissRecovery: () => setRecovery(null),
  };
}
export async function loadWorkspace() {
  return api<Workspace>('/api/workspace');
}
