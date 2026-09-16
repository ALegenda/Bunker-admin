import { audit } from './audit.js';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { transaction, pool } from '../db/index.js';
import { cardSchema, AppError, type Card } from '../domain/schema.js';
import { rowCard } from './workspace.js';
import { resolveImage } from './storage.js';
// Callers lock workspace first, then the card. Same lock order as publication/import.
export async function writeCard(
  c: pg.PoolClient,
  card: Card,
  version: number | null,
  actor: string | null,
) {
  const old = (await c.query('SELECT * FROM cards WHERE id=$1 FOR UPDATE', [card.id])).rows[0];
  if ((old && old.version !== version) || (!old && version !== null))
    throw new AppError(409, 'Карточка уже изменена. Обновите её перед сохранением.');
  const before = old ? rowCard(old) : null;
  if (before && isDeepStrictEqual(before, card)) return { card: before, version: old.version };
  const imageId = card.image.split('/').at(-1) || null;
  await c.query(
    `INSERT INTO cards(id,position,name,card_type,description,activation_time,usage_frequency,usage_location,tags,image_asset_id,change_kind,editorial_note,source)
    VALUES($1,COALESCE((SELECT max(position)+1 FROM cards),0),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,card_type=EXCLUDED.card_type,description=EXCLUDED.description,activation_time=EXCLUDED.activation_time,usage_frequency=EXCLUDED.usage_frequency,usage_location=EXCLUDED.usage_location,tags=EXCLUDED.tags,image_asset_id=EXCLUDED.image_asset_id,change_kind=EXCLUDED.change_kind,editorial_note=EXCLUDED.editorial_note,source=EXCLUDED.source,version=cards.version+1,updated_at=now()`,
    [
      card.id,
      card.name,
      card.cardType,
      card.description,
      card.attributes.activationTime,
      card.attributes.usageFrequency,
      card.attributes.usageLocation,
      card.attributes.tags,
      imageId,
      card.kind,
      card.note,
      JSON.stringify(card.source || null),
    ],
  );
  await audit(c, actor, old ? 'card.update' : 'card.create', card.id, before, card);
  return { card, version: old ? old.version + 1 : 1 };
}
export async function saveCard(input: unknown, version: number | null, actor: string | null) {
  const card = cardSchema.parse(input);
  card.image = await resolveImage(card.image);
  return transaction(async (c) => {
    await c.query('SELECT id FROM workspace WHERE id=1 FOR UPDATE');
    const result = await writeCard(c, card, version, actor);
    const r = await c.query(
      "UPDATE workspace SET revision=revision+1,changelog_stamp='',updated_at=now() WHERE id=1 RETURNING revision",
    );
    return { ...result, revision: r.rows[0].revision };
  });
}
export async function saveReleaseMeta(
  input: { revision: number; release: string; changelog: string; changelogStamp: string },
  actor: string | null,
) {
  return transaction(async (c) => {
    const old = (await c.query('SELECT * FROM workspace WHERE id=1 FOR UPDATE')).rows[0];
    if (old.revision !== input.revision)
      throw new AppError(409, 'Черновик изменился. Обновите страницу публикации.');
    const r = await c.query(
      'UPDATE workspace SET release_title=$1,changelog=$2,changelog_stamp=$3,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision',
      [input.release, input.changelog, input.changelogStamp],
    );
    await audit(c, actor, 'release.prepare', 'workspace', null, input);
    return { revision: r.rows[0].revision };
  });
}
export async function cardHistory(id: string) {
  return (
    await pool.query(
      'SELECT a.id,a.action,a.before_data,a.after_data,a.created_at,u.display_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_id=$1 ORDER BY a.id DESC LIMIT 100',
      [id],
    )
  ).rows;
}
