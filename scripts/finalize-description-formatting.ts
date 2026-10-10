import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeDescription } from '../shared/rich-text.js';

const plan = JSON.parse(await readFile('tmp/description-formatting-raw.json', 'utf8'));
let changed = 0;
plan.entries = plan.entries.map(({ before, description, ...entry }: any) => {
  const normalized = normalizeDescription(before);
  const after = normalizeDescription(description);
  if (normalized !== after) changed++;
  return {
    ...entry,
    beforeDescriptionSha256: createHash('sha256').update(normalized).digest('hex'),
    description: after,
  };
});
await writeFile(
  'resources/rules-2026-05-24/description-formatting.json',
  JSON.stringify(plan, null, 2) + '\n',
);
console.log({ reviewed: plan.entries.length, changed });
