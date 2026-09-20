import type { PublicCard } from '../../shared/contracts.js';
import { canonicalValue } from '../../shared/card-classification.js';
import { descriptionText } from '../../shared/rich-text.js';
import {
  attributeKeys,
  attributeValueLabel,
  matchesAttributes,
  preparedAttributes,
  type AttributeFilters,
} from './card-attributes.js';

export const normalizeSearch = (value: string) =>
  value.normalize('NFC').toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
const words = (value: string) => value.match(/[\p{L}\p{N}]+/gu) || [];

function prepareCard(card: PublicCard) {
  const { normalized, values } = preparedAttributes(card);
  const description = descriptionText(card.description);
  const name = normalizeSearch(card.name);
  const text = normalizeSearch(
    [
      card.name,
      description,
      normalized.usageCondition || '',
      normalized.dangerousPersonality ? 'опасная личность' : '',
      ...attributeKeys.flatMap((key) =>
        values[key].map((value) => attributeValueLabel(key, value)),
      ),
    ].join(' '),
  );
  return { card, name, text, words: [...new Set(words(text))], description };
}
const documentCache = new WeakMap<PublicCard, ReturnType<typeof prepareCard>>();
export function searchDocument(card: PublicCard) {
  let document = documentCache.get(card);
  if (!document) {
    document = prepareCard(card);
    documentCache.set(card, document);
  }
  return document;
}

export function createSearchIndex(cards: PublicCard[]) {
  const documents = cards.map(searchDocument);
  const vocabulary = new Map<number, Set<string>>();
  for (const document of documents) {
    for (const word of document.words) {
      let group = vocabulary.get(word.length);
      if (!group) vocabulary.set(word.length, (group = new Set()));
      group.add(word);
    }
  }
  return { documents, vocabulary };
}
export type SearchIndex = ReturnType<typeof createSearchIndex>;

// One insertion, deletion, replacement or adjacent transposition, in linear time.
// Only whole words of 4+ letters are corrected; short queries and numbers stay literal.
function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  );
}

export function searchCards(
  index: SearchIndex,
  query: string,
  type: string,
  filters: AttributeFilters,
) {
  const text = normalizeSearch(canonicalValue(query));
  const terms = [...new Set(words(text))];
  const candidates = index.documents.filter(({ card }) => matchesAttributes(card, type, filters));
  if (!text) return { cards: candidates.map(({ card }) => card), approximateCount: 0 };
  // Punctuation-only queries retain literal substring matching.
  const exact = (value: string) =>
    terms.length ? terms.every((term) => value.includes(term)) : value.includes(text);
  const ranked: { card: PublicCard; rank: number }[] = [];
  const remaining: typeof candidates = [];
  for (const document of candidates) {
    if (exact(document.text)) {
      const rank =
        document.name === text
          ? 0
          : document.name.includes(text)
            ? 1
            : exact(document.name)
              ? 2
              : document.text.includes(text)
                ? 3
                : 4;
      ranked.push({ card: document.card, rank });
    } else remaining.push(document);
  }
  let approximateCount = 0;
  if (remaining.length && terms.length) {
    const alternatives = terms.map((term) => {
      const matches = new Set<string>();
      if (term.length < 4 || !/^\p{L}+$/u.test(term)) return matches;
      for (let length = term.length - 1; length <= term.length + 1; length++) {
        for (const word of index.vocabulary.get(length) || []) {
          if (word.length >= 4 && withinOneEdit(term, word)) matches.add(word);
        }
      }
      return matches;
    });
    for (const document of remaining) {
      if (
        terms.every(
          (term, i) =>
            document.text.includes(term) ||
            (alternatives[i].size > 0 && document.words.some((word) => alternatives[i].has(word))),
        )
      ) {
        const nameWords = words(document.name);
        const matchesName = terms.every(
          (term, i) =>
            document.name.includes(term) || nameWords.some((word) => alternatives[i].has(word)),
        );
        ranked.push({ card: document.card, rank: matchesName ? 5 : 6 });
        approximateCount++;
      }
    }
  }
  // Stable sort preserves catalog order for equally relevant cards and empty queries.
  ranked.sort((a, b) => a.rank - b.rank);
  return { cards: ranked.map(({ card }) => card), approximateCount };
}
