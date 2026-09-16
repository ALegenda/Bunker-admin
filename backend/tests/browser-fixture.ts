// Disposable loopback-only UI fixture. Never imported by the production server.
import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const control = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = 'bunker_ui_' + randomUUID().replaceAll('-', '');
const original = (await control.query('SELECT * FROM cards ORDER BY position')).rows;
const assets = (await control.query('SELECT * FROM assets')).rows;
await control.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('options', '-c search_path=' + schema);
process.env.DATABASE_URL = url.toString();
process.env.AUTH_MODE = 'telegram';
process.env.PUBLIC_ORIGIN = 'http://localhost:4174';
process.env.TELEGRAM_CLIENT_ID = 'test';
process.env.TELEGRAM_CLIENT_SECRET = 'test';
process.env.TELEGRAM_ADMIN_IDS = '100';
process.env.HOST = '127.0.0.1';
process.env.PORT = '4174';
process.env.NODE_ENV = 'test';
const { pool, transaction } = await import('../db/index.js');
const { migrate } = await import('../db/migrate.js');
const { upsertCards, rowCard } = await import('../services/workspace.js');
const { refreshCatalog } = await import('../services/catalog.js');
const { issueSession } = await import('../services/auth.js');
const { createApp } = await import('../http/app.js');
await migrate();
await transaction(async (c) => {
  await c.query('INSERT INTO assets SELECT * FROM json_populate_recordset(NULL::assets,$1::json)', [
    JSON.stringify(assets),
  ]);
  const cards = original.map(rowCard);
  await upsertCards(c, cards);
  await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [JSON.stringify(cards)]);
  await refreshCatalog(c, cards);
});
const tokens: Record<string, string> = {};
for (const [role, id] of [
  ['admin', '100'],
  ['trusted', '200'],
  ['player', '300'],
]) {
  tokens[role] = await issueSession({ telegramId: id, name: 'Тест: ' + role, username: role });
  await pool.query('UPDATE users SET role=$1 WHERE telegram_id=$2', [role, id]);
}
const app = await createApp();
app.get('/auth/test/:role', async (req, reply) => {
  const role = (req.params as { role: string }).role;
  const token = tokens[role];
  if (!token) return reply.code(404).send({ error: 'No test role' });
  reply.setCookie('bunker_session', token, { httpOnly: true, sameSite: 'lax', path: '/' });
  return reply.redirect(role === 'admin' ? '/admin' : '/');
});
await app.listen({ host: '127.0.0.1', port: 4174 });
console.log('Disposable UI fixture: http://localhost:4174/auth/test/admin');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
    process.exit(0);
  });
