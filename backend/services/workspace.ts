import { audit } from './audit.js';
import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../db/index.js';
import { AppError, draftSchema, type Draft, type Card } from '../domain/schema.js';
import { resolveImage } from './storage.js';
import { changes, summary } from '../../shared/model.js';
export function rowCard(r: any): Card {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    cardType: r.card_type,
    attributes: {
      activationTime: r.activation_time,
      usageFrequency: r.usage_frequency,
      usageLocation: r.usage_location,
      tags: r.tags,
      ...(r.card_color ? { cardColor: r.card_color } : {}),
      ...(r.effects?.length ? { effects: r.effects } : {}),
    },
    image: r.image_asset_id ? `/api/assets/${r.image_asset_id}` : '',
    kind: r.change_kind,
    note: r.editorial_note,
    ...(r.source ? { source: r.source } : {}),
  };
}
export async function upsertCards(c: pg.PoolClient, cards: Card[]) {
  const values = cards.map((v, position) => ({
    ...v,
    position,
    imageAssetId: v.image.split('/').at(-1) || null,
  }));
  await c.query(
    `INSERT INTO cards(id,position,name,card_type,description,activation_time,usage_frequency,usage_location,tags,image_asset_id,change_kind,editorial_note,source,card_color,effects)
 SELECT v->>'id',(v->>'position')::int,v->>'name',v->>'cardType',v->>'description',
 ARRAY(SELECT jsonb_array_elements_text(v->'attributes'->'activationTime')),v->'attributes'->>'usageFrequency',
 ARRAY(SELECT jsonb_array_elements_text(v->'attributes'->'usageLocation')),ARRAY(SELECT jsonb_array_elements_text(v->'attributes'->'tags')),
 (v->>'imageAssetId')::uuid,v->>'kind',v->>'note',v->'source',COALESCE(v->'attributes'->>'cardColor',''),ARRAY(SELECT jsonb_array_elements_text(v->'attributes'->'effects')) FROM jsonb_array_elements($1::jsonb) v
 ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,name=EXCLUDED.name,card_type=EXCLUDED.card_type,description=EXCLUDED.description,activation_time=EXCLUDED.activation_time,usage_frequency=EXCLUDED.usage_frequency,usage_location=EXCLUDED.usage_location,tags=EXCLUDED.tags,image_asset_id=EXCLUDED.image_asset_id,change_kind=EXCLUDED.change_kind,editorial_note=EXCLUDED.editorial_note,source=EXCLUDED.source,card_color=EXCLUDED.card_color,effects=EXCLUDED.effects,version=cards.version+1,updated_at=now()`,
    [JSON.stringify(values)],
  );
}
export async function readWorkspace(client?: pg.PoolClient) {
  const read = async (c: pg.PoolClient) => {
    const r = await c.query('SELECT * FROM workspace WHERE id=1');
    if (!r.rowCount) throw new AppError(503, 'База ещё не инициализирована');
    const w = r.rows[0];
    const rows = (await c.query('SELECT * FROM cards ORDER BY position')).rows;
    const cards = rows.map(rowCard);
    return {
      revision: w.revision,
      versions: Object.fromEntries(rows.map((r) => [r.id, r.version])),
      legacyImported: w.legacy_imported,
      base: w.baseline,
      cards,
      release: w.release_title,
      changelog: w.changelog,
      changelogStamp: w.changelog_stamp,
    };
  };
  if (client) return read(client);
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return read(c);
  });
}
// Called inside the card mutation transaction, with the workspace already locked.
export async function refreshChangelog(c: pg.PoolClient) {
  const state = await readWorkspace(c);
  await c.query("UPDATE workspace SET changelog=$1,changelog_stamp='' WHERE id=1", [
    summary(changes(state.base, state.cards)),
  ]);
}
export async function saveWorkspace(
  input: unknown,
  expectedRevision: number,
  legacy = false,
  actor: string | null = null,
) {
  const parsed = draftSchema.parse(input);
  const draft: Draft = {
    ...parsed,
    cards: await Promise.all(
      parsed.cards.map(async (c) => ({ ...c, image: await resolveImage(c.image, legacy) })),
    ),
  };
  return transaction(async (c) => {
    const w = (await c.query('SELECT * FROM workspace WHERE id=1 FOR UPDATE')).rows[0];
    if (w.revision !== expectedRevision)
      throw new AppError(
        409,
        'Правила изменены в другой вкладке. Скачайте свой черновик перед обновлением страницы.',
      );
    if (legacy && (w.legacy_imported || w.revision !== 0))
      throw new AppError(
        409,
        'Браузерный черновик уже перенесён. Серверные данные не перезаписаны.',
      );
    const existing = (await c.query('SELECT id FROM cards')).rows.map((r) => r.id);
    const ids = new Set(draft.cards.map((v) => v.id));
    if (existing.some((id) => !ids.has(id)))
      throw new AppError(400, 'В черновике отсутствуют карточки. Сохранение отменено.');
    if (legacy)
      await c.query('INSERT INTO import_backups(id,payload) VALUES($1,$2)', [
        randomUUID(),
        JSON.stringify(input),
      ]);
    const beforeRows = (await c.query('SELECT * FROM cards')).rows.map(rowCard);
    const beforeMap = new Map(beforeRows.map((card) => [card.id, card]));
    const cardsChanged = draft.cards.some(
      (card) => !isDeepStrictEqual(beforeMap.get(card.id), card),
    );
    await upsertCards(c, draft.cards);
    for (const card of draft.cards) {
      const before = beforeMap.get(card.id);
      if (!isDeepStrictEqual(before, card))
        await audit(c, actor, 'card.import', card.id, before || null, card);
    }
    const updated = await c.query(
      'UPDATE workspace SET revision=revision+1,release_title=$1,changelog=$2,changelog_stamp=$3,legacy_imported=legacy_imported OR $4,updated_at=now() WHERE id=1 RETURNING revision',
      [draft.release, draft.changelog, draft.changelogStamp, legacy],
    );
    if (cardsChanged) await refreshChangelog(c);
    return { revision: updated.rows[0].revision, cards: draft.cards };
  });
}

