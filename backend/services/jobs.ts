import { createPdfLog } from './pdf-log.js';
import { refreshCatalog } from './catalog.js';
import { audit } from './audit.js';
import { randomUUID } from 'node:crypto';
import { transaction, pool } from '../db/index.js';
import { readWorkspace } from './workspace.js';
import { AppError } from '../domain/schema.js';
import { changes, changeStamp } from '../../shared/model.js';
export const TEMPLATE_VERSION = 'rules-html-v3';
export async function createJob(expectedRevision: number) {
  const result = await transaction(async (c) => {
    await c.query('SELECT id FROM workspace WHERE id=1 FOR UPDATE');
    const state = await readWorkspace(c);
    if (state.revision !== expectedRevision)
      throw new AppError(409, 'Черновик изменился. Сначала сохраните правки.');
    const old = await c.query(
      "SELECT id,status FROM pdf_jobs WHERE workspace_revision=$1 AND template_version=$2 AND status IN ('queued','running','ready') ORDER BY created_at DESC LIMIT 1",
      [state.revision, TEMPLATE_VERSION],
    );
    if (old.rowCount) {
      createPdfLog({ jobId: old.rows[0].id }).event('job.reused', {
        status: old.rows[0].status,
        revision: state.revision,
      });
      return old.rows[0];
    }
    const id = randomUUID();
    await c.query(
      'INSERT INTO pdf_jobs(id,workspace_revision,snapshot,template_version) VALUES($1,$2,$3,$4)',
      [id, state.revision, JSON.stringify(state), TEMPLATE_VERSION],
    );
    return { id, status: 'queued' };
  });
  createPdfLog({ jobId: result.id }).event('job.requested', {
    status: result.status,
    revision: expectedRevision,
  });
  return result;
}
export async function currentJob() {
  const r = await pool.query(
    `SELECT j.id FROM pdf_jobs j JOIN workspace w ON w.id=1 AND w.revision=j.workspace_revision
     WHERE j.template_version=$1 ORDER BY j.created_at DESC LIMIT 1`,
    [TEMPLATE_VERSION],
  );
  return r.rowCount ? getJob(r.rows[0].id) : null;
}
export function jobResponse(job: any) {
  return {
    ...job.report,
    jobId: job.id,
    revision: job.workspace_revision,
    status: job.status === 'queued' ? 'running' : job.status,
    error: job.error,
    url: job.status === 'ready' ? `/api/pdf/jobs/${job.id}/file` : undefined,
  };
}
export async function getJob(id: string) {
  const r = await pool.query(
    'SELECT id,status,workspace_revision,report,error,object_key,html_key FROM pdf_jobs WHERE id=$1',
    [id],
  );
  if (!r.rowCount) throw new AppError(404, 'Сборка не найдена');
  return r.rows[0];
}
export async function publish(
  jobId: string,
  expectedRevision: number,
  actor: string | null = null,
) {
  return transaction(async (c) => {
    await c.query('SELECT id FROM workspace WHERE id=1 FOR UPDATE');
    const state = await readWorkspace(c);
    if (state.revision !== expectedRevision)
      throw new AppError(409, 'Черновик изменился после проверки');
    const job = (await c.query('SELECT * FROM pdf_jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
    if (!job || job.status !== 'ready' || job.workspace_revision !== state.revision)
      throw new AppError(409, 'Соберите PDF для текущего черновика');
    if (
      !state.changelog.trim() ||
      state.changelogStamp !== changeStamp(changes(state.base, state.cards))
    )
      throw new AppError(409, 'Проверьте и подтвердите актуальную сводку изменений');
    const id = randomUUID();
    await c.query(
      'INSERT INTO releases(id,title,workspace_revision,snapshot,changelog,pdf_job_id) VALUES($1,$2,$3,$4,$5,$6)',
      [id, state.release, state.revision, JSON.stringify(job.snapshot), state.changelog, jobId],
    );
    await c.query(
      "UPDATE workspace SET baseline=$1,revision=revision+1,changelog='',changelog_stamp='',updated_at=now() WHERE id=1",
      [JSON.stringify(state.cards)],
    );
    await refreshCatalog(c, state.cards);
    await audit(c, actor, 'release.publish', id, null, {
      title: state.release,
      revision: state.revision,
    });
    return { id };
  });
}
