import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PublicCard } from '../../shared/contracts.js';
import { cardSchema } from '../../shared/schema.js';
import { normalizeAttributes, canonicalValue } from '../../shared/card-classification.js';
import { descriptionText } from '../../shared/rich-text.js';

export type ContentSource = 'published' | 'draft';
export type Snapshot = { source: ContentSource; title: string; cards: PublicCard[] };
export type ProposalInput = {
  cardId: string;
  expectedHash: string;
  description: string;
  name?: string;
  reason: string;
};
export interface ContentProvider {
  origin: string;
  allowDraft: boolean;
  load(source: ContentSource): Promise<Snapshot>;
  history?(cardId: string): Promise<unknown>;
  submitProposal?(input: ProposalInput): Promise<{ id: string }>;
  proposals?(): Promise<unknown>;
  close?(): Promise<void>;
}
export class ContentError extends Error {}
export const publicCardSchema = cardSchema.pick({
  id: true,
  name: true,
  cardType: true,
  description: true,
  attributes: true,
  image: true,
});
export const sourceSchema = z.enum(['published', 'draft']);
export const cardIdSchema = z.string().trim().min(1).max(100);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const normalizeSearch = (text: string) =>
  text.normalize('NFC').toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();

// A fixed field order makes hashes independent of JSON object key order and private fields.
export function cardHash(card: PublicCard) {
  const a = normalizeAttributes(card.attributes);
  return createHash('sha256')
    .update(
      JSON.stringify([
        card.id,
        card.name,
        card.cardType,
        card.description,
        card.image,
        a.activationTime,
        a.usageFrequency,
        a.usageCondition || '',
        a.usageLocation,
        a.tags,
        a.cardColor || '',
        a.effects || [],
        Boolean(a.dangerousPersonality),
      ]),
    )
    .digest('hex');
}
export function snapshotHash(snapshot: Snapshot) {
  return createHash('sha256')
    .update(JSON.stringify([snapshot.source, snapshot.title, snapshot.cards.map(cardHash)]))
    .digest('hex');
}
export function snapshotInfo(snapshot: Snapshot) {
  return { source: snapshot.source, title: snapshot.title, snapshotHash: snapshotHash(snapshot) };
}
export function cardResource(source: ContentSource, id: string) {
  return `bunker://cards/${source}/${encodeURIComponent(id)}`;
}
export function cardView(card: PublicCard, source: ContentSource, origin: string) {
  // Do not forward arbitrary properties received from a database or a remote API.
  const c = publicCardSchema.parse(card);
  const url = new URL(source === 'draft' ? '/admin' : '/catalog', origin);
  url.searchParams.set('card', c.id);
  return {
    ...c,
    attributes: normalizeAttributes(c.attributes),
    text: descriptionText(c.description),
    contentHash: cardHash(c),
    source,
    url: url.href,
    resourceUri: cardResource(source, c.id),
  };
}
export function findCard(snapshot: Snapshot, id: string) {
  const card = snapshot.cards.find((c) => c.id === id);
  if (!card) throw new ContentError('Карточка не найдена в выбранной редакции.');
  return card;
}
export const selectionShape = {
  query: z.string().trim().max(300).default(''),
  cardType: cardSchema.shape.cardType.optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  activationTime: z.enum(['дневная', 'ночная']).optional(),
  usageLocation: z.enum(['внутри бункера', 'снаружи']).optional(),
  offset: z.number().int().nonnegative().max(100000).default(0),
};
export type Selection = z.infer<ReturnType<typeof selectionSchema>>;
function selectionSchema() {
  return z.object(selectionShape);
}
export function selectCards(snapshot: Snapshot, selection: Selection) {
  const text = normalizeSearch(selection.query);
  const terms = text.match(/[\p{L}\p{N}]+/gu) || (text ? [text] : []);
  const tags = selection.tags.map((t) => normalizeSearch(canonicalValue(t)));
  return snapshot.cards
    .map((card, position) => {
      const a = normalizeAttributes(card.attributes);
      const name = normalizeSearch(card.name);
      const searchable = normalizeSearch(
        [
          card.name,
          descriptionText(card.description),
          card.cardType,
          a.usageFrequency,
          a.usageCondition,
          a.cardColor,
          ...a.activationTime,
          ...a.usageLocation,
          ...a.tags,
          ...(a.effects || []),
          a.dangerousPersonality ? 'опасная личность' : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      return { card, position, a, name, searchable };
    })
    .filter(
      ({ card, a, searchable }) =>
        (!selection.cardType || card.cardType === selection.cardType) &&
        (!selection.activationTime || a.activationTime.includes(selection.activationTime)) &&
        (!selection.usageLocation || a.usageLocation.includes(selection.usageLocation)) &&
        tags.every((tag) => a.tags.some((t) => normalizeSearch(t) === tag)) &&
        terms.every((term) => searchable.includes(term)),
    )
    .sort((a, b) => {
      const rank = (name: string) => (!text ? 0 : name === text ? 0 : name.includes(text) ? 1 : 2);
      return rank(a.name) - rank(b.name) || a.position - b.position;
    })
    .map(({ card }) => card);
}
export function overview(snapshot: Snapshot) {
  const count = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b, 'ru'))
      .map(([value, cards]) => ({ value, cards }));
  };
  return {
    ...snapshotInfo(snapshot),
    total: snapshot.cards.length,
    cardTypes: count(snapshot.cards.map((c) => c.cardType)),
    tags: count(snapshot.cards.flatMap((c) => normalizeAttributes(c.attributes).tags)),
    effects: count(snapshot.cards.flatMap((c) => normalizeAttributes(c.attributes).effects || [])),
    activationTimes: count(
      snapshot.cards.flatMap((c) => normalizeAttributes(c.attributes).activationTime),
    ),
    usageLocations: count(
      snapshot.cards.flatMap((c) => normalizeAttributes(c.attributes).usageLocation),
    ),
  };
}

export const reviewChecklist = [
  'Орфография, пунктуация, читаемость и единообразие терминов.',
  'Кто действует, на кого, когда, где и сколько раз; явно ли заданы условия и исключения.',
  'Согласованность описания со временем, местом, частотой, условиями и эффектами в атрибутах.',
  'Двусмысленности и противоречия с другими карточками и общими правилами.',
  'Отделяй редакционные исправления от изменений механики. Не придумывай недостающие правила.',
  'Для каждой проблемы приведи точную цитату, объяснение, предлагаемую формулировку и ссылки на источники.',
];
