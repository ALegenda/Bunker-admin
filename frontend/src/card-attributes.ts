import type { PublicCard } from '../../shared/contracts.js';
import { descriptionText } from '../../shared/rich-text.js';

export const attributeLabels = {
  activationTime: 'Время',
  usageFrequency: 'Частота',
  usageLocation: 'Место',
  tags: 'Теги',
};
export type AttributeKey = keyof typeof attributeLabels;
export const attributeKeys = Object.keys(attributeLabels) as AttributeKey[];
export type AttributeFilters = Record<AttributeKey, string[]>;
export const emptyAttributeFilters = (): AttributeFilters => ({
  activationTime: [],
  usageFrequency: [],
  usageLocation: [],
  tags: [],
});
export function attributeValues(card: PublicCard, key: AttributeKey): string[] {
  const value = card.attributes[key];
  return [...new Set((Array.isArray(value) ? value : [value]).filter(Boolean))];
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
