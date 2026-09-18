import { cardColorNames } from './card-metadata.js';
import { z } from 'zod';
import { normalizeDescription } from './rich-text.js';
export const attributes = z
  .object({
    activationTime: z.array(z.string().max(80)).max(10).default([]),
    usageFrequency: z.string().max(80).default(''),
    usageCondition: z.string().trim().max(1000).optional(),
    dangerousPersonality: z.boolean().optional(),
    usageLocation: z.array(z.string().max(120)).max(10).default([]),
    cardColor: z.enum(['', ...cardColorNames]).optional(),
    effects: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    tags: z.array(z.string().max(120)).max(50).default([]),
  })
  .default({ activationTime: [], usageFrequency: '', usageLocation: [], tags: [] })
  .transform((value) => {
    const result = { ...value };
    if (!result.usageCondition) delete result.usageCondition;
    if (!result.cardColor) delete result.cardColor;
    if (!result.effects?.length) delete result.effects;
    return result;
  });
export const cardSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(250),
  cardType: z.enum(['правило', 'роль', 'умение', 'припас', 'мёртвый бонус', 'наёмник']),
  description: z.string().max(100000).transform(normalizeDescription),
  attributes,
  image: z.string().max(3000000).default(''),
  kind: z.string().max(80).default('Уточнение'),
  note: z.string().max(10000).default(''),
  source: z.unknown().optional(),
});
export const draftSchema = z
  .object({
    cards: z.array(cardSchema).min(1).max(1500),
    release: z.string().min(1).max(200).default('Следующая редакция'),
    changelog: z.string().max(200000).default(''),
    changelogStamp: z.string().max(100).default(''),
  })
  .refine((s) => new Set(s.cards.map((c) => c.id)).size === s.cards.length, {
    message: 'Повторяющиеся идентификаторы карточек',
  });
export type Card = z.infer<typeof cardSchema>;
export type Draft = z.infer<typeof draftSchema>;
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
