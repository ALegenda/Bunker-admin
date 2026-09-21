import { CardAttributeFields } from './CardAttributeFields.js';
import { CardAttributes, CardAttributeFilters } from './CardAttributes.js';
import {
  emptyAttributeFilters,
  filtersFromParams,
  appendFilterParams,
} from '../card-attributes.js';
import { searchDocument } from '../card-search.js';
import { useCardSearch } from '../useCardSearch.js';
import { useCardWindow } from '../useCardWindow.js';
import type { AttributeFilters } from '../card-attributes.js';
import { CardTips } from './CardTips.js';
import { RichDescription } from './RichDescription.js';
import React, { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import type { Catalog as CatalogData, PublicCard, User } from '../../../shared/contracts.js';
import { api, send } from '../api.js';
import { cardTypes } from '../card-types.js';
const DescriptionEditor = lazy(() =>
  import('./DescriptionEditor.js').then((m) => ({ default: m.DescriptionEditor })),
);

export function Catalog({ user }: { user: User | null }) {
  const [data, setData] = useState<CatalogData | null>(null),
    [error, setError] = useState(''),
    [showFilters, setShowFilters] = useState(
      () => typeof window !== 'undefined' && window.matchMedia('(min-width: 800px)').matches,
    );
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [query, setQuery] = useState(params.get('q') || ''),
    [type, setType] = useState(params.get('type') || ''),
    [attributes, setAttributes] = useState(() => filtersFromParams(params)),
    [selected, setSelected] = useState(params.get('card') || ''),
    [propose, setPropose] = useState<PublicCard | null | false>(false);
  useEffect(() => {
    api<CatalogData>('/api/catalog')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (type) p.set('type', type);
    appendFilterParams(p, attributes);
    if (selected) p.set('card', selected);
    history.replaceState(null, '', '/catalog' + (p.size ? '?' + p : ''));
  }, [query, type, attributes, selected]);
  const results = useCardSearch(data?.cards, query, type, attributes);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Загружаем карточки…</p>;
  const card = data.cards.find((c) => c.id === selected),
    trusted = user?.role === 'trusted' || user?.role === 'admin';
  return (
    <>
      <div className="heading catalog-heading">
        <div>
          <small>СПРАВОЧНИК ИГРОКА · {data.title}</small>
          <h1>
            Знай свои <em>возможности.</em>
          </h1>
          <p>Карточки, правила и ответы на вопросы — до игры и за столом.</p>
        </div>
        {trusted && (
          <button className="primary" onClick={() => setPropose(null)}>
            Предложить новую карточку
          </button>
        )}
      </div>
      <div className="catalog-layout">
        <aside className="panel filters">
          <h2 className="panel-label">Найти свою карточку</h2>
          <label>
            Поиск
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название, текст или тег…"
            />
          </label>
          <label>
            Тип
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Все типы</option>
              {cardTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <details
            className="catalog-attribute-filter"
            open={showFilters}
            onToggle={(e) => setShowFilters(e.currentTarget.open)}
          >
            <summary>Характеристики · {Object.values(attributes).flat().length} выбрано</summary>
            <CardAttributeFilters cards={data.cards} value={attributes} onChange={setAttributes} />
          </details>
          <button
            onClick={() => {
              setQuery('');
              setType('');
              setAttributes(emptyAttributeFilters());
            }}
          >
            Сбросить фильтры
          </button>
          {data.releases[0] && (
            <p>
              <a href={'/releases/' + data.releases[0].id}>Что нового ↗</a>
            </p>
          )}
        </aside>
        <section className="catalog-results" aria-label="Карточки" aria-busy={results.pending}>
          <p className="catalog-count" role="status">
            {results.pending ? 'Ищем…' : `Найдено: ${results.cards.length}`}
            {!results.pending &&
              results.approximateCount > 0 &&
              ` · с учётом опечаток: ${results.approximateCount}`}
          </p>
          <CatalogResults cards={results.cards} attributes={attributes} onSelect={setSelected} />
        </section>
      </div>
      {card && (
        <CardDialog
          key={card.id}
          card={card}
          user={user}
          close={() => setSelected('')}
          propose={
            trusted
              ? () => {
                  setPropose(card);
                  setSelected('');
                }
              : undefined
          }
        />
      )}
      {propose !== false && <ProposalForm card={propose} close={() => setPropose(false)} />}
    </>
  );
}
const CatalogResults = memo(function CatalogResults({
  cards,
  attributes,
  onSelect,
}: {
  cards: PublicCard[];
  attributes: AttributeFilters;
  onSelect: (id: string) => void;
}) {
  const { visible, remaining, loadMoreRef } = useCardWindow(cards);
  return (
    <>
      <div className="catalog-grid">
        {visible.map((card) => (
          <CatalogTile key={card.id} card={card} attributes={attributes} onSelect={onSelect} />
        ))}
      </div>
      {remaining > 0 && (
        <div ref={loadMoreRef} className="card-autoload" role="status">
          Подгружаем карточки…
        </div>
      )}
      {!cards.length && (
        <div className="panel">
          Нет карточек с такими условиями. Попробуйте изменить запрос или убрать часть фильтров.
        </div>
      )}
    </>
  );
});
const CatalogTile = memo(function CatalogTile({
  card,
  attributes,
  onSelect,
}: {
  card: PublicCard;
  attributes: AttributeFilters;
  onSelect: (id: string) => void;
}) {
  const { description } = searchDocument(card);
  return (
    <article className="catalog-card" data-card-type={card.cardType}>
      <button
        className="catalog-card-open"
        onClick={() => onSelect(card.id)}
        aria-label={`Открыть карточку «${card.name}»`}
      >
        <div className="catalog-card-art">
          <span className="catalog-card-type">{card.cardType}</span>
          {card.image ? (
            <img src={card.image} alt="" loading="lazy" />
          ) : (
            <span className="placeholder" aria-hidden="true">
              Б
            </span>
          )}
          <span className="catalog-card-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
        <div className="catalog-card-copy">
          <h2>{card.name}</h2>
          <p>
            {description.slice(0, 140)}
            {description.length > 140 ? '…' : ''}
          </p>
        </div>
      </button>
      <CardAttributes card={card} compact selected={attributes} />
    </article>
  );
});

function CardDialog({
  card,
  user,
  close,
  propose,
}: {
  card: PublicCard;
  user: User | null;
  close: () => void;
  propose?: () => void;
}) {
  return (
    <Modal title={card.name} close={close}>
      <div className="art-text">
        {card.image && <img className="card-art" src={card.image} alt={card.name} />}
        <RichDescription value={card.description} />
      </div>
      <CardAttributes card={card} />
      {propose && <button onClick={propose}>Предложить правку</button>}
      <p>
        <button onClick={() => navigator.clipboard.writeText(location.href)}>
          Скопировать ссылку на карточку
        </button>
      </p>
      <CardTips cardId={card.id} user={user} />
    </Modal>
  );
}
import { useRef } from 'react';
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <button onClick={close} aria-label="Закрыть">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ProposalForm({ card, close }: { card: PublicCard | null; close: () => void }) {
  const [name, setName] = useState(card?.name || ''),
    [type, setType] = useState(card?.cardType || 'умение'),
    [text, setText] = useState(card?.description || ''),
    [attributes, setAttributes] = useState<PublicCard['attributes']>(
      card?.attributes || {
        activationTime: [],
        usageFrequency: '',
        usageLocation: [],
        tags: [],
      },
    ),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <Modal title={card ? 'Предложить правку' : 'Новая карточка'} close={close}>
      {done ? (
        <p role="status">
          Предложение отправлено администратору. Его статус появится в разделе «Предложения».
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await send('/api/proposals', {
                cardId: card?.id || null,
                name,
                cardType: type,
                description: text,
                attributes,
                reason,
              });
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Название
            <input
              required
              value={name}
              maxLength={250}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Тип
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PublicCard['cardType'])}
            >
              {cardTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <Suspense fallback={<p role="status">Загружаем редактор…</p>}>
            <DescriptionEditor label="Предлагаемое описание" value={text} onChange={setText} />
          </Suspense>
          <CardAttributeFields value={attributes} onChange={setAttributes} />
          <label>
            Почему стоит изменить
            <textarea
              required
              rows={3}
              maxLength={3000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Отправить на рассмотрение
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </Modal>
  );
}
