import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pool, transaction } from './index.js';
export async function migrate() {
  await transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(473910)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(path.resolve('backend/db/migrations')))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const sql = await readFile(path.resolve('backend/db/migrations', name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const applied = await c.query('SELECT sha256 FROM schema_migrations WHERE name=$1', [name]);
      if (applied.rowCount) {
        if (applied.rows[0].sha256 !== hash) throw Error('Migration checksum mismatch: ' + name);
        continue;
      }
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)', [name, hash]);
    }
  });
}
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  await migrate();
  console.log('Database migrations applied');
  await pool.end();
}
