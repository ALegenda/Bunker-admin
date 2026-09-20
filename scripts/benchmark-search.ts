// Usage: node --import tsx scripts/benchmark-search.ts path/to/catalog.json
// The input is a saved /api/catalog response. No network or database writes.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Catalog } from '../shared/contracts.js';
import { createSearchIndex, searchCards } from '../frontend/src/card-search.js';
import { emptyAttributeFilters } from '../frontend/src/card-attributes.js';

const file = process.argv[2];
if (!file) throw new Error('Pass the path to a saved /api/catalog JSON response');
const { cards } = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
const filters = emptyAttributeFilters();
const start = performance.now();
const index = createSearchIndex(cards);
console.log(`Cards: ${cards.length}; initial index: ${(performance.now() - start).toFixed(2)} ms`);
for (const query of ['', 'б', 'лек', 'банкир', 'банкри', 'банкр', 'черный банкир']) {
  const times: number[] = [];
  for (let run = 0; run < 105; run++) {
    const start = performance.now();
    searchCards(index, query, '', filters);
    if (run >= 5) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      query,
      medianMs: +times[50].toFixed(3),
      p95Ms: +times[94].toFixed(3),
      found: searchCards(index, query, '', filters).cards.length,
    }),
  );
}
