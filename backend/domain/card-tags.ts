import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PublicCard } from '../../shared/contracts.js';
import { cardSchema } from './schema.js';
import { descriptionText } from '../../shared/rich-text.js';

export const tagPlanSchema = z
  .object({
    id: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    definitions: z.array(
      z.object({ tag: z.string().trim().min(1).max(120), description: z.string().min(1) }),
    ),
    entries: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        cardType: cardSchema.shape.cardType,
        descriptionSha256: z.string().regex(/^[a-f0-9]{64}$/),
        tags: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
      }),
    ),
  })
  .superRefine((plan, ctx) => {
    const defined = new Set(plan.definitions.map((d) => tagKey(d.tag)));
    if (defined.size !== plan.definitions.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate tag definition' });
    if (new Set(plan.entries.map((e) => e.id)).size !== plan.entries.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate card ID' });
    for (const entry of plan.entries) {
      if (
        new Set(entry.tags.map(tagKey)).size !== entry.tags.length ||
        entry.tags.some((t) => !defined.has(tagKey(t)))
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid tags for ' + entry.id });
      }
    }
  });
export type TagPlan = z.infer<typeof tagPlanSchema>;
export function tagKey(value: string) {
  return value.normalize('NFC').trim().toLocaleLowerCase('ru');
}
export function tagDescriptionHash(value: string) {
  return createHash('sha256')
    .update(descriptionText(value).replace(/\s+/g, ' ').trim())
    .digest('hex');
}
export function enrichCardTags<T extends PublicCard>(
  card: T,
  entry: TagPlan['entries'][number],
): { card: T; skipped?: string } {
  if (
    card.id !== entry.id ||
    card.name !== entry.name ||
    card.cardType !== entry.cardType ||
    tagDescriptionHash(card.description) !== entry.descriptionSha256
  ) {
    return { card, skipped: 'Карточка изменена относительно правил' };
  }
  const existing = new Set(card.attributes.tags.map(tagKey));
  const additions = entry.tags.filter((t) => !existing.has(tagKey(t)));
  if (!additions.length) return { card };
  if (card.attributes.tags.length + additions.length > 50)
    return { card, skipped: 'Превышен лимит 50 тегов' };
  return {
    card: {
      ...card,
      attributes: { ...card.attributes, tags: [...card.attributes.tags, ...additions] },
    },
  };
}
