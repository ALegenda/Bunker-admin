import React, { useState } from 'react';
import type { PublicCard } from '../../../shared/contracts.js';
import { cardColors } from '../../../shared/card-metadata.js';
import {
  colorForLabel,
  effectNotes,
  normalizeAttributes,
} from '../../../shared/card-classification.js';
import {
  attributeKeys,
  attributeLabels,
  attributeOptions,
  attributeItems,
  attributeValueLabel,
  matchesAny,
  type AttributeFilters,
  type AttributeItem,
  type AttributeKey,
} from '../card-attributes.js';

function Badge({ item, selected }: { item: AttributeItem; selected?: AttributeFilters }) {
  const active = selected?.[item.key].includes(item.value);
  const color = item.key === 'cardColor' ? colorForLabel(item.value) : undefined;
  const note =
    item.key === 'effects' && Object.hasOwn(effectNotes, item.value)
      ? effectNotes[item.value]
      : undefined;
  return (
    <span
      className={`attribute-chip attribute-${item.key}${color ? ' attribute-cardColor' : ''}${active ? ' is-matched' : ''}`}
      title={note || `${attributeLabels[item.key]}: ${attributeValueLabel(item.key, item.value)}`}
    >
      {color && (
        <i
          className={`color-swatch${color === 'чёрно-жёлтый' ? ' striped' : ''}`}
          style={{ backgroundColor: cardColors[color] }}
          aria-hidden="true"
        />
      )}
      {attributeValueLabel(item.key, item.value)}
      {note && <span className="effect-note">· нельзя снять</span>}
      {active && (
        <i className="matched-mark" aria-label="Совпадает с фильтром">
          ✓
        </i>
      )}
    </span>
  );
}
function Chips({ items, selected }: { items: AttributeItem[]; selected?: AttributeFilters }) {
  return (
    <div className="attribute-chips">
      {items.map((item) => (
        <Badge key={`${item.key}:${item.value}`} item={item} selected={selected} />
      ))}
    </div>
  );
}
export function CardAttributes({
  card,
  compact = false,
  selected,
}: {
  card: PublicCard;
  compact?: boolean;
  selected?: AttributeFilters;
}) {
  const items = attributeItems(card);
  const condition = normalizeAttributes(card.attributes).usageCondition;
  const tags = items.filter((item) => item.key === 'tags');
  const matchedTags = tags.filter((item) => selected?.tags.includes(item.value)).length;
  return (
    <div
      className={`card-attributes${compact ? ' compact-attributes' : ''}`}
      aria-label="Характеристики карточки"
    >
      <dl className="attribute-groups">
        {attributeKeys
          .filter((key) => key !== 'tags')
          .map((key) => {
            const group = items.filter((item) => item.key === key);
            return (
              <div key={key} className={`attribute-group-${key}`}>
                <dt>{attributeLabels[key]}</dt>
                <dd>
                  {group.length ? (
                    <Chips items={group} selected={selected} />
                  ) : (
                    <span className="attribute-empty">
                      {key === 'effects' ? 'не указаны' : 'не указано'}
                    </span>
                  )}
                  {key === 'usageFrequency' && condition && (
                    <details className="usage-condition">
                      <summary>Условия использования</summary>
                      <p>{condition}</p>
                      <small>Подробности — в описании карты.</small>
                    </details>
                  )}
                </dd>
              </div>
            );
          })}
        {!compact && (
          <div>
            <dt>Теги</dt>
            <dd>
              {tags.length ? (
                <Chips items={tags} selected={selected} />
              ) : (
                <span className="attribute-empty">не указаны</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {compact && (
        <details
          className="attribute-tags"
          key={selected?.tags.join('|') || 'tags'}
          open={matchedTags > 0 || undefined}
        >
          <summary>
            Теги{' '}
            <span className="attribute-total">
              {tags.length}
              {matchedTags > 0 ? ` · совпало ${matchedTags}` : ''}
            </span>
          </summary>
          {tags.length ? (
            <Chips items={tags} selected={selected} />
          ) : (
            <span className="attribute-empty">не указаны</span>
          )}
        </details>
      )}
    </div>
  );
}
function MultiFilter({
  cards,
  attribute,
  value,
  onChange,
}: {
  cards: PublicCard[];
  attribute: AttributeKey;
  value: AttributeFilters;
  onChange: (value: AttributeFilters) => void;
}) {
  const [query, setQuery] = useState('');
  const options = attributeOptions(cards, attribute, value[attribute]);
  const filtered = options.filter(
    ([label]) =>
      value[attribute].includes(label) ||
      attributeValueLabel(attribute, label, true)
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const any = matchesAny(attribute);
  return (
    <fieldset className="multi-attribute-filter">
      <legend>
        {attributeLabels[attribute]}
        {value[attribute].length > 0 ? ` · ${value[attribute].length}` : ''}
      </legend>
      {options.length > 6 && (
        <input
          type="search"
          aria-label={`Найти: ${attributeLabels[attribute].toLowerCase()}`}
          placeholder="Найти значение…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <small>{any ? 'Любой из выбранных вариантов' : 'Должны совпасть все выбранные'}</small>
      {(attribute === 'activationTime' || attribute === 'usageLocation') && (
        <div className="filter-shortcuts">
          {(attribute === 'activationTime'
            ? [
                ['Можно днём', 'day'],
                ['Можно ночью', 'night'],
              ]
            : [
                ['Можно внутри', 'inside'],
                ['Можно снаружи', 'outside'],
              ]
          ).map(([label, id]) => (
            <button
              type="button"
              key={id}
              onClick={() => onChange({ ...value, [attribute]: [id, 'both'] })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="filter-options">
        {filtered.map(([label, count]) => (
          <label className="check" key={label}>
            <input
              type="checkbox"
              checked={value[attribute].includes(label)}
              onChange={() =>
                onChange({
                  ...value,
                  [attribute]: value[attribute].includes(label)
                    ? value[attribute].filter((v) => v !== label)
                    : [...value[attribute], label],
                })
              }
            />
            <span>{attributeValueLabel(attribute, label, true)}</span>
            <span className="filter-count">{count}</span>
          </label>
        ))}
        {!filtered.length && <p className="attribute-empty">Нет подходящих значений</p>}
      </div>
      {value[attribute].length > 0 && (
        <button
          className="filter-clear"
          type="button"
          onClick={() => onChange({ ...value, [attribute]: [] })}
        >
          Сбросить: {attributeLabels[attribute].toLowerCase()}
        </button>
      )}
    </fieldset>
  );
}
export function CardAttributeFilters({
  cards,
  value,
  onChange,
}: {
  cards: PublicCard[];
  value: AttributeFilters;
  onChange: (value: AttributeFilters) => void;
}) {
  return (
    <div className="attribute-filters">
      {attributeKeys.map((key) => (
        <MultiFilter key={key} cards={cards} attribute={key} value={value} onChange={onChange} />
      ))}
    </div>
  );
}
