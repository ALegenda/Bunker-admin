import { CardAttributes, CardAttributeFilters } from './CardAttributes.js';
import { matchesCard } from '../card-attributes.js';
import { descriptionText } from '../../../shared/rich-text.js';
import { DescriptionEditor } from './DescriptionEditor.js';
import { CardTips } from './CardTips.js';
import { RichDescription } from './RichDescription.js';
import { useEffect, useMemo, useState } from 'react';
import type { Catalog as CatalogData, PublicCard, User } from '../../../shared/contracts.js';
import { api, send } from '../api.js';
import { cardTypes } from './CardForm.js';
export function Catalog({ user }: { user: User | null }) {
  const [data, setData] = useState<CatalogData | null>(null),
    [error, setError] = useState('');
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [query, setQuery] = useState(params.get('q') || ''),
    [type, setType] = useState(params.get('type') || ''),
    [tags, setTags] = useState<string[]>(params.getAll('tag')),
    [time, setTime] = useState(params.get('time') || ''),
    [place, setPlace] = useState(params.get('place') || ''),
    [frequency, setFrequency] = useState(params.get('frequency') || ''),
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
    for (const t of tags) p.append('tag', t);
    if (time) p.set('time', time);
    if (place) p.set('place', place);
    if (frequency) p.set('frequency', frequency);
    if (selected) p.set('card', selected);
    history.replaceState(null, '', '/?' + p);
  }, [query, type, tags, time, place, frequency, selected]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Загружаем карточки…</p>;
  const attributes = {
    tags,
    activationTime: time ? [time] : [],
    usageLocation: place ? [place] : [],
    usageFrequency: frequency ? [frequency] : [],
  };
  const visible = data.cards.filter((c) => matchesCard(c, query, type, attributes));
  const card = data.cards.find((c) => c.id === selected),
    trusted = user?.role === 'trusted' || user?.role === 'admin';
  return (
    <>
      <div className="heading">
        <div>
          <small>СПРАВОЧНИК ИГРОКА · {data.title}</small>
          <h1>Знай свои возможности.</h1>
          <p>Карточки, правила и ответы на вопросы — до игры и за столом.</p>
        </div>
        {trusted && <button onClick={() => setPropose(null)}>Предложить новую карточку</button>}
      </div>
      <div className="catalog-layout">
        <aside className="panel filters">
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
          <CardAttributeFilters
            cards={data.cards}
            value={attributes}
            onChange={(value) => {
              setTags(value.tags);
              setTime(value.activationTime[0] || '');
              setPlace(value.usageLocation[0] || '');
              setFrequency(value.usageFrequency[0] || '');
            }}
          />
          <button
            onClick={() => {
              setQuery('');
              setType('');
              setTags([]);
              setTime('');
              setPlace('');
              setFrequency('');
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
        <section>
          <p role="status">Найдено: {visible.length}</p>
          <div className="catalog-grid">
            {visible.map((c) => (
              <button className="catalog-card" key={c.id} onClick={() => setSelected(c.id)}>
                {c.image ? (
                  <img src={c.image} alt="" loading="lazy" />
                ) : (
                  <div className="placeholder">Б</div>
                )}
                <div>
                  <small>{c.cardType}</small>
                  <h2>{c.name}</h2>
                  <p>
                    {descriptionText(c.description).slice(0, 140)}
                    {descriptionText(c.description).length > 140 ? '…' : ''}
                  </p>
                  <CardAttributes card={c} />
                </div>
              </button>
            ))}
          </div>
          {!visible.length && (
            <div className="panel">
              Нет карточек с такими условиями. Попробуйте убрать часть фильтров.
            </div>
          )}
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
      {propose && <button onClick={propose}>Предложить правку описания</button>}
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
function ProposalForm({ card, close }: { card: PublicCard | null; close: () => void }) {
  const [name, setName] = useState(card?.name || ''),
    [type, setType] = useState(card?.cardType || 'умение'),
    [text, setText] = useState(card?.description || ''),
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
              disabled={Boolean(card)}
              value={name}
              maxLength={250}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {!card && (
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
          )}
          <DescriptionEditor label="Предлагаемое описание" value={text} onChange={setText} />
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
