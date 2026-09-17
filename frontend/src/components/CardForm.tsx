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
  const patch = (value: Partial<Card>) => onChange({ ...card, ...value });
  const attr = (key: keyof Card['attributes'], value: string | string[]) =>
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
        <label>
          Частота
          <input
            value={card.attributes.usageFrequency}
            onChange={(e) => attr('usageFrequency', e.target.value)}
          />
        </label>
        <label>
          Время применения
          <TokenInput
            value={card.attributes.activationTime}
            onChange={(value) => attr('activationTime', value)}
          />
        </label>
        <label>
          Место применения
          <TokenInput
            value={card.attributes.usageLocation}
            onChange={(value) => attr('usageLocation', value)}
          />
        </label>
        <label>
          Теги через запятую
          <TokenInput value={card.attributes.tags} onChange={(value) => attr('tags', value)} />
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
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange([
          ...new Set(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ]);
      }}
      onBlur={() => setText(value.join(', '))}
    />
  );
}
