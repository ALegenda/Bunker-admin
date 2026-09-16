import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pool } from './db/index.js';
import { getObject } from './services/storage.js';
const dir = path.resolve('tmp/backups', new Date().toISOString().replaceAll(':', '-'));
await mkdir(dir, { recursive: true, mode: 0o700 });
try {
  const dump = spawn(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'bunker', '-d', 'bunker', '-Fc'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const ended = new Promise<void>((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', (code) => (code === 0 ? resolve() : reject(Error('pg_dump failed'))));
  });
  await Promise.all([
    pipeline(dump.stdout, createWriteStream(path.join(dir, 'database.dump'), { mode: 0o600 })),
    ended,
  ]);
  const keys = new Set<string>(
    (await pool.query('SELECT object_key FROM assets')).rows.map((r) => r.object_key),
  );
  for (const row of (
    await pool.query("SELECT id,object_key,html_key FROM pdf_jobs WHERE status='ready'")
  ).rows) {
    keys.add(row.object_key);
    keys.add(row.html_key);
    keys.add(`${path.posix.dirname(row.html_key)}/changelog.html`);
  }
  const manifest = [];
  for (const key of keys) {
    const object = await getObject(key);
    const file = path.join(dir, 'objects', key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, object.data, { mode: 0o600 });
    manifest.push({
      key,
      mime: object.mime,
      bytes: object.data.length,
      sha256: createHash('sha256').update(object.data).digest('hex'),
    });
  }
  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), objects: manifest }, null, 2),
    { mode: 0o600 },
  );
  console.log(`Backup complete: ${dir} (${manifest.length} objects)`);
} finally {
  await pool.end();
}
