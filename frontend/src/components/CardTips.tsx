import React, { useEffect, useState } from 'react';
import type { CardTip, User } from '../../../shared/contracts.js';
import { api, send } from '../api.js';

export const tipLabels = {
  pending: 'Для опытных игроков · ждёт проверки',
  published: 'Опубликован для всех',
  rejected: 'Отклонён',
};
export function TipItem({
  tip,
  moderation = false,
  reload,
  link = false,
}: {
  tip: CardTip;
  moderation?: boolean;
  reload?: () => Promise<void>;
  link?: boolean;
}) {
  const [note, setNote] = useState(tip.review_note || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function review(status: 'published' | 'rejected') {
    setBusy(true);
    setError('');
    try {
      await send('/api/tips/' + tip.id + '/review', { status, expectedStatus: tip.status, note });
      await reload?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="tip-item">
      {link && (
        <h2>
          <a href={'/catalog?card=' + encodeURIComponent(tip.card_id)}>{tip.card_name}</a>
        </h2>
      )}
      <div className="tip-meta">
        <strong>{tip.author_name}</strong>
        <small>{new Date(tip.created_at).toLocaleDateString('ru')}</small>
        <span className={'tip-status ' + tip.status}>{tipLabels[tip.status]}</span>
      </div>
      <p className="tip-body">{tip.body}</p>
      {tip.review_note && <p className="muted">Ответ администратора: {tip.review_note}</p>}
      {moderation && (
        <div>
          <label>
            Комментарий автору
            <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="tip-actions">
            {tip.status !== 'published' && (
              <button className="primary" disabled={busy} onClick={() => review('published')}>
                Опубликовать для всех
              </button>
            )}
            {tip.status !== 'rejected' && (
              <button disabled={busy} onClick={() => review('rejected')}>
                {tip.status === 'published' ? 'Снять с публикации' : 'Отклонить'}
              </button>
            )}
          </div>
          {error && (
            <p role="alert">
              {error}{' '}
              <button
                disabled={busy}
                onClick={() => {
                  void reload?.();
                }}
              >
                Обновить список
              </button>
            </p>
          )}
        </div>
      )}
    </article>
  );
}
export function CardTips({ cardId, user }: { cardId: string; user: User | null }) {
  const [tips, setTips] = useState<CardTip[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [body, setBody] = useState(''),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  const trusted = user?.role === 'trusted' || user?.role === 'admin';
  const load = async () => {
    setError('');
    try {
      setTips(
        (await api<{ tips: CardTip[] }>('/api/catalog/' + encodeURIComponent(cardId) + '/tips'))
          .tips,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [cardId]);
  return (
    <section className="card-tips">
      <h2>Советы игроков</h2>
      <p className="muted">
        Практические советы по применению карточки. Советы игроков дополняют официальные правила.
      </p>
      {trusted && (
        <p className="notice">
          Новые советы видят опытные игроки. После одобрения администратора они станут доступны
          всем.
        </p>
      )}
      {loading ? (
        <p role="status">Загружаем советы…</p>
      ) : (
        !error &&
        !tips.length && (
          <p>
            {trusted
              ? 'Советов пока нет. Поделитесь своим опытом.'
              : 'Опубликованных советов пока нет.'}
          </p>
        )
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            onClick={() => {
              void load();
            }}
          >
            Повторить
          </button>
        </p>
      )}
      {tips.map((tip) => (
        <TipItem
          key={tip.id + tip.status}
          tip={tip}
          moderation={user?.role === 'admin'}
          reload={load}
        />
      ))}
      {trusted && user?.id ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setSent(false);
            try {
              await send('/api/catalog/' + encodeURIComponent(cardId) + '/tips', { body });
              setBody('');
              setSent(true);
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Ваш совет
            <textarea
              required
              maxLength={3000}
              rows={4}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setSent(false);
              }}
              placeholder="Когда пригодится карточка? Как лучше её использовать?"
            />
          </label>
          <p className="muted">
            Автор: {user.name}. Имя можно изменить в <a href="/profile">профиле</a>.
          </p>
          <button className="primary" disabled={busy || !body.trim()}>
            {busy ? 'Отправляем…' : 'Поделиться советом'}
          </button>
          {sent && (
            <p role="status">
              Совет доступен опытным игрокам и отправлен на проверку администратору.
            </p>
          )}
        </form>
      ) : (
        <p className="muted">Оставлять советы могут только авторизованные опытные игроки.</p>
      )}
    </section>
  );
}
export function TipsModeration() {
  const [tips, setTips] = useState<CardTip[]>([]),
    [filter, setFilter] = useState('pending'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = async () => {
    setError('');
    try {
      setTips((await api<{ tips: CardTip[] }>('/api/tips')).tips);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const visible = tips.filter((t) => t.status === filter);
  return (
    <>
      <div className="heading">
        <div>
          <small>МОДЕРАЦИЯ</small>
          <h1>Советы игроков.</h1>
          <p>Одобренные советы видны всем читателям рядом с карточкой.</p>
        </div>
      </div>
      <label>
        Статус
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {Object.entries(tipLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label} ({tips.filter((t) => t.status === key).length})
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            onClick={() => {
              void load();
            }}
          >
            Повторить
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">Загружаем советы…</p>
      ) : (
        !error && !visible.length && <p className="panel">Советов с таким статусом пока нет.</p>
      )}
      {visible.map((tip) => (
        <div className="panel" key={tip.id + tip.status}>
          <TipItem tip={tip} moderation reload={load} link />
        </div>
      ))}
    </>
  );
}
