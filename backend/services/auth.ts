import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { readFile } from 'node:fs/promises';
import { pool, transaction } from '../db/index.js';
import { config } from '../config.js';
import { AppError } from '../domain/schema.js';
export type Role = 'player' | 'trusted' | 'admin';
export type Actor = { id: string | null; role: Role; display_name: string; csrf: string };
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
const keys = createRemoteJWKSet(new URL('https://oauth.telegram.org/.well-known/jwks.json'));
export async function verifyTelegramToken(token: string, signingKeys?: JWTVerifyGetKey) {
  if (!signingKeys && config.TELEGRAM_JWKS_FILE) {
    try {
      const cached = JSON.parse(await readFile(config.TELEGRAM_JWKS_FILE, 'utf8'));
      const age = Date.now() - Date.parse(cached.fetchedAt);
      if (!Number.isFinite(age) || age < -300000 || age > 7 * 86400000) throw Error('Stale keys');
      signingKeys = createLocalJWKSet({ keys: cached.keys });
    } catch {
      throw new AppError(503, 'Ключи Telegram временно недоступны. Попробуйте позже.');
    }
  }
  const { payload } = await jwtVerify(token, signingKeys || keys, {
    issuer: 'https://oauth.telegram.org',
    audience: config.TELEGRAM_CLIENT_ID,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'iat', 'exp'],
    maxTokenAge: '10m',
  });
  if (!payload.id || !/^\d+$/.test(String(payload.id)) || typeof payload.name !== 'string')
    throw new AppError(401, 'Некорректный ответ Telegram');
  return {
    telegramId: String(payload.id),
    name: payload.name.slice(0, 200),
    username: String(payload.preferred_username || '').slice(0, 100),
    nonce: typeof payload.nonce === 'string' ? payload.nonce : '',
  };
}
export async function issueSession(identity: {
  telegramId: string;
  name: string;
  username: string;
}) {
  const token = randomToken(),
    csrf = randomToken();
  await transaction(async (c) => {
    const admin = config.TELEGRAM_ADMIN_IDS.split(',')
      .map((s) => s.trim())
      .includes(identity.telegramId);
    const r = await c.query(
      `INSERT INTO users(id,telegram_id,display_name,username,role) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(telegram_id) DO UPDATE SET display_name=CASE WHEN users.custom_display_name THEN users.display_name ELSE EXCLUDED.display_name END,username=EXCLUDED.username,last_login_at=now()
      RETURNING id,disabled`,
      [
        randomUUID(),
        identity.telegramId,
        identity.name,
        identity.username,
        admin ? 'admin' : 'player',
      ],
    );
    if (r.rows[0].disabled) throw new AppError(403, 'Доступ отключён администратором');
    await c.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [hash(token), r.rows[0].id, csrf],
    );
    await c.query("INSERT INTO audit_log(actor_id,action,entity_id) VALUES($1,'login',$2)", [
      r.rows[0].id,
      r.rows[0].id,
    ]);
    await c.query('DELETE FROM sessions WHERE expires_at < now()');
    await c.query('DELETE FROM login_attempts WHERE expires_at < now()');
  });
  return token;
}
export async function sessionActor(token?: string): Promise<Actor | null> {
  if (!token || token.length > 100) return null;
  const r = await pool.query(
    `SELECT u.id,u.role,u.display_name,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled`,
    [hash(token)],
  );
  return r.rows[0] || null;
}
