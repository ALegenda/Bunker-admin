import type pg from 'pg';
import { pool } from '../db/index.js';
import type { Card } from '../domain/schema.js';
export function publicCard(c: Card) {
  const { id, name, cardType, description, attributes, image } = c;
  return { id, name, cardType, description, attributes, image };
}
export async function refreshCatalog(c: pg.PoolClient, cards: Card[]) {
  await c.query('DELETE FROM public_cards');
  await c.query(
    `INSERT INTO public_cards(id,position,data) SELECT v->>'id',n::int,v FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(v,n)`,
    [JSON.stringify(cards.map(publicCard))],
  );
}
export async function catalog() {
  const cards = (await pool.query('SELECT data FROM public_cards ORDER BY position')).rows.map(
    (r) => r.data,
  );
  const releases = (
    await pool.query('SELECT id,title,created_at FROM releases ORDER BY created_at DESC')
  ).rows;
  const source = (
    await pool.query(
      'SELECT report,applied_at FROM source_migrations ORDER BY applied_at DESC LIMIT 1',
    )
  ).rows[0];
  const sourceIsLatest =
    source && (!releases[0] || new Date(source.applied_at) > new Date(releases[0].created_at));
  return {
    cards,
    releases,
    title: sourceIsLatest ? source.report.title : releases[0]?.title || 'Исходная редакция',
  };
}
export async function publicAsset(id: string) {
  return Boolean(
    (
      await pool.query("SELECT 1 FROM public_cards WHERE data->>'image'=$1 LIMIT 1", [
        '/api/assets/' + id,
      ])
    ).rowCount,
  );
}
