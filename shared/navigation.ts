const catalogParameters = [
  'q',
  'type',
  'color',
  'effect',
  'tag',
  'time',
  'place',
  'frequency',
  'card',
];

/** Preserve shared card links and bookmarked filters from the former homepage. */
export function legacyCatalogUrl(path: string, search: string, hash = ''): string | null {
  if (path !== '/') return null;
  const params = new URLSearchParams(search);
  if (!catalogParameters.some((key) => params.has(key))) return null;
  return '/catalog' + (search.startsWith('?') ? search : '?' + search) + hash;
}
