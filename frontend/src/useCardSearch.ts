import { useDeferredValue, useMemo } from 'react';
import type { PublicCard } from '../../shared/contracts.js';
import type { AttributeFilters } from './card-attributes.js';
import { createSearchIndex, searchCards } from './card-search.js';

const noCards: PublicCard[] = [];
export function useCardSearch(
  cards: PublicCard[] | undefined,
  query: string,
  type: string,
  filters: AttributeFilters,
) {
  const index = useMemo(() => createSearchIndex(cards || noCards), [cards]);
  const deferredQuery = useDeferredValue(query);
  const result = useMemo(
    () => searchCards(index, deferredQuery, type, filters),
    [index, deferredQuery, type, filters],
  );
  return { ...result, pending: query !== deferredQuery };
}
