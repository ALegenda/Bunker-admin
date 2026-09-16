import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { pool, transaction } from './db/index.js';
import { renderRules, renderChangelog } from './services/print-template.js';
import { renderPdf } from './services/pdf-renderer.js';
import { putObject } from './services/storage.js';
import { changes } from '../shared/model.js';
let stopped = false;
process.on('SIGTERM', () => {
  stopped = true;
});
process.on('SIGINT', () => {
  stopped = true;
});
export async function runOne() {
  const token = randomUUID();
  const job = await transaction(async (c) => {
    await c.query(
      "UPDATE pdf_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error=CASE WHEN attempts>=3 THEN 'Обработчик сборки несколько раз прервался' ELSE NULL END WHERE status='running' AND lease_until<now()",
    );
    const r = await c.query(
      "SELECT * FROM pdf_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!r.rowCount) return null;
    const job = r.rows[0];
    await c.query(
      "UPDATE pdf_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '90 seconds',lease_token=$2 WHERE id=$1",
      [job.id, token],
    );
    return job;
  });
  if (!job) return false;
  const timer = setInterval(() => {
    pool
      .query(
        "UPDATE pdf_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'",
        [job.id, token],
      )
      .catch(() => {});
  }, 20000);
  try {
    const html = await renderRules(job.snapshot);
    const result = await renderPdf(html);
    const key = `builds/${job.id}/${token}/rules.pdf`,
      htmlKey = `builds/${job.id}/${token}/rules.html`;
    await putObject(key, result.data, 'application/pdf');
    await putObject(htmlKey, Buffer.from(html), 'text/html; charset=utf-8');
    await putObject(
      `builds/${job.id}/${token}/changelog.html`,
      Buffer.from(renderChangelog(job.snapshot)),
      'text/html; charset=utf-8',
    );
    const report = {
      mode: 'html',
      pages: result.pages,
      bytes: result.data.length,
      sha256: createHash('sha256').update(result.data).digest('hex'),
      templateVersion: job.template_version,
      revision: job.workspace_revision,
      appliedChanges: changes(job.snapshot.base, job.snapshot.cards).map(({ card }: any) => ({
        id: card.id,
        name: card.name,
      })),
      warnings: [
        'PDF собран из данных редактора. Переносы и число страниц меняются вместе с содержанием.',
      ],
    };
    await pool.query(
      "UPDATE pdf_jobs SET status='ready',object_key=$3,html_key=$4,report=$5,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2",
      [job.id, token, key, htmlKey, JSON.stringify(report)],
    );
    console.log('PDF ready', job.id, result.pages, 'pages');
  } catch (e) {
    await pool.query(
      "UPDATE pdf_jobs SET status='failed',error=$3,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2",
      [job.id, token, e instanceof Error ? e.message.slice(0, 400) : 'Ошибка генератора'],
    );
    console.error('PDF failed', job.id);
  } finally {
    clearInterval(timer);
  }
  return true;
}
if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  console.log('PDF worker started');
  while (!stopped) {
    try {
      if (!(await runOne())) await sleep(1500);
    } catch (e) {
      console.error('Worker database unavailable; retrying');
      await sleep(5000);
    }
  }
  await pool.end();
}
