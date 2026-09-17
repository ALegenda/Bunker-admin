import { z } from 'zod';
import type { PublicCard } from '../../shared/contracts.js';
import { cardColorNames } from '../../shared/card-metadata.js';
import { cardSchema } from './schema.js';
import { tagDescriptionHash, tagKey } from './card-tags.js';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const metadataPlanSchema = z
  .object({
    id: z.string().min(1),
    sourceSha256: digest,
    entries: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          cardType: cardSchema.shape.cardType,
          descriptionSha256: digest,
          cardColor: z.enum(cardColorNames).optional(),
          imageSha256: digest.optional(),
          colorEvidence: z
            .object({
              page: z.number().int().positive(),
              rgb: z.tuple([z.number(), z.number(), z.number()]),
            })
            .optional(),
          effects: z.array(z.string().trim().min(1).max(120)).max(30),
          tags: z.array(z.string().trim().min(1).max(120)).max(50),
        })
        .refine(
          (e) => !e.cardColor || Boolean(e.imageSha256 && e.colorEvidence),
          'Missing color evidence',
        ),
    ),
  })
  .refine(
    (p) => new Set(p.entries.map((e) => e.id)).size === p.entries.length,
    'Duplicate card ID',
  );
export type MetadataPlan = z.infer<typeof metadataPlanSchema>;

export function enrichCardMetadata<T extends PublicCard>(
  card: T,
  entry: MetadataPlan['entries'][number],
  imageSha256?: string,
) {
  const skipped: string[] = [];
  if (card.id !== entry.id || card.name !== entry.name || card.cardType !== entry.cardType)
    return { card, skipped: ['Изменены название или тип'] };
  const attributes = { ...card.attributes };
  let changed = false;
  if (entry.cardColor && !attributes.cardColor) {
    if (imageSha256 === entry.imageSha256) {
      attributes.cardColor = entry.cardColor;
      changed = true;
    } else skipped.push('Цвет: изображение отличается от исходного');
  }
  if (entry.effects.length || entry.tags.length) {
    if (tagDescriptionHash(card.description) !== entry.descriptionSha256)
      skipped.push('Эффекты и теги: описание изменено');
    else
      for (const key of ['effects', 'tags'] as const) {
        const values = attributes[key] || [],
          seen = new Set(values.map(tagKey));
        const added = entry[key].filter((value) => {
          const k = tagKey(value);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (values.length + added.length > (key === 'effects' ? 30 : 50)) {
          skipped.push(`Лимит значений: ${key}`);
          continue;
        }
        if (added.length) {
          attributes[key] = [...values, ...added];
          changed = true;
        }
      }
  }
  return { card: changed ? { ...card, attributes } : card, skipped };
}
