import type { CardHistoryEntry } from '../../shared/contracts.js';
import { descriptionText } from '../../shared/rich-text.js';

const fields = [
  ['name', 'Название'],
  ['cardType', 'Тип карточки'],
  ['description', 'Описание'],
  ['attributes.activationTime', 'Время применения'],
  ['attributes.usageFrequency', 'Кол-во использований'],
  ['attributes.usageCondition', 'Условия использования'],
  ['attributes.dangerousPersonality', 'Опасная личность'],
  ['attributes.usageLocation', 'Место применения'],
  ['attributes.tags', 'Теги'],
  ['attributes.cardColor', 'Цвет карточки'],
  ['attributes.effects', 'Накладываемые эффекты'],
  ['image', 'Изображение'],
  ['kind', 'Характер изменения'],
  ['note', 'Комментарий для сводки'],
  ['source', 'Источник данных'],
] as const;

function stable(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, v[key]]),
          )
        : v,
    ) ?? ''
  );
}
export function historyValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return 'Не указано';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
export function historyChanges(entry: CardHistoryEntry) {
  const read = (snapshot: CardHistoryEntry['before_data'], path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
        snapshot,
      );
  return fields.flatMap(([field, label]) => {
    if (entry.release_id && ['kind', 'note', 'source'].includes(field)) return [];
    const before = read(entry.before_data, field),
      after = read(entry.after_data, field);
    if (stable(before) === stable(after)) return [];
    // Empty defaults are not useful in a creation/archive snapshot.
    if (
      (!entry.before_data || !entry.after_data) &&
      historyValue(before) === 'Не указано' &&
      historyValue(after) === 'Не указано'
    )
      return [];
    const formatOnly =
      field === 'description' &&
      descriptionText(String(before ?? '')) === descriptionText(String(after ?? ''));
    return [{ field, label, before, after, formatOnly }];
  });
}
export function historyTitle(entry: CardHistoryEntry) {
  if (entry.release_id) return entry.release_title || 'Опубликованная версия';
  const changes = historyChanges(entry);
  if (entry.action === 'source.archive') return 'Карточка архивирована';
  if (entry.action === 'card.create') return 'Карточка создана';
  const prefix: Record<string, string> = {
    'card.import': 'Импорт карточки',
    'source.migrate': 'Обновление из источника',
    'source.attributes': 'Обновление характеристик из источника',
  };
  if (prefix[entry.action]) return prefix[entry.action];
  if (!changes.length) return 'Сохранение карточки';
  return (
    'Изменения: ' +
    changes
      .map((c) => (c.formatOnly ? 'оформление описания' : c.label.toLocaleLowerCase('ru')))
      .join(', ')
  );
}

export type TextPart = { kind: 'same' | 'removed' | 'added'; text: string };
// Bound the quadratic work for large descriptions; preserve common context even in fallback.
export function textChanges(before: string, after: string): TextPart[] {
  const tokenize = (text: string) => text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || [];
  const a = tokenize(before),
    b = tokenize(after);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const x = a.slice(start, a.length - end),
    y = b.slice(start, b.length - end);
  const parts: TextPart[] = [];
  const push = (kind: TextPart['kind'], text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  push('same', a.slice(0, start).join(''));
  if (x.length * y.length > 250000) {
    push('removed', x.join(''));
    push('added', y.join(''));
  } else {
    const width = y.length + 1;
    const dp = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        dp[i * width + j] =
          x[i] === y[j]
            ? 1 + dp[(i + 1) * width + j + 1]
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        push('same', x[i++]);
        j++;
      } else if (
        i < x.length &&
        (j === y.length || dp[(i + 1) * width + j] >= dp[i * width + j + 1])
      )
        push('removed', x[i++]);
      else push('added', y[j++]);
    }
  }
  push('same', end ? a.slice(a.length - end).join('') : '');
  return parts;
}
