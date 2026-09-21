import {
  colorLabels,
  normalizeAttributes,
  canonicalValue,
  timeValues,
  placeValues,
  usageValues,
} from '../../../shared/card-classification.js';
import { cardColorNames, effectSuggestions } from '../../../shared/card-metadata.js';
import type { Card } from '../../../shared/contracts.js';
import React, { useEffect, useRef, useState } from 'react';
export function CardAttributeFields({
  value,
  onChange,
}: {
  value: Card['attributes'];
  onChange: (value: Card['attributes']) => void;
}) {
  const normalized = normalizeAttributes(value);
  const attr = (key: keyof Card['attributes'], next: string | string[] | boolean) =>
    onChange({ ...value, [key]: next });
  return (
    <>
      <div className="fields">
        <fieldset className="attribute-choice">
          <legend>Время</legend>
          <AttributeChoices
            values={normalized.activationTime}
            options={[...timeValues]}
            onChange={(value) => attr('activationTime', value)}
          />
          <small>Оба пункта — дневная/ночная. Ничего не выбрано — не указано.</small>
        </fieldset>
        <fieldset className="attribute-choice">
          <legend>Место</legend>
          <AttributeChoices
            values={normalized.usageLocation}
            options={[...placeValues]}
            onChange={(value) => attr('usageLocation', value)}
          />
          <small>Оба пункта — внутри и снаружи. Особые условия — в описании.</small>
        </fieldset>
        <label>
          Кол-во использований
          <select
            value={normalized.usageFrequency}
            onChange={(e) =>
              onChange({
                ...value,
                usageFrequency: e.target.value,
                usageCondition:
                  e.target.value === 'по условию' ? normalized.usageCondition : undefined,
              })
            }
          >
            <option value="">Не указано</option>
            {usageValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {normalized.usageFrequency === 'по условию' && (
          <label>
            Условия использования
            <textarea
              rows={2}
              maxLength={1000}
              value={normalized.usageCondition || ''}
              placeholder="От чего зависит количество применений"
              onChange={(e) => onChange({ ...value, usageCondition: e.target.value })}
            />
            <small>Укажите ограничения для каждого случая применения.</small>
          </label>
        )}
        <label>
          Накладываемые эффекты
          <TokenInput value={value.effects || []} onChange={(value) => attr('effects', value)} />
          <small>
            Через запятую. Телохранитель, заминирован и забей — эффекты. Забей нельзя снять.
          </small>
        </label>
        <label>
          Цвет карты
          <select
            value={normalized.cardColor || ''}
            onChange={(e) => attr('cardColor', e.target.value)}
          >
            <option value="">Не указан</option>
            {cardColorNames.map((color) => (
              <option key={color} value={color}>
                {colorLabels[color]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="attribute-choice">
          <legend>Опасная личность</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={normalized.dangerousPersonality || false}
              onChange={(e) => onChange({ ...value, dangerousPersonality: e.target.checked })}
            />
            У карты есть этот признак
          </label>
        </fieldset>
        <label>
          Теги
          <TokenInput value={value.tags} onChange={(value) => attr('tags', value)} />
          <small>Свойства и игровые механики через запятую.</small>
        </label>
      </div>
      <details className="effect-suggestions">
        <summary>Добавить известный эффект</summary>
        <div className="attribute-chips">
          {effectSuggestions
            .filter((effect) => !normalized.effects?.includes(effect))
            .map((effect) => (
              <button
                type="button"
                key={effect}
                onClick={() => attr('effects', [...(value.effects || []), effect])}
              >
                {effect}
              </button>
            ))}
        </div>
      </details>
    </>
  );
}

function TokenInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value.join(', '));
      lastEmitted.current = value;
    }
  }, [value]);
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = [
          ...new Set(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ];
        lastEmitted.current = next;
        onChange(next);
      }}
      onBlur={() => {
        const next = [...new Set(value.map(canonicalValue).filter(Boolean))];
        setText(next.join(', '));
        lastEmitted.current = next;
        onChange(next);
      }}
    />
  );
}

function AttributeChoices({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="attribute-choice-options">
      {[...new Set([...options, ...values])].map((value) => (
        <label className="check" key={value}>
          <input
            type="checkbox"
            checked={values.includes(value)}
            onChange={() =>
              onChange(
                values.includes(value)
                  ? values.filter((item) => item !== value)
                  : [...values, value],
              )
            }
          />
          {value}
        </label>
      ))}
    </div>
  );
}
