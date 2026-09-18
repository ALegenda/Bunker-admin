import {
  colorLabels,
  normalizeAttributes,
  canonicalValue,
  timeValues,
  placeValues,
  usageValues,
} from '../../../shared/card-classification.js';
import { cardColorNames, effectSuggestions } from '../../../shared/card-metadata.js';
import { DescriptionEditor } from './DescriptionEditor.js';
import type { Card } from '../../../shared/contracts.js';
import { api } from '../api.js';
import { useEffect, useRef, useState } from 'react';
export const cardTypes = [
  'правило',
  'роль',
  'умение',
  'припас',
  'мёртвый бонус',
  'наёмник',
] as const;
export function CardForm({
  card,
  onChange,
  onImage,
}: {
  card: Card;
  onChange: (card: Card) => void;
  onImage: (id: string, image: string) => void;
}) {
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const normalized = normalizeAttributes(card.attributes);
  const patch = (value: Partial<Card>) => onChange({ ...card, ...value });
  const attr = (key: keyof Card['attributes'], value: string | string[] | boolean) =>
    patch({ attributes: { ...card.attributes, [key]: value } });
  return (
    <>
      <label>
        Название
        <input
          value={card.name}
          maxLength={250}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <div className="art-text">
        {card.image && (
          <a href={card.image} target="_blank" rel="noreferrer">
            <img className="card-art" src={card.image} alt={card.name} />
          </a>
        )}
        <DescriptionEditor
          value={card.description}
          onChange={(description) => patch({ description })}
        />
      </div>
      <label>
        Готовое изображение · PNG, JPG, WebP до 2 МБ
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setError('Размер изображения превышает 2 МБ');
              return;
            }
            try {
              const form = new FormData();
              form.append('image', file);
              const result = await api<{ image: string }>('/api/assets', {
                method: 'POST',
                body: form,
              });
              if (!active.current) return;
              onImage(card.id, result.image);
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="fields">
        <label>
          Тип
          <select
            value={card.cardType}
            onChange={(e) => patch({ cardType: e.target.value as Card['cardType'] })}
          >
            {cardTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
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
              patch({
                attributes: {
                  ...normalized,
                  usageFrequency: e.target.value,
                  usageCondition:
                    e.target.value === 'по условию' ? normalized.usageCondition : undefined,
                },
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
              onChange={(e) =>
                patch({ attributes: { ...normalized, usageCondition: e.target.value } })
              }
            />
            <small>Укажите ограничения для каждого случая применения.</small>
          </label>
        )}
        <label>
          Накладываемые эффекты
          <TokenInput
            value={card.attributes.effects || []}
            onChange={(value) => attr('effects', value)}
          />
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
              onChange={(e) =>
                patch({ attributes: { ...normalized, dangerousPersonality: e.target.checked } })
              }
            />
            У карты есть этот признак
          </label>
        </fieldset>
        <label>
          Теги
          <TokenInput value={card.attributes.tags} onChange={(value) => attr('tags', value)} />
          <small>Свойства и игровые механики через запятую.</small>
        </label>
        <label>
          Характер изменения
          <select value={card.kind} onChange={(e) => patch({ kind: e.target.value })}>
            {['Уточнение', 'Механика и баланс', 'Исправление опечатки'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
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
                onClick={() => attr('effects', [...(card.attributes.effects || []), effect])}
              >
                {effect}
              </button>
            ))}
        </div>
      </details>
      <label>
        Комментарий для сводки
        <textarea
          rows={2}
          value={card.note}
          placeholder="Объясните, зачем внесено изменение и что важно игрокам"
          onChange={(e) => patch({ note: e.target.value })}
        />
        <small>Комментарий появится перед сравнением «Было / Стало» в сводке.</small>
      </label>
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
