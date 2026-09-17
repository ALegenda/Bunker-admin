import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { pool, transaction } from './db/index.js';
import { renderRules, renderChangelog } from './services/print-template.js';
import { renderPdf } from './services/pdf-renderer.js';
import { putObject } from './services/storage.js';
import { createPdfLog, pdfError } from './services/pdf-log.js';
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
  const log = createPdfLog({ jobId: job.id, attempt: job.attempts + 1, attemptId: token });
  log.event('job.started', {
    revision: job.workspace_revision,
    templateVersion: job.template_version,
    ageSinceQueuedMs: Math.max(0, Date.now() - new Date(job.created_at).getTime()),
    cards: job.snapshot.cards.length,
  });
  const timer = setInterval(() => {
    pool
      .query(
        "UPDATE pdf_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'",
        [job.id, token],
      )
      .catch((e) => log.event('job.lease_renewal_failed', pdfError(e)));
  }, 20000);
  try {
    const html = await log.stage('html.render', () => renderRules(job.snapshot, log));
    log.event('html.ready', { bytes: Buffer.byteLength(html) });
    const result = await log.stage('pdf.render', () => renderPdf(html, log));
    const key = `builds/${job.id}/${token}/rules.pdf`,
      htmlKey = `builds/${job.id}/${token}/rules.html`;
    await log.stage('upload.pdf', () => putObject(key, result.data, 'application/pdf'), {
      bytes: result.data.length,
    });
    await log.stage('upload.html', () =>
      putObject(htmlKey, Buffer.from(html), 'text/html; charset=utf-8'),
    );
    await log.stage('upload.changelog', () =>
      putObject(
        `builds/${job.id}/${token}/changelog.html`,
        Buffer.from(renderChangelog(job.snapshot)),
        'text/html; charset=utf-8',
      ),
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
    await log.stage('job.save_result', () =>
      pool.query(
        "UPDATE pdf_jobs SET status='ready',object_key=$3,html_key=$4,report=$5,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2",
        [job.id, token, key, htmlKey, JSON.stringify(report)],
      ),
    );
    log.event('job.ready', { pages: result.pages, bytes: result.data.length });
  } catch (e) {
    log.event('job.failed', pdfError(e));
    await log.stage('job.save_failure', () =>
      pool.query(
        "UPDATE pdf_jobs SET status='failed',error=$3,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2",
        [job.id, token, e instanceof Error ? e.message.slice(0, 400) : 'Ошибка генератора'],
      ),
    );
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
      createPdfLog({}).event('worker.loop_failed', { ...pdfError(e), retryAfterMs: 5000 });
      await sleep(5000);
    }
  }
  await pool.end();
}
