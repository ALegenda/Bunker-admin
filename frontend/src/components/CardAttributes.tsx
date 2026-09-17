import React, { useState } from 'react';
import type { PublicCard } from '../../../shared/contracts.js';
import { cardColors, type CardColor } from '../../../shared/card-metadata.js';
import {
  attributeKeys,
  attributeLabels,
  attributeOptions,
  attributeItems,
  compactAttributes,
  type AttributeFilters,
  type AttributeItem,
  type AttributeKey,
} from '../card-attributes.js';

function Badge({ item, selected, showKind = false }: { item: AttributeItem; selected?: AttributeFilters; showKind?: boolean }) {
  const active = selected?.[item.key].includes(item.value);
  return (
    <span
      className={`attribute-chip attribute-${item.key}${active ? ' is-matched' : ''}`}
      title={`${attributeLabels[item.key]}: ${item.value}`}
    >
      {item.key === 'cardColor' && (
        <i
          className={`color-swatch${item.value === 'чёрно-жёлтый' ? ' striped' : ''}`}
          style={{ backgroundColor: cardColors[item.value as CardColor] }}
          aria-hidden="true"
        />
      )}
      {showKind && item.key === 'effects' && <span className="attribute-kind">Эффект:</span>}
      {item.value}
      {active && (
        <i className="matched-mark" aria-label="Совпадает с фильтром">
          ✓
        </i>
      )}
    </span>
  );
}
function AttributeGroups({
  items,
  selected,
}: {
  items: AttributeItem[];
  selected?: AttributeFilters;
}) {
  return (
    <dl className="attribute-groups">
      {attributeKeys.map((key) => {
        const group = items.filter((item) => item.key === key);
        if (!group.length) return null;
        return (
          <div key={key}>
            <dt>{attributeLabels[key]}</dt>
            <dd className="attribute-chips">
              {group.map((item) => (
                <Badge key={item.value} item={item} selected={selected} />
              ))}
            </dd>
          </div>
        );
      })}
    </dl>
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
  if (!items.length) return null;
  if (!compact)
    return (
      <div className="card-attributes" aria-label="Характеристики карточки">
        <AttributeGroups items={items} selected={selected} />
      </div>
    );
  const { visible, hidden, total } = compactAttributes(card, selected);
  return (
    <div className="card-attributes compact-attributes" aria-label="Характеристики карточки">
      <div className="attribute-chips">
        {visible.map((item) => (
          <Badge key={`${item.key}:${item.value}`} item={item} selected={selected} showKind />
        ))}
      </div>
      {hidden.length > 0 && (
        <details className="attribute-overflow">
          <summary>
            <span className="overflow-closed">Ещё {hidden.length}</span>
            <span className="overflow-open">Свернуть</span>
            <span className="attribute-total"> · всего {total}</span>
          </summary>
          <AttributeGroups items={hidden} selected={selected} />
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
  attribute: 'tags' | 'effects';
  value: AttributeFilters;
  onChange: (value: AttributeFilters) => void;
}) {
  const [query, setQuery] = useState('');
  const options = attributeOptions(cards, attribute, value[attribute]);
  const filtered = options.filter(
    ([label]) =>
      value[attribute].includes(label) ||
      label.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')),
  );
  if (!options.length) return null;
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
          placeholder={attribute === 'tags' ? 'Найти тег…' : 'Найти эффект…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <small>Должны совпасть все выбранные</small>
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
                    ? value[attribute].filter((t) => t !== label)
                    : [...value[attribute], label],
                })
              }
            />
            <span>{label}</span>
            <span className="filter-count">{count}</span>
          </label>
        ))}
        {!filtered.length && <p>Нет подходящих значений</p>}
      </div>
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
  const singleKeys: AttributeKey[] = [
    'cardColor',
    'activationTime',
    'usageFrequency',
    'usageLocation',
  ];
  return (
    <div className="attribute-filters">
      {singleKeys.map((key) => {
        const options = attributeOptions(cards, key, value[key]);
        if (!options.length) return null;
        return (
          <label key={key}>
            {attributeLabels[key]}
            <select
              value={value[key][0] || ''}
              onChange={(e) =>
                onChange({ ...value, [key]: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">Любые</option>
              {options.map(([label, count]) => (
                <option key={label} value={label}>
                  {label} · {count}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <MultiFilter cards={cards} attribute="effects" value={value} onChange={onChange} />
      <MultiFilter cards={cards} attribute="tags" value={value} onChange={onChange} />
    </div>
  );
}
