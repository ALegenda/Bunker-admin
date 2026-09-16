import { migrateSourceRules } from '../services/source-migration.js';
import { refreshCatalog } from '../services/catalog.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, transaction } from './index.js';
import { migrate } from './migrate.js';
import { ensureBucket, storeImage } from '../services/storage.js';
import { upsertCards } from '../services/workspace.js';
import { cardSchema, type Card } from '../domain/schema.js';
export async function seed() {
  await migrate();
  await ensureBucket();
  if ((await pool.query('SELECT id FROM workspace WHERE id=1')).rowCount) {
    await migrateSourceRules();
    console.log('Database initialized; source migrations checked');
    return;
  }
  const originals = JSON.parse(await readFile('docs/cards.json', 'utf8'));
  const images = JSON.parse(await readFile('public/assets/card-images.json', 'utf8'));
  const imported = JSON.parse(await readFile('public/assets/rule-sections.json', 'utf8'));
  const raw = [
    ...originals.map((c: any, i: number) => ({
      ...c,
      id: String(i),
      image: images[String(i)]?.image || '',
    })),
    ...imported,
  ];
  const cards: Card[] = [];
  for (const entry of raw) {
    let image = '';
    if (entry.image) {
      const file = path.resolve('public', entry.image.replace(/^\//, ''));
      if (!file.startsWith(path.resolve('public/assets') + path.sep))
        throw Error('Invalid seed asset');
      image = await storeImage(await readFile(file), entry.image);
    }
    cards.push(cardSchema.parse({ ...entry, image }));
  }
  await transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(473911)');
    if ((await c.query('SELECT id FROM workspace WHERE id=1')).rowCount) return;
    await upsertCards(c, cards);
    await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [JSON.stringify(cards)]);
    await refreshCatalog(c, cards);
  });
  await migrateSourceRules();
  console.log(`Imported ${cards.length} cards and rules into PostgreSQL; images stored in S3`);
}
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  await seed();
  await pool.end();
}
