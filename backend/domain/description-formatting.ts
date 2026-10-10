import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PublicCard } from '../../shared/contracts.js';
import { normalizeDescription } from '../../shared/rich-text.js';
import { cardSchema } from './schema.js';

export const descriptionFormattingPlanSchema = z
  .object({
    id: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z.array(
      z.object({
        id: z.string().min(1),
        name: cardSchema.shape.name,
        cardType: cardSchema.shape.cardType,
        beforeDescriptionSha256: z.string().regex(/^[a-f0-9]{64}$/),
        description: cardSchema.shape.description,
      }),
    ),
  })
  .refine((plan) => new Set(plan.entries.map((entry) => entry.id)).size === plan.entries.length, {
    message: 'Duplicate card ID',
  });
export type DescriptionFormattingPlan = z.infer<typeof descriptionFormattingPlanSchema>;

export function descriptionFormattingHash(description: string) {
  return createHash('sha256').update(normalizeDescription(description)).digest('hex');
}

export function formatCardDescription<T extends PublicCard>(
  card: T,
  entry: DescriptionFormattingPlan['entries'][number],
): { card: T; skipped?: string } {
  if (card.id !== entry.id || card.name !== entry.name || card.cardType !== entry.cardType)
    return { card, skipped: 'Карточка изменена относительно правил' };
  if (normalizeDescription(card.description) === entry.description) return { card };
  // Check both wording AND markup: preserve manually edited formatting too.
  if (descriptionFormattingHash(card.description) !== entry.beforeDescriptionSha256)
    return { card, skipped: 'Описание или его оформление изменено вручную' };
  return { card: { ...card, description: entry.description } };
}