// Three-way merge of a second browser's legacy draft before the first release.
// Unchanged legacy fields never roll back fields already edited on the server.
export async function mergeLegacyDraft(input: unknown, expectedRevision: number) {
  const { isDeepStrictEqual: equal } = await import('node:util');
  if ((await pool.query('SELECT id FROM releases LIMIT 1')).rowCount)
    throw new AppError(
      409,
      'После первого выпуска автоматический перенос старого черновика отключён. Скачайте его для сверки.',
    );
  const incoming = draftSchema.parse(input);
  const state = await readWorkspace();
  if (state.revision !== expectedRevision)
    throw new AppError(409, 'Серверный черновик изменился. Обновите страницу.');
  const original = new Map<string, Card>(state.base.map((c: Card) => [c.id, c]));
  const current = new Map<string, Card>(state.cards.map((c) => [c.id, structuredClone(c)]));
  const mergedNames: string[] = [];
  for (const raw of incoming.cards) {
    const card = { ...raw, image: await resolveImage(raw.image, true) };
    const base = original.get(card.id),
      existing = current.get(card.id);
    if (!base) {
      if (existing && !equal(existing, card))
        throw new AppError(409, 'Конфликт новой карточки: ' + card.name);
      if (!existing) {
        current.set(card.id, card);
        mergedNames.push(card.name);
      }
      continue;
    }
    if (!existing) throw new AppError(409, 'Карточка отсутствует на сервере: ' + card.name);
    let changed = false;
    for (const key of [
      'name',
      'description',
      'attributes',
      'image',
      'cardType',
      'kind',
      'note',
    ] as const) {
      if (equal(card[key], base[key]) || equal(card[key], existing[key])) continue;
      if (!equal(existing[key], base[key]))
        throw new AppError(
          409,
          'Разные правки одного поля у «' +
            card.name +
            '». Автоматическое объединение остановлено.',
        );
      (existing as any)[key] = card[key];
      changed = true;
    }
    if (changed) mergedNames.push(card.name);
  }
  await pool.query('INSERT INTO import_backups(id,payload) VALUES($1,$2)', [
    randomUUID(),
    JSON.stringify(input),
  ]);
  if (!mergedNames.length) return { revision: state.revision, mergedNames };
  const saved = await saveWorkspace(
    { ...state, cards: [...current.values()], changelogStamp: '' },
    expectedRevision,
  );
  return { revision: saved.revision, mergedNames };
}
