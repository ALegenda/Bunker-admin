import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, transaction } from '../../db/index.js';
import { audit } from '../../services/audit.js';
import { requireRole } from '../security.js';
import { AppError } from '../../../shared/schema.js';
import { achievementComplete } from '../../../shared/achievements.js';
import type { Achievement, PlayerProfile } from '../../../shared/contracts.js';

const idOf = (v: unknown) => z.object({ id: z.string().uuid() }).parse(v).id;
const cardIdOf = (v: unknown) => z.object({ cardId: z.string().min(1).max(100) }).parse(v).cardId;
function playerId(req: FastifyRequest) {
  const actor = requireRole(req, 'player', 'trusted', 'admin');
  if (!actor.id) throw new AppError(400, 'Профиль доступен после входа через Telegram');
  return actor.id;
}
async function profile(userId: string) {
  const r = await pool.query(
    `SELECT u.id AS "userId", u.display_name AS name, u.role,
    COALESCE(p.level,1) AS level, COALESCE(p.balance,0) AS balance,
    COALESCE(p.achievements,'[]'::jsonb) AS achievements, COALESCE(p.revision,0) AS revision
    FROM users u LEFT JOIN player_profiles p ON p.user_id=u.id WHERE u.id=$1`,
    [userId],
  );
  if (!r.rowCount) throw new AppError(404, 'Игрок не найден');
  const history = await pool.query(
    `SELECT id::text,created_at,before_data,after_data FROM audit_log
    WHERE entity_id=$1 AND action='profile.progress' ORDER BY audit_log.id DESC LIMIT 100`,
    [userId],
  );
  return { profile: r.rows[0] as PlayerProfile, history: history.rows };
}
async function requireCard(cardId: string) {
  if (!(await pool.query('SELECT 1 FROM public_cards WHERE id=$1', [cardId])).rowCount)
    throw new AppError(404, 'Карточка не найдена');
}
const tipSelect = `SELECT t.id,t.card_id,c.data->>'name' AS card_name,u.display_name AS author_name,
  t.body,t.status,t.created_at`;
const tipJoins =
  ' FROM card_tips t JOIN users u ON u.id=t.author_id JOIN public_cards c ON c.id=t.card_id';

