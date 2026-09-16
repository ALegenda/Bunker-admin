import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { transaction, pool } from '../db/index.js';
import { cardSchema, AppError, type Card } from '../domain/schema.js';
import { publicCard } from './catalog.js';
import { rowCard } from './workspace.js';
import { writeCard } from './cards.js';
import { audit } from './audit.js';
export const proposalSchema = z
  .object({
    cardId: z.string().min(1).max(100).nullable(),
    name: z.string().trim().min(1).max(250),
    cardType: cardSchema.shape.cardType,
    description: z.string().trim().min(1).max(100000),
    reason: z.string().trim().min(1).max(3000),
  })
  .strict();
export async function submitProposal(input: unknown, author: string) {
  const data = proposalSchema.parse(input);
  return transaction(async (c) => {
    const user = (await c.query('SELECT role,disabled FROM users WHERE id=$1 FOR UPDATE', [author]))
      .rows[0];
    if (!user || user.disabled || !['trusted', 'admin'].includes(user.role))
      throw new AppError(403, 'Недостаточно прав');
    const n = (
      await c.query(
        "SELECT count(*)::int AS n FROM proposals WHERE author_id=$1 AND status='pending'",
        [author],
      )
    ).rows[0].n;
    if (n >= 30) throw new AppError(429, 'Дождитесь рассмотрения предыдущих предложений');
    const base = data.cardId
      ? (await c.query('SELECT data FROM public_cards WHERE id=$1', [data.cardId])).rows[0]?.data
      : null;
    if (data.cardId && !base) throw new AppError(404, 'Карточка не найдена');
    const proposed = base
      ? { ...base, description: data.description }
      : publicCard(cardSchema.parse({ ...data, id: randomUUID() }));
    if (base && base.description === data.description)
      throw new AppError(400, 'Описание не изменилось');
    const id = randomUUID();
    await c.query(
      'INSERT INTO proposals(id,author_id,card_id,base,proposed,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [id, author, data.cardId, JSON.stringify(base), JSON.stringify(proposed), data.reason],
    );
    await audit(c, author, 'proposal.submit', id, null, { cardId: data.cardId });
    return { id };
  });
}
export async function reviewProposal(
  id: string,
  decision: 'accepted' | 'rejected',
  note: string,
  actor: string | null,
) {
  return transaction(async (c) => {
    await c.query('SELECT id FROM workspace WHERE id=1 FOR UPDATE');
    const p = (await c.query('SELECT * FROM proposals WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p) throw new AppError(404, 'Предложение не найдено');
    if (p.status !== 'pending') throw new AppError(409, 'Предложение уже рассмотрено');
    if (decision === 'accepted') {
      let card: Card,
        version: number | null = null;
      if (p.card_id) {
        const old = (await c.query('SELECT * FROM cards WHERE id=$1 FOR UPDATE', [p.card_id]))
          .rows[0];
        if (!old || !equal(old.description, p.base.description))
          throw new AppError(
            409,
            'Описание уже изменено в черновике. Сверьте его с предложением; автоматическое принятие остановлено.',
          );
        card = { ...rowCard(old), description: p.proposed.description };
        version = old.version;
      } else card = cardSchema.parse(p.proposed);
      await writeCard(c, card, version, actor);
      await c.query(
        "UPDATE workspace SET revision=revision+1,changelog_stamp='',updated_at=now() WHERE id=1",
      );
    }
    await c.query(
      'UPDATE proposals SET status=$1,reviewer_id=$2,review_note=$3,reviewed_at=now() WHERE id=$4',
      [decision, actor, note, id],
    );
    await audit(
      c,
      actor,
      'proposal.' + decision,
      id,
      { status: p.status },
      { status: decision, note },
    );
    return { ok: true };
  });
}
export async function listProposals(author: string | null, admin: boolean) {
  return (
    await pool.query(
      `SELECT p.*,u.display_name AS author_name FROM proposals p JOIN users u ON u.id=p.author_id ${admin ? '' : 'WHERE p.author_id=$1'} ORDER BY p.created_at DESC LIMIT 200`,
      admin ? [] : [author],
    )
  ).rows;
}
