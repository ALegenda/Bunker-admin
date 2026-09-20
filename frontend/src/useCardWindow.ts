import { startTransition, useEffect, useRef, useState } from 'react';
import type { PublicCard } from '../../shared/contracts.js';

export const cardPageSize = 24;
export function useCardWindow(cards: PublicCard[]) {
  const key = JSON.stringify(cards.map((card) => card.id));
  const [page, setPage] = useState({ key, limit: cardPageSize });
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  // Reset on a new result set, without an effect that briefly renders the old page size.
  if (page.key !== key) setPage({ key, limit: cardPageSize });
  const limit = page.key === key ? page.limit : cardPageSize;
  const total = cards.length;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || limit >= total) return;
    // Keep every card reachable in browsers without IntersectionObserver.
    if (typeof IntersectionObserver === 'undefined') {
      setPage({ key, limit: total });
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active || !entries.some((entry) => entry.isIntersecting)) return;
        active = false;
        observer.disconnect();
        startTransition(() => {
          setPage((current) =>
            current.key === key
              ? { key, limit: Math.min(total, current.limit + cardPageSize) }
              : current,
          );
        });
      },
      { root: scrollRootRef.current, rootMargin: '400px 0px' },
    );
    observer.observe(target);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [key, limit, total]);

  return {
    visible: cards.slice(0, limit),
    remaining: Math.max(0, total - limit),
    loadMoreRef,
    scrollRootRef,
  };
}
