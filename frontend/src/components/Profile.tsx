import React, { useEffect, useState } from 'react';
import type {
  Achievement,
  AchievementDefinition,
  PlayerProfile,
  ProfileResponse,
} from '../../../shared/contracts.js';
import {
  achievementComplete,
  achievementProgress,
  achievementTarget,
} from '../../../shared/achievements.js';
import { api, send } from '../api.js';

const roles = { player: 'Игрок', trusted: 'Доверенный игрок', admin: 'Администратор' };
export function ProfileStats({ profile }: { profile: PlayerProfile }) {
  return (
    <>
      <div className="profile-stats">
        <section className="panel">
          <small>УРОВЕНЬ</small>
          <strong>{profile.level.toLocaleString('ru')}</strong>
          <p>Ваш игровой уровень</p>
        </section>
        <section className="panel">
          <small>ИГРОВАЯ ВАЛЮТА</small>
          <strong>{profile.balance.toLocaleString('ru')}</strong>
          <p>Текущий баланс</p>
        </section>
        <section className="panel">
          <small>ДОСТИЖЕНИЯ</small>
          <strong>{profile.achievements.filter(achievementComplete).length}</strong>
          <p>Получено за игру</p>
        </section>
      </div>
      <section className="panel">
        <h2>Достижения</h2>
        {profile.achievements.length ? (
          <div className="achievement-grid">
            {profile.achievements.map((a) => (
              <article className="achievement" key={a.id}>
                <h3>{a.title}</h3>
                <p>{a.description}</p>
                <p>
                  {achievementComplete(a) ? 'Получено' : 'В процессе'} · {achievementProgress(a)} /{' '}
                  {achievementTarget(a)}
                </p>
                <progress
                  aria-label={'Прогресс: ' + a.title}
                  value={achievementProgress(a)}
                  max={achievementTarget(a)}
                />
                {a.awardedAt && (
                  <small>Получено {new Date(a.awardedAt).toLocaleDateString('ru')}</small>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Пока нет достижений. Здесь появятся ваши награды.</p>
        )}
      </section>
    </>
  );
}
export function ProgressHistory({ history }: Pick<ProfileResponse, 'history'>) {
  return (
    <section className="panel">
      <h2>История начислений</h2>
      <p className="muted">
        Уровень, валюту и достижения назначает администратор. Показаны последние 100 изменений.
      </p>
      {!history.length && <p>Начислений пока нет.</p>}
      {history.map((h) => {
        const delta = h.after_data.balance - h.before_data.balance;
        const added = h.after_data.achievements.filter(
          (a) => !h.before_data.achievements.some((b) => b.id === a.id),
        );
        const removed = h.before_data.achievements.filter(
          (a) => !h.after_data.achievements.some((b) => b.id === a.id),
        );
        const changed = h.after_data.achievements.filter((a) =>
          h.before_data.achievements.some(
            (b) => b.id === a.id && JSON.stringify(b) !== JSON.stringify(a),
          ),
        );
        return (
          <article className="progress-entry" key={h.id}>
            <small>{new Date(h.created_at).toLocaleString('ru')}</small>
            <p>{h.after_data.reason}</p>
            {delta !== 0 && (
              <p>
                Валюта: {delta > 0 ? '+' : ''}
                {delta.toLocaleString('ru')} · Баланс: {h.after_data.balance.toLocaleString('ru')}
              </p>
            )}
            {h.before_data.level !== h.after_data.level && (
              <p>
                Уровень: {h.before_data.level} → {h.after_data.level}
              </p>
            )}
            {added.map((a) => (
              <p key={a.id}>
                {achievementComplete(a) ? 'Получено достижение' : 'Начато достижение'}: {a.title} ·{' '}
                {achievementProgress(a)} / {achievementTarget(a)}
              </p>
            ))}
            {removed.map((a) => (
              <p key={a.id}>
                {achievementComplete(a) ? 'Отозвано достижение' : 'Убрано достижение'}: {a.title}
              </p>
            ))}
            {changed.map((a) => {
              const previous = h.before_data.achievements.find((b) => b.id === a.id)!;
              return (
                <p key={a.id}>
                  {a.title}: {achievementProgress(previous)} / {achievementTarget(previous)} →{' '}
                  {achievementProgress(a)} / {achievementTarget(a)}
                  {achievementComplete(a) && !achievementComplete(previous)
                    ? ' · Достижение получено'
                    : !achievementComplete(a) && achievementComplete(previous)
                      ? ' · Снова в процессе'
                      : ''}
                </p>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}
export function Profile({ onNameChange }: { onNameChange: (name: string) => void }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [name, setName] = useState(''),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const load = () => {
    setError('');
    api<ProfileResponse>('/api/profile')
      .then((r) => {
        setData(r);
        setName(r.profile.name);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  if (!data)
    return error ? (
      <div role="alert">
        {error} <button onClick={load}>Повторить</button>
      </div>
    ) : (
      <p role="status">Загружаем профиль…</p>
    );
  return (
    <div className="profile-page">
      <div className="heading">
        <div>
          <small>ЛИЧНЫЙ ПРОФИЛЬ · {roles[data.profile.role]}</small>
          <h1>{data.profile.name}</h1>
          <p>Ваше имя в сообществе и достижения за игровым столом.</p>
        </div>
      </div>
      <section className="panel">
        <h2>Как вас зовут в игре?</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setSaved(false);
            try {
              const r = await send<ProfileResponse>('/api/profile', { name }, 'PATCH');
              setData(r);
              setName(r.profile.name);
              onNameChange(r.profile.name);
              setSaved(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Отображаемое имя
            <input
              required
              maxLength={80}
              value={name}
              placeholder={'Таня "Фонтанчик"'}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <p className="muted">
            Это имя увидят рядом с вашими советами и предложениями. Сам профиль доступен только вам
            и администратору.
          </p>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? 'Сохраняем…' : 'Сохранить имя'}
          </button>
          {saved && <p role="status">Имя сохранено.</p>}
          {error && <p role="alert">{error}</p>}
        </form>
      </section>
      <ProfileStats profile={data.profile} />
      <ProgressHistory history={data.history} />
    </div>
  );
}

export function ManageProfile({ userId }: { userId: string }) {
  const [data, setData] = useState<ProfileResponse | null>(null),
    [error, setError] = useState('');
  const [level, setLevel] = useState(1),
    [balance, setBalance] = useState(0),
    [achievements, setAchievements] = useState<Achievement[]>([]);
  const [definitions, setDefinitions] = useState<AchievementDefinition[]>([]),
    [selected, setSelected] = useState(''),
    [catalogError, setCatalogError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const apply = (r: ProfileResponse) => {
    setData(r);
    setLevel(r.profile.level);
    setBalance(r.profile.balance);
    setAchievements(r.profile.achievements);
  };
  const load = () => {
    setError('');
    setSaved(false);
    api<ProfileResponse>('/api/users/' + userId + '/profile')
      .then(apply)
      .catch((e) => setError(e.message));
  };
  const loadCatalog = () => {
    setCatalogError('');
    api<{ achievements: AchievementDefinition[] }>('/api/achievements')
      .then((r) => setDefinitions(r.achievements))
      .catch((e) => setCatalogError(e.message));
  };
  useEffect(() => {
    load();
    loadCatalog();
  }, [userId]);
  if (!data)
    return error ? (
      <p role="alert">
        {error} <button onClick={load}>Повторить</button>
      </p>
    ) : (
      <p role="status">Загружаем профиль…</p>
    );
  return (
    <>
      <h3>{data.profile.name}</h3>
      <p className="muted">
        Укажите итоговый уровень и баланс. Изменения и причина появятся в истории игрока.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setSaved(false);
          try {
            apply(
              await send<ProfileResponse>(
                '/api/users/' + userId + '/profile',
                { revision: data.profile.revision, level, balance, achievements, reason },
                'PATCH',
              ),
            );
            setReason('');
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="profile-controls">
          <div className="fields">
            <label>
              Уровень
              <input
                type="number"
                min={1}
                max={1000000}
                required
                value={Number.isNaN(level) ? '' : level}
                onChange={(e) => {
                  setLevel(e.target.valueAsNumber);
                  setSaved(false);
                }}
              />
            </label>
            <label>
              Баланс валюты
              <input
                type="number"
                min={0}
                max={2147483647}
                required
                value={Number.isNaN(balance) ? '' : balance}
                onChange={(e) => {
                  setBalance(e.target.valueAsNumber);
                  setSaved(false);
                }}
              />
            </label>
          </div>
          <p>
            Изменение баланса:{' '}
            {Number.isFinite(balance)
              ? (balance - data.profile.balance).toLocaleString('ru', { signDisplay: 'always' })
              : '—'}
          </p>
          <h3>Достижения</h3>
          {!achievements.length && <p>Достижений пока нет.</p>}
          {achievements.map((a) => (
            <div className="achievement" key={a.id}>
              <strong>{a.title}</strong>
              <p>{a.description}</p>
              <label>
                Прогресс «{a.title}» (из {achievementTarget(a)})
                <input
                  type="number"
                  min={0}
                  max={achievementTarget(a)}
                  required
                  value={Number.isNaN(a.progress) ? '' : achievementProgress(a)}
                  onChange={(e) => {
                    setAchievements(
                      achievements.map((v) =>
                        v.id === a.id
                          ? { ...v, target: achievementTarget(v), progress: e.target.valueAsNumber }
                          : v,
                      ),
                    );
                    setSaved(false);
                  }}
                />
              </label>
              <p>
                {achievementComplete(a) ? 'Цель достигнута' : 'В процессе'} ·{' '}
                {achievementProgress(a)} / {achievementTarget(a)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setAchievements(achievements.filter((v) => v.id !== a.id));
                  setSaved(false);
                }}
              >
                Убрать «{a.title}»
              </button>
            </div>
          ))}
          <label>
            Добавить из каталога
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Выберите достижение</option>
              {definitions
                .filter((d) => !achievements.some((a) => a.id === d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} · цель {d.target}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selected || achievements.length >= 200}
            onClick={() => {
              const d = definitions.find((v) => v.id === selected);
              if (!d || achievements.some((a) => a.id === d.id)) return;
              setAchievements([
                ...achievements,
                {
                  id: d.id,
                  title: d.title,
                  description: d.description,
                  target: d.target,
                  progress: 0,
                  awardedAt: null,
                },
              ]);
              setSelected('');
              setSaved(false);
            }}
          >
            Добавить достижение игроку
          </button>
          <p className="muted">
            Новое достижение начинается с 0. Укажите текущий прогресс и сохраните показатели.{' '}
            <a href="/achievements" target="_blank" rel="noreferrer">
              Создать достижение в каталоге ↗
            </a>
          </p>
          <button type="button" onClick={loadCatalog}>
            Обновить каталог достижений
          </button>
          {catalogError && <p role="alert">{catalogError}</p>}
          <label>
            Причина изменения
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setSaved(false);
              }}
              placeholder="Например: участие и победа в игре 17 сентября"
            />
          </label>
          <button className="primary" disabled={!reason.trim() || Boolean(selected)}>
            {busy ? 'Сохраняем…' : 'Сохранить показатели'}
          </button>
          {selected && (
            <p>Добавьте выбранное достижение игроку или сбросьте выбор перед сохранением.</p>
          )}
          <button type="button" onClick={load}>
            Загрузить сохранённые показатели
          </button>
        </fieldset>
        {saved && <p role="status">Показатели сохранены.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
      <ProgressHistory history={data.history} />
    </>
  );
}
