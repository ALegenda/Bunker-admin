import type { PublicCard } from '../../shared/contracts.js';
import { descriptionText } from '../../shared/rich-text.js';

export const attributeLabels = {
  cardColor: 'Цвет карточки',
  effects: 'Эффекты',
  activationTime: 'Время',
  usageFrequency: 'Частота',
  usageLocation: 'Место',
  tags: 'Теги',
};
export type AttributeKey = keyof typeof attributeLabels;
export const attributeKeys = Object.keys(attributeLabels) as AttributeKey[];
export type AttributeFilters = Record<AttributeKey, string[]>;
export const emptyAttributeFilters = (): AttributeFilters => ({
  cardColor: [],
  effects: [],
  activationTime: [],
  usageFrequency: [],
  usageLocation: [],
  tags: [],
});
export function attributeValues(card: PublicCard, key: AttributeKey): string[] {
  const value = card.attributes[key];
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).filter(Boolean))];
}
export function attributeOptions(cards: PublicCard[], key: AttributeKey, selected: string[] = []) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const value of attributeValues(card, key)) counts.set(value, (counts.get(value) || 0) + 1);
  }
  for (const value of selected) if (!counts.has(value)) counts.set(value, 0);
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ru'));
}
export function matchesCard(
  card: PublicCard,
  query: string,
  type: string,
  filters: AttributeFilters,
) {
  const text = [
    card.name,
    descriptionText(card.description),
    ...attributeKeys.flatMap((key) => attributeValues(card, key)),
  ].join(' ');
  return (
    (!type || card.cardType === type) &&
    text.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')) &&
    attributeKeys.every((key) =>
      filters[key].every((value) => attributeValues(card, key).includes(value)),
    )
  );
}

export type AttributeItem = { key: AttributeKey; value: string };
export function attributeItems(card: PublicCard): AttributeItem[] {
  return attributeKeys.flatMap((key) =>
    attributeValues(card, key).map((value) => ({ key, value })),
  );
}
// Include selected values first; rotate groups so several effects do not hide every tag.
export function compactAttributes(card: PublicCard, selected?: AttributeFilters, limit = 4) {
  const items = attributeItems(card);
  const active = items.filter((item) => selected?.[item.key].includes(item.value));
  const groups = (
    [
      'cardColor',
      'effects',
      'tags',
      'activationTime',
      'usageFrequency',
      'usageLocation',
    ] as AttributeKey[]
  ).map((key) => items.filter((item) => item.key === key && !active.includes(item)));
  const ordered = [...active];
  const shownValues = new Set(active.map((item) => item.value.toLocaleLowerCase('ru')));
  const repeated: AttributeItem[] = [];
  while (groups.some((group) => group.length))
    for (const group of groups) {
      const item = group.shift();
      if (item) {
        const value = item.value.toLocaleLowerCase('ru');
        if (shownValues.has(value)) repeated.push(item);
        else {
          ordered.push(item);
          shownValues.add(value);
        }
      }
    }
  ordered.push(...repeated);
  const count = Math.max(limit, active.length);
  return { visible: ordered.slice(0, count), hidden: ordered.slice(count), total: items.length };
}
