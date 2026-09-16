import { RichDescription } from './RichDescription.js';
import { useEffect, useState } from 'react';
import type { Proposal, User } from '../../../shared/contracts.js';
import { api, send } from '../api.js';
const labels = {
  pending: 'На рассмотрении',
  accepted: 'Принято в черновик',
  rejected: 'Отклонено',
  withdrawn: 'Отозвано',
};
export function Proposals({ user }: { user: User }) {
  const [items, setItems] = useState<Proposal[]>([]),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('pending'),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState('');
  const load = () =>
    api<{ proposals: Proposal[] }>('/api/proposals')
      .then((r) => setItems(r.proposals))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function action(p: Proposal, decision: string) {
    setBusy(p.id);
    setError('');
    try {
      await send('/api/proposals/' + p.id + (decision === 'withdrawn' ? '/withdraw' : '/review'), {
        decision,
        note: notes[p.id] || '',
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="heading">
        <div>
          <small>СОВМЕСТНАЯ ВЫЧИТКА</small>
          <h1>Предложения игроков.</h1>
          <p>Принятые правки попадут в каталог после публикации администратором.</p>
        </div>
      </div>
      <label>
        Статус
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Все предложения</option>
          {Object.entries(labels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {items
        .filter((p) => !filter || p.status === filter)
        .map((p) => (
          <article className="panel proposal" key={p.id}>
            <small>
              {labels[p.status]} · {p.author_name} ·{' '}
              {new Date(p.created_at).toLocaleDateString('ru')}
            </small>
            <h2>{p.proposed.name}</h2>
            <p>
              <strong>Комментарий:</strong> {p.reason}
            </p>
            <div className="proposal-diff">
              {p.base && (
                <section>
                  <h3>Опубликовано</h3>
                  <RichDescription value={p.base.description} />
                </section>
              )}
              <section>
                <h3>Предложено</h3>
                <RichDescription value={p.proposed.description} />
              </section>
            </div>
            {p.review_note && <p>Ответ администратора: {p.review_note}</p>}
            {p.status === 'pending' &&
              (user.role === 'admin' ? (
                <>
                  <label>
                    Ответ игроку
                    <textarea
                      maxLength={3000}
                      value={notes[p.id] || ''}
                      onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
                    />
                  </label>
                  <button
                    disabled={busy === p.id}
                    className="primary"
                    onClick={() => action(p, 'accepted')}
                  >
                    Принять в черновик
                  </button>{' '}
                  <button disabled={busy === p.id} onClick={() => action(p, 'rejected')}>
                    Отклонить
                  </button>
                </>
              ) : (
                <button disabled={busy === p.id} onClick={() => action(p, 'withdrawn')}>
                  Отозвать предложение
                </button>
              ))}
          </article>
        ))}
      {!items.some((p) => !filter || p.status === filter) && (
        <p className="panel">Предложений с таким статусом пока нет.</p>
      )}
    </>
  );
}
