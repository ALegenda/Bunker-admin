import { normalizeAttributes } from './card-classification.js';
import type { PublicCard } from './contracts.js';

export const proposalFields = {
  name: 'Название',
  cardType: 'Тип',
  description: 'Описание',
} as const;
export const proposalAttributes = {
  activationTime: 'Время',
  usageLocation: 'Место',
  usageFrequency: 'Кол-во использований',
  usageCondition: 'Условия использования',
  effects: 'Накладываемые эффекты',
  cardColor: 'Цвет карты',
  dangerousPersonality: 'Опасная личность',
  tags: 'Теги',
} as const;

export function proposalValues(card: PublicCard) {
  const attributes = normalizeAttributes(card.attributes);
  return {
    name: card.name,
    cardType: card.cardType,
    description: card.description,
    ...attributes,
    usageCondition: attributes.usageCondition || '',
    effects: attributes.effects || [],
    cardColor: attributes.cardColor || '',
    dangerousPersonality: attributes.dangerousPersonality || false,
  };
}

export function proposalChanges(base: PublicCard | null, proposed: PublicCard) {
  const before = base && proposalValues(base);
  const after = proposalValues(proposed);
  const labels = { ...proposalFields, ...proposalAttributes };
  return (Object.keys(labels) as (keyof typeof labels)[])
    .filter((key) => !before || JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, label: labels[key], before: before?.[key], after: after[key] }));
}
