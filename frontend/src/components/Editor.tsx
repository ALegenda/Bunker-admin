import { RichDescription } from './RichDescription.js';
import { useState, useEffect } from 'react';
import type { Workspace, Card } from '../../../shared/contracts.js';
import { useEditor } from '../useEditor.js';
import { CardForm, cardTypes } from './CardForm.js';
import { downloadDraft, api } from '../api.js';
import { fieldChanges } from '../../../shared/model.js';
export function Editor({ initial }: { initial: Workspace }) {
  const editor = useEditor(initial);
  const [selected, setSelected] = useState(initial.cards[0].id),
    [query, setQuery] = useState(''),
    [type, setType] = useState(''),
    [tab, setTab] = useState('text'),
    [history, setHistory] = useState<unknown[] | null>(null);
  const card = editor.cards.find((c) => c.id === selected)!;
  useEffect(() => {
    if (tab !== 'history') return;
    let active = true;
    setHistory(null);
    api<{ history: unknown[] }>('/api/cards/' + encodeURIComponent(selected) + '/history')
      .then((r) => {
        if (active) setHistory(r.history);
      })
      .catch((e) => {
        if (active) setHistory([{ error: e.message }]);
      });
    return () => {
      active = false;
    };
  }, [selected, tab, editor.dirty]);
  const filtered = editor.cards.filter(
    (c) =>
      (!type || c.cardType === type) &&
      c.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')),
  );
  return (
    <>
      <div className="heading">
        <div>
          <small>МАСТЕРСКАЯ ПРАВИЛ</small>
          <h1>Правила живут здесь.</h1>
          <p>Редактируйте карточки. Публикуйте готовую версию для игроков.</p>
        </div>
        <button onClick={() => downloadDraft(editor.cards)}>Скачать черновик</button>
      </div>
      <div className="status" role="status">
        {editor.status}
        {editor.dirty && <button onClick={editor.retry}>Сохранить сейчас</button>}
      </div>
      {editor.recovery && (
        <aside className="notice">
          Найдена браузерная копия предыдущих правок.{' '}
          <button onClick={() => downloadDraft(JSON.parse(editor.recovery!))}>Скачать копию</button>
          <button onClick={editor.dismissRecovery}>Скрыть</button>
        </aside>
      )}
      <div className="editor-layout">
        <aside className="panel sidebar">
          <label>
            Найти карточку
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название…"
            />
          </label>
          <select aria-label="Категория" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Всё содержание</option>
            {cardTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <div className="list-title">
            {filtered.length} карточек{' '}
            <button
              onClick={() => {
                const c: Card = {
                  id: crypto.randomUUID(),
                  name: 'Новая карточка',
                  cardType: 'умение',
                  description: '',
                  attributes: {
                    activationTime: [],
                    usageFrequency: '',
                    usageLocation: [],
                    tags: [],
                  },
                  image: '',
                  kind: 'Уточнение',
                  note: '',
                };
                editor.update(c);
                setSelected(c.id);
                setTab('text');
              }}
            >
              + Добавить
            </button>
          </div>
          <div className="card-list" id="card-list">
            {filtered.map((c) => (
              <button
                key={c.id}
                className={c.id === selected ? 'selected' : ''}
                onClick={() => {
                  setSelected(c.id);
                  setHistory(null);
                }}
              >
                {c.image ? (
                  <img src={c.image} alt="" loading="lazy" />
                ) : (
                  <span className="mini-placeholder">Б</span>
                )}
                <span>
                  {c.name}
                  <small>{c.cardType}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="panel card-editor">
          <div className="tabs">
            <button aria-pressed={tab === 'text'} onClick={() => setTab('text')}>
              Текст и изображение
            </button>
            <button aria-pressed={tab === 'diff'} onClick={() => setTab('diff')}>
              Изменения
            </button>
            <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>
              История
            </button>
          </div>
          {tab === 'text' ? (
            <CardForm
              key={card.id}
              card={card}
              onChange={editor.update}
              onImage={editor.updateImage}
            />
          ) : tab === 'diff' ? (
            <>
              <h2>{card.name}</h2>
              {fieldChanges(
                card,
                initial.base.find((c) => c.id === card.id),
              ).map((d) => (
                <article className="difference" key={d.field}>
                  <h3>{d.label}</h3>
                  <del>
                    {d.field === 'description' ? (
                      <RichDescription value={String(d.before ?? '')} />
                    ) : typeof d.before === 'object' ? (
                      JSON.stringify(d.before)
                    ) : (
                      String(d.before ?? '—')
                    )}
                  </del>
                  <ins>
                    {d.field === 'description' ? (
                      <RichDescription value={String(d.after ?? '')} />
                    ) : typeof d.after === 'object' ? (
                      JSON.stringify(d.after)
                    ) : (
                      String(d.after ?? '—')
                    )}
                  </ins>
                </article>
              ))}
            </>
          ) : (
            <>
              <h2>История сохранений</h2>
              {history === null ? (
                <p>Загружаем…</p>
              ) : history.length ? (
                history.map((h: any) => (
                  <details key={h.id}>
                    <summary>
                      {new Date(h.created_at).toLocaleString('ru')} ·{' '}
                      {h.display_name || 'Администратор'}
                    </summary>
                    <RichDescription value={h.after_data?.description || h.error || ''} />
                  </details>
                ))
              ) : (
                <p>Новых сохранений пока нет.</p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
