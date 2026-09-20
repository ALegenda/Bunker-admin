import type { PublicCard } from '../../shared/contracts.js';
import {
  canonicalValue,
  colorForLabel,
  colorLabels,
  normalizeAttributes,
  normalizeUsage,
} from '../../shared/card-classification.js';

export const attributeLabels = {
  activationTime: 'Время',
  usageLocation: 'Место',
  usageFrequency: 'Кол-во использований',
  effects: 'Накладываемые эффекты',
  cardColor: 'Цвет карты',
  dangerousPersonality: 'Опасная личность',
  tags: 'Теги',
};
export type AttributeKey = keyof typeof attributeLabels;
export const attributeKeys = Object.keys(attributeLabels) as AttributeKey[];
export type AttributeFilters = Record<AttributeKey, string[]>;
export const emptyAttributeFilters = (): AttributeFilters => ({
  activationTime: [],
  usageLocation: [],
  usageFrequency: [],
  effects: [],
  cardColor: [],
  dangerousPersonality: [],
  tags: [],
});
const categories = {
  activationTime: {
    day: 'только дневная',
    night: 'только ночная',
    both: 'дневная/ночная',
    unknown: 'не указано',
  },
  usageLocation: {
    inside: 'только внутри бункера',
    outside: 'только снаружи',
    both: 'внутри и снаружи',
    unknown: 'не указано',
  },
} as const;
export function attributeValueLabel(key: AttributeKey, value: string, filter = false): string {
  if (key === 'dangerousPersonality')
    return value === 'yes' ? 'да' : value === 'no' ? 'нет' : value;
  if (key === 'activationTime' || key === 'usageLocation') {
    const label = Object.hasOwn(categories[key], value)
      ? (categories[key] as Record<string, string>)[value]
      : value;
    return filter ? label : label.replace(/^только /, '');
  }
  return value;
}
// Unknown/custom values never imply that a card is unrestricted.
function category(
  values: string[],
  first: string,
  second: string,
  firstId: string,
  secondId: string,
) {
  if (!values.length) return 'unknown';
  if (values.length === 1 && values[0] === first) return firstId;
  if (values.length === 1 && values[0] === second) return secondId;
  if (values.length === 2 && values.includes(first) && values.includes(second)) return 'both';
  return values.join(', ');
}
// Cards/attributes are replaced immutably by the editor. Weak keys let old drafts be collected.
const attributeCache = new WeakMap<
  PublicCard['attributes'],
  ReturnType<typeof prepareAttributes>
>();
function prepareAttributes(input: PublicCard['attributes']) {
  const normalized = normalizeAttributes(input);
  const values = Object.fromEntries(
    attributeKeys.map((key) => [key, valuesForAttributes(normalized, key)]),
  ) as AttributeFilters;
  return { normalized, values };
}
export function preparedAttributes(card: PublicCard) {
  let cached = attributeCache.get(card.attributes);
  if (!cached) {
    cached = prepareAttributes(card.attributes);
    attributeCache.set(card.attributes, cached);
  }
  return cached;
}
export function attributeValues(card: PublicCard, key: AttributeKey): string[] {
  return preparedAttributes(card).values[key];
}
function valuesForAttributes(a: PublicCard['attributes'], key: AttributeKey): string[] {
  if (key === 'activationTime')
    return [category(a.activationTime, 'дневная', 'ночная', 'day', 'night')];
  if (key === 'usageLocation')
    return [category(a.usageLocation, 'внутри бункера', 'снаружи', 'inside', 'outside')];
  if (key === 'cardColor') return a.cardColor ? [colorLabels[a.cardColor]] : [];
  if (key === 'dangerousPersonality') return [a.dangerousPersonality ? 'yes' : 'no'];
  if (key === 'tags') return a.tags;
  if (key === 'usageFrequency') return a.usageFrequency ? [a.usageFrequency] : [];
  return a.effects || [];
}
export function attributeOptions(cards: PublicCard[], key: AttributeKey, selected: string[] = []) {
  const counts = new Map<string, number>();
  for (const card of cards)
    for (const value of attributeValues(card, key)) counts.set(value, (counts.get(value) || 0) + 1);
  for (const value of selected) if (!counts.has(value)) counts.set(value, 0);
  const order =
    key === 'activationTime' || key === 'usageLocation' ? Object.keys(categories[key]) : [];
  return [...counts].sort(([a], [b]) => {
    if (order.includes(a) || order.includes(b))
      return (
        (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99)
      );
    return a.localeCompare(b, 'ru');
  });
}
export const matchesAny = (key: AttributeKey) =>
  [
    'activationTime',
    'usageLocation',
    'usageFrequency',
    'cardColor',
    'dangerousPersonality',
  ].includes(key);
export function matchesAttributes(card: PublicCard, type: string, filters: AttributeFilters) {
  return (
    (!type || card.cardType === type) &&
    attributeKeys.every((key) => {
      const selected = filters[key];
      if (!selected.length) return true;
      const values = attributeValues(card, key);
      return matchesAny(key)
        ? selected.some((v) => values.includes(v))
        : selected.every((v) => values.includes(v));
    })
  );
}
export type AttributeItem = { key: AttributeKey; value: string };
export function attributeItems(card: PublicCard): AttributeItem[] {
  return attributeKeys.flatMap((key) =>
    attributeValues(card, key).map((value) => ({ key, value })),
  );
}

const paramsByKey: Record<AttributeKey, string> = {
  activationTime: 'time',
  usageLocation: 'place',
  usageFrequency: 'frequency',
  effects: 'effect',
  cardColor: 'color',
  dangerousPersonality: 'dangerous',
  tags: 'tag',
};
export function filtersFromParams(params: URLSearchParams): AttributeFilters {
  const filters = emptyAttributeFilters();
  for (const key of attributeKeys) {
    filters[key] = [
      ...new Set(
        params
          .getAll(paramsByKey[key])
          .flatMap((value) => {
            if (key === 'activationTime') {
              const legacy = canonicalValue(value);
              if (legacy === 'дневная') return ['day', 'both'];
              if (legacy === 'ночная') return ['night', 'both'];
              if (['дневное/ночное', 'дневная/ночная'].includes(legacy)) return ['both'];
              return [value];
            }
            if (key === 'usageLocation') {
              const legacy = canonicalValue(value);
              if (legacy === 'внутри бункера') return ['inside', 'both'];
              if (legacy === 'снаружи') return ['outside', 'both'];
              if (['везде', 'внутри и снаружи'].includes(legacy)) return ['both'];
              return [value];
            }
            return [key === 'usageFrequency' ? normalizeUsage(value) : canonicalValue(value)];
          })
          .filter(Boolean),
      ),
    ];
  }
  // Keep existing shared links usable when colors/status move out of tags.
  filters.tags = filters.tags.filter((tag) => {
    if (colorForLabel(tag)) {
      if (!filters.cardColor.includes(tag)) filters.cardColor.push(tag);
      return false;
    }
    if (tag === 'опасная личность') {
      if (!filters.dangerousPersonality.includes('yes')) filters.dangerousPersonality.push('yes');
      return false;
    }
    return true;
  });
  if (filters.effects.includes('опасная личность')) {
    filters.effects = filters.effects.filter((effect) => effect !== 'опасная личность');
    if (!filters.dangerousPersonality.includes('yes')) filters.dangerousPersonality.push('yes');
  }
  return filters;
}
export function appendFilterParams(params: URLSearchParams, filters: AttributeFilters) {
  for (const key of attributeKeys)
    for (const value of filters[key]) params.append(paramsByKey[key], value);
}
