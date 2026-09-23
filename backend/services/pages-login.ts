import { createHash } from 'node:crypto';
import { pool } from '../db/index.js';
import { hash, randomToken, sessionActor } from './auth.js';
import { AppError } from '../domain/schema.js';

export const pagesChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

export async function issuePagesCode(token: string, challenge: string) {
  const code = randomToken();
  await pool.query('DELETE FROM pages_login_codes WHERE expires_at < now()');
  await pool.query(
    "INSERT INTO pages_login_codes(code_hash,challenge,session_token,expires_at) VALUES($1,$2,$3,now()+interval '60 seconds')",
    [hash(code), challenge, token],
  );
  return code;
}

export async function exchangePagesCode(code: string, verifier: string) {
  const result = await pool.query(
    'DELETE FROM pages_login_codes WHERE code_hash=$1 AND challenge=$2 AND expires_at>now() RETURNING session_token',
    [hash(code), pagesChallenge(verifier)],
  );
  const token = result.rows[0]?.session_token;
  if (!token || !(await sessionActor(token)))
    throw new AppError(401, 'Вход устарел. Войдите через Telegram ещё раз.');
  return token as string;
}