export async function playerRoutes(app: FastifyInstance) {
  const definitionFields = {
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500),
    target: z.number().int().min(1).max(1000000),
  };
  app.get('/api/achievements', async (req) => {
    requireRole(req, 'admin');
    return {
      achievements: (
        await pool.query(
          'SELECT id,title,description,target,revision FROM achievement_definitions ORDER BY created_at,id',
        )
      ).rows,
    };
  });
  app.post('/api/achievements', async (req) => {
    const actor = requireRole(req, 'admin');
    const b = z.object(definitionFields).strict().parse(req.body),
      id = randomUUID();
    await transaction(async (c) => {
      await c.query(
        'INSERT INTO achievement_definitions(id,title,description,target) VALUES($1,$2,$3,$4)',
        [id, b.title, b.description, b.target],
      );
      await audit(c, actor.id, 'achievement.create', id, null, b);
    });
    return { id, ...b, revision: 0 };
  });
  app.patch('/api/achievements/:id', async (req) => {
    const actor = requireRole(req, 'admin'),
      id = idOf(req.params);
    const b = z
      .object({ ...definitionFields, revision: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    await transaction(async (c) => {
      const before = (
        await c.query('SELECT * FROM achievement_definitions WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!before) throw new AppError(404, 'Достижение не найдено');
      if (before.revision !== b.revision)
        throw new AppError(409, 'Достижение уже изменено. Обновите каталог.');
      await c.query(
        'UPDATE achievement_definitions SET title=$1,description=$2,target=$3,revision=revision+1 WHERE id=$4',
        [b.title, b.description, b.target, id],
      );
      await audit(c, actor.id, 'achievement.update', id, before, b);
    });
    return { id, ...b, revision: b.revision + 1 };
  });

  app.get('/api/profile', async (req) => profile(playerId(req)));
  app.patch('/api/profile', async (req) => {
    const id = playerId(req);
    const { name } = z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'Имя должно быть в одну строку'),
      })
      .strict()
      .parse(req.body);
    await transaction(async (c) => {
      const before = (await c.query('SELECT display_name FROM users WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      await c.query('UPDATE users SET display_name=$1,custom_display_name=true WHERE id=$2', [
        name,
        id,
      ]);
      await audit(c, id, 'profile.name', id, { name: before.display_name }, { name });
    });
    return profile(id);
  });
  app.get('/api/users/:id/profile', async (req) => {
    requireRole(req, 'admin');
    return profile(idOf(req.params));
  });
  app.patch('/api/users/:id/profile', async (req) => {
    const actor = requireRole(req, 'admin'),
      id = idOf(req.params);
    const b = z
      .object({
        revision: z.number().int().nonnegative(),
        level: z.number().int().min(1).max(1000000),
        balance: z.number().int().min(0).max(2147483647),
        achievements: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                title: z.string().trim().min(1).max(100),
                description: z.string().trim().max(500),
                awardedAt: z.iso.datetime().nullable(),
                target: z.number().int().min(1).max(1000000).optional(),
                progress: z.number().int().min(0).max(1000000).optional(),
              })
              .strict(),
          )
          .max(200),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .refine(
        (v) => new Set(v.achievements.map((a) => a.id)).size === v.achievements.length,
        'Достижения не должны повторяться',
      )
      .refine(
        (v) => v.achievements.every((a) => (a.progress ?? 1) <= (a.target ?? 1)),
        'Прогресс не может превышать цель',
      )
      .parse(req.body);
    await transaction(async (c) => {
      if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id])).rowCount)
        throw new AppError(404, 'Игрок не найден');
      await c.query('INSERT INTO player_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
      const before = (
        await c.query(
          'SELECT level,balance,achievements,revision FROM player_profiles WHERE user_id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (before.revision !== b.revision)
        throw new AppError(409, 'Профиль уже изменён. Откройте его заново перед начислением.');
      b.achievements = b.achievements.map((a) => {
        const previous = (before.achievements as Achievement[]).find((old) => old.id === a.id);
        return {
          ...a,
          awardedAt: achievementComplete(a)
            ? previous && achievementComplete(previous)
              ? previous.awardedAt || new Date().toISOString()
              : a.target === undefined && a.progress === undefined
                ? a.awardedAt || new Date().toISOString()
                : new Date().toISOString()
            : null,
        };
      });
      await c.query(
        'UPDATE player_profiles SET level=$1,balance=$2,achievements=$3,revision=revision+1 WHERE user_id=$4',
        [b.level, b.balance, JSON.stringify(b.achievements), id],
      );
      await audit(c, actor.id, 'profile.progress', id, before, b);
    });
    return profile(id);
  });
  app.get('/api/catalog/:cardId/tips', async (req) => {
    const cardId = cardIdOf(req.params);
    await requireCard(cardId);
    const trusted = req.actor?.role === 'trusted' || req.actor?.role === 'admin';
    const admin = req.actor?.role === 'admin';
    const tips = await pool.query(
      tipSelect +
        (trusted
          ? `,CASE WHEN t.author_id=$2 OR $3 THEN t.review_note ELSE NULL END AS review_note`
          : '') +
        tipJoins +
        (trusted
          ? ` WHERE t.card_id=$1 AND (t.status IN ('pending','published') OR t.author_id=$2 OR $3)`
          : ` WHERE t.card_id=$1 AND t.status='published'`) +
        ' ORDER BY t.created_at DESC,t.id DESC',
      trusted ? [cardId, req.actor?.id, admin] : [cardId],
    );
    return { tips: tips.rows };
  });
  app.post(
    '/api/catalog/:cardId/tips',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      requireRole(req, 'trusted', 'admin');
      const author = playerId(req),
        cardId = cardIdOf(req.params);
      const { body } = z
        .object({ body: z.string().trim().min(1).max(3000) })
        .strict()
        .parse(req.body);
      await requireCard(cardId);
      const id = randomUUID();
      await pool.query('INSERT INTO card_tips(id,card_id,author_id,body) VALUES($1,$2,$3,$4)', [
        id,
        cardId,
        author,
        body,
      ]);
      return { id };
    },
  );
  app.get('/api/tips', async (req) => {
    requireRole(req, 'admin');
    return {
      tips: (
        await pool.query(
          tipSelect +
            ',t.review_note' +
            tipJoins +
            ` ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,t.created_at DESC,t.id DESC`,
        )
      ).rows,
    };
  });
  app.post('/api/tips/:id/review', async (req) => {
    const actor = requireRole(req, 'admin'),
      id = idOf(req.params);
    const b = z
      .object({
        status: z.enum(['published', 'rejected']),
        expectedStatus: z.enum(['pending', 'published', 'rejected']),
        note: z.string().trim().max(1000).default(''),
      })
      .strict()
      .parse(req.body);
    await transaction(async (c) => {
      const before = (await c.query('SELECT * FROM card_tips WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!before) throw new AppError(404, 'Совет не найден');
      if (before.status !== b.expectedStatus)
        throw new AppError(409, 'Совет уже рассмотрен. Обновите список.');
      await c.query(
        'UPDATE card_tips SET status=$1,review_note=$2,reviewer_id=$3,reviewed_at=now() WHERE id=$4',
        [b.status, b.note, actor.id, id],
      );
      await audit(
        c,
        actor.id,
        'tip.review',
        id,
        { status: before.status, note: before.review_note },
        b,
      );
    });
    return { ok: true };
  });
}
