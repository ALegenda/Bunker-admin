import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, transaction } from '../../db/index.js';
import { catalog } from '../../services/catalog.js';
import { submitProposal, listProposals, reviewProposal } from '../../services/proposals.js';
import { audit } from '../../services/audit.js';
import { requireRole } from '../security.js';
import { AppError } from '../../domain/schema.js';
const idOf = (v: unknown) => z.object({ id: z.string().uuid() }).parse(v).id;
export async function communityRoutes(app: FastifyInstance) {
  app.get('/api/catalog', async () => catalog());
  app.get('/api/proposals', async (req) => {
    const actor = requireRole(req, 'trusted', 'admin');
    return { proposals: await listProposals(actor.id, actor.role === 'admin') };
  });
  app.post('/api/proposals', async (req) => {
    const actor = requireRole(req, 'trusted', 'admin');
    if (!actor.id) throw new AppError(400, 'Для предложений войдите через Telegram');
    return submitProposal(req.body, actor.id);
  });
  app.post('/api/proposals/:id/review', async (req) => {
    const a = requireRole(req, 'admin');
    const body = z
      .object({
        decision: z.enum(['accepted', 'rejected']),
        note: z.string().max(3000).default(''),
      })
      .strict()
      .parse(req.body);
    return reviewProposal(idOf(req.params), body.decision, body.note, a.id);
  });
  app.post('/api/proposals/:id/withdraw', async (req) => {
    const a = requireRole(req, 'trusted', 'admin');
    const r = await pool.query(
      "UPDATE proposals SET status='withdrawn',reviewed_at=now() WHERE id=$1 AND author_id=$2 AND status='pending' RETURNING id",
      [idOf(req.params), a.id],
    );
    if (!r.rowCount) throw new AppError(409, 'Предложение недоступно для отзыва');
    return { ok: true };
  });
  app.get('/api/users', async () => ({
    users: (
      await pool.query(
        'SELECT id,telegram_id,display_name,username,role,disabled,last_login_at FROM users ORDER BY created_at DESC LIMIT 1000',
      )
    ).rows,
  }));
  app.patch('/api/users/:id', async (req) => {
    const actor = requireRole(req, 'admin'),
      id = idOf(req.params);
    const b = z
      .object({ role: z.enum(['player', 'trusted', 'admin']), disabled: z.boolean() })
      .strict()
      .parse(req.body);
    return transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(473911)');
      const user = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!user) throw new AppError(404, 'Пользователь не найден');
      if (user.role === 'admin' && !user.disabled && (b.role !== 'admin' || b.disabled)) {
        const n = (
          await c.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND NOT disabled")
        ).rows[0].n;
        if (n <= 1) throw new AppError(409, 'Нельзя отключить последнего администратора');
      }
      await c.query('UPDATE users SET role=$1,disabled=$2 WHERE id=$3', [b.role, b.disabled, id]);
      await c.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await audit(c, actor.id, 'user.access', id, { role: user.role, disabled: user.disabled }, b);
      return { ok: true };
    });
  });
}
