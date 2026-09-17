import { CardAttributes, CardAttributeFilters } from './CardAttributes.js';
import { emptyAttributeFilters, matchesCard } from '../card-attributes.js';
import { RichDescription } from './RichDescription.js';
import { useState, useEffect } from 'react';
import type { Workspace, Card, CardHistoryEntry } from '../../../shared/contracts.js';
import { CardHistory } from './CardHistory.js';
import { useEditor } from '../useEditor.js';
import { CardForm, cardTypes } from './CardForm.js';
import { downloadDraft, api } from '../api.js';
import { fieldChanges } from '../../../shared/model.js';
export function Editor({ initial }: { initial: Workspace }) {
  const editor = useEditor(initial);
  const [selected, setSelected] = useState(initial.cards[0]?.id || ''),
    [query, setQuery] = useState(''),
    [type, setType] = useState(''),
    [attributes, setAttributes] = useState(emptyAttributeFilters),
    [tab, setTab] = useState('text'),
    [history, setHistory] = useState<CardHistoryEntry[] | null>(null),
    [historyError, setHistoryError] = useState(''),
    [historyRetry, setHistoryRetry] = useState(0);
  const card = editor.cards.find((c) => c.id === selected) || editor.cards[0];
  useEffect(() => {
    if (card && card.id !== selected) setSelected(card.id);
  }, [card?.id, selected]);
  const baseline = editor.base.find((c) => c.id === card?.id);
  const canReset =
    card &&
    (!baseline ||
      fieldChanges(card, baseline).length > 0 ||
      card.note !== baseline.note ||
      card.kind !== baseline.kind);
  useEffect(() => {
    if (tab !== 'history') return;
    let active = true;
    setHistory(null);
    setHistoryError('');
    api<{ history: CardHistoryEntry[] }>('/api/cards/' + encodeURIComponent(selected) + '/history')
      .then((r) => {
        if (active) setHistory(r.history);
      })
      .catch((e) => {
        if (active) setHistoryError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected, tab, historyRetry]);
  const filtered = editor.cards.filter((c) => matchesCard(c, query, type, attributes));
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
      <fieldset
        disabled={editor.resetting}
        inert={editor.resetting}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div className="editor-layout">
          <aside className="panel sidebar">
            <label>
              Найти карточку
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название, текст или тег…"
              />
            </label>
            <select aria-label="Категория" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Всё содержание</option>
              {cardTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <details className="editor-filters">
              <summary>Характеристики · выбрано {Object.values(attributes).flat().length}</summary>
              <CardAttributeFilters
                cards={editor.cards}
                value={attributes}
                onChange={setAttributes}
              />
            </details>
            {(query || type || Object.values(attributes).some((values) => values.length)) && (
              <button
                onClick={() => {
                  setQuery('');
                  setType('');
                  setAttributes(emptyAttributeFilters());
                }}
              >
                Сбросить фильтры
              </button>
            )}
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
            {!filtered.length && <p role="status">Нет карточек с такими условиями.</p>}
            <div className="card-list" id="card-list">
              {filtered.map((c) => (
                <div className="card-list-item" key={c.id}>
                  <button
                    className={c.id === selected ? 'selected' : ''}
                    onClick={() => {
                      setSelected(c.id);
                      if (c.id !== selected) {
                        setHistory(null);
                        setHistoryError('');
                      }
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
                  <CardAttributes card={c} compact selected={attributes} />
                </div>
              ))}
            </div>
          </aside>
          <section className="panel card-editor">
            <div className="tabs">
              <button aria-pressed={tab === 'text'} onClick={() => setTab('text')}>
                Текст и изображение
              </button>
              <button aria-pressed={tab === 'diff'} onClick={() => setTab('diff')}>
                Изменения к выпуску
              </button>
              <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>
                История публикаций
              </button>
            </div>
            {card && canReset && (
              <div className="notice">
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        baseline
                          ? `Отменить все правки карточки «${card.name}» и вернуть актуальную версию правил? Комментарий также будет восстановлен.`
                          : `Удалить новую карточку «${card.name}» из черновика? Она ещё не опубликована.`,
                      )
                    ) {
                      editor.reset(card.id);
                    }
                  }}
                >
                  {baseline ? 'Отменить изменения карточки' : 'Удалить из черновика'}
                </button>
                {editor.resetting && <span role="status">Возвращаем актуальную версию…</span>}
              </div>
            )}
            {!card ? (
              <p>В черновике нет карточек.</p>
            ) : tab === 'text' ? (
              <CardForm
                key={card.id + ':' + editor.resetting}
                card={card}
                onChange={editor.update}
                onImage={editor.updateImage}
              />
            ) : tab === 'diff' ? (
              <>
                <h2>{card.name}</h2>
                {fieldChanges(card, baseline).map((d) => (
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
              <CardHistory
                entries={history}
                error={historyError}
                onRetry={() => setHistoryRetry((value) => value + 1)}
              />
            )}
          </section>
        </div>
      </fieldset>
    </>
  );
}
