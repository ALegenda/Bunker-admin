import React from 'react';
import type { PublicCard } from '../../../shared/contracts.js';
import {
  attributeKeys,
  attributeLabels,
  attributeOptions,
  attributeValues,
  type AttributeFilters,
} from '../card-attributes.js';

export function CardAttributes({ card }: { card: PublicCard }) {
  return (
    <span className="tags" aria-label="Характеристики карточки">
      {attributeKeys.flatMap((key) =>
        attributeValues(card, key).map((value) => (
          <span key={`${key}:${value}`} title={`${attributeLabels[key]}: ${value}`}>
            <b>{attributeLabels[key]}:</b> {value}
          </span>
        )),
      )}
    </span>
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
      {attributeKeys.map((key) => {
        const options = attributeOptions(cards, key, value[key]);
        if (!options.length) return null;
        return (
          <fieldset key={key}>
            <legend>{attributeLabels[key]}</legend>
            {key === 'tags' ? (
              <>
                <small>Должны совпасть все выбранные</small>
                {options.map(([tag, count]) => (
                  <label className="check" key={tag}>
                    <input
                      type="checkbox"
                      checked={value.tags.includes(tag)}
                      onChange={() =>
                        onChange({
                          ...value,
                          tags: value.tags.includes(tag)
                            ? value.tags.filter((t) => t !== tag)
                            : [...value.tags, tag],
                        })
                      }
                    />
                    {tag} <span className="filter-count">{count}</span>
                  </label>
                ))}
              </>
            ) : (
              <select
                aria-label={attributeLabels[key]}
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
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
