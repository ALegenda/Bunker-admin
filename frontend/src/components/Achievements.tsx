import React, { useEffect, useState } from 'react';
import type { AchievementDefinition } from '../../../shared/contracts.js';
import { api, send } from '../api.js';
export function Achievements() {
  const [items, setItems] = useState<AchievementDefinition[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AchievementDefinition | null>(null),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [target, setTarget] = useState(1),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState('');
  const load = async () => {
    setError('');
    try {
      setItems(
        (await api<{ achievements: AchievementDefinition[] }>('/api/achievements')).achievements,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const edit = (a: AchievementDefinition | null) => {
    setEditing(a);
    setTitle(a?.title || '');
    setDescription(a?.description || '');
    setTarget(a?.target || 1);
    setSaved('');
  };
  return (
    <div className="profile-page">
      <div className="heading">
        <div>
          <small>КАТАЛОГ НАГРАД</small>
          <h1>Достижения.</h1>
          <p>Создайте достижение, затем назначьте его игроку и укажите текущий прогресс.</p>
        </div>
        <a href="/users">Перейти к игрокам →</a>
      </div>
      <section className="panel">
        <h2>{editing ? 'Редактирование достижения' : 'Новое достижение'}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setSaved('');
            try {
              const result = await send<AchievementDefinition>(
                editing ? '/api/achievements/' + editing.id : '/api/achievements',
                { title, description, target, ...(editing ? { revision: editing.revision } : {}) },
                editing ? 'PATCH' : 'POST',
              );
              setItems((old) =>
                editing ? old.map((a) => (a.id === result.id ? result : a)) : [...old, result],
              );
              edit(null);
              setSaved(
                'Достижение сохранено в каталоге. Теперь его можно выбрать в профиле игрока.',
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="profile-controls" disabled={busy}>
            <label>
              Название
              <input
                required
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ветеран бункера"
              />
            </label>
            <label>
              Условие получения
              <textarea
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Сыграть 100 игр"
              />
            </label>
            <label>
              Цель
              <input
                type="number"
                min={1}
                max={1000000}
                required
                value={Number.isNaN(target) ? '' : target}
                onChange={(e) => setTarget(e.target.valueAsNumber)}
              />
            </label>
            <p className="muted">
              Например, цель 100 для ста игр или 1 для разовой награды. Прогресс задаётся вручную в
              профиле игрока.
            </p>
            {editing && (
              <p className="notice">
                Изменения применятся к будущим назначениям. У уже назначенных достижений сохранятся
                прежние название, условие и цель.
              </p>
            )}
            <button className="primary" disabled={!title.trim()}>
              {busy ? 'Сохраняем…' : editing ? 'Сохранить изменения' : 'Создать достижение'}
            </button>
            {editing && (
              <button type="button" onClick={() => edit(null)}>
                Отменить редактирование
              </button>
            )}
          </fieldset>
        </form>
        {saved && <p role="status">{saved}</p>}
        {error && (
          <p role="alert">
            {error}{' '}
            <button
              onClick={() => {
                edit(null);
                void load();
              }}
            >
              Обновить каталог
            </button>
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Каталог достижений</h2>
        {loading ? (
          <p role="status">Загружаем…</p>
        ) : (
          !items.length && <p>Достижений пока нет. Создайте первое выше.</p>
        )}
        {items.map((a) => (
          <article className="achievement" key={a.id}>
            <h3>{a.title}</h3>
            <p>{a.description}</p>
            <p>Цель: {a.target}</p>
            <button disabled={busy} onClick={() => edit(a)}>
              Редактировать «{a.title}»
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
