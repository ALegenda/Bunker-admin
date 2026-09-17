import { security } from './security.js';
import { authRoutes } from './routes/auth.js';
import { playerRoutes } from './routes/players.js';
import { communityRoutes } from './routes/community.js';
import { publicAsset } from '../services/catalog.js';
import { saveCard, resetCard, saveReleaseMeta, cardHistory } from '../services/cards.js';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { readWorkspace, saveWorkspace, mergeLegacyDraft } from '../services/workspace.js';
import { storeImage, getObject, storageHealthy } from '../services/storage.js';
import { currentJob, jobResponse, createJob, getJob, publish } from '../services/jobs.js';
import { renderChangelog } from '../services/print-template.js';
import { AppError } from '../domain/schema.js';
const revisionBody = z.object({ revision: z.number().int().nonnegative() });
const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
export async function createApp() {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      serializers: {
        req: (r) => ({ method: r.method, url: r.url?.split('?')[0], hostname: r.hostname }),
      },
    },
    bodyLimit: 20 * 1024 * 1024,
    requestTimeout: 30000,
    connectionTimeout: 15000,
  });
  await security(app);
  await authRoutes(app);
  await communityRoutes(app);
  await playerRoutes(app);
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Некорректные данные',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const status = (error as any).statusCode || 500;
    if (status >= 500) req.log.error(error);
    reply.code(status).send({
      error:
        status >= 500
          ? 'Сервис временно недоступен. Повторите попытку.'
          : error instanceof Error
            ? error.message
            : 'Ошибка запроса',
    });
  });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  app.get('/api/health', async () => {
    await Promise.all([pool.query('SELECT 1'), storageHealthy()]);
    return { status: 'ok', storage: 'postgresql+s3' };
  });
  app.put('/api/cards/:id', async (req) => {
    const body = z
      .object({ card: z.unknown(), version: z.number().int().positive().nullable() })
      .parse(req.body);
    const id = z.object({ id: z.string().min(1).max(100) }).parse(req.params).id;
    if ((body.card as { id?: string })?.id !== id)
      throw new AppError(400, 'Идентификаторы карточки не совпадают');
    return saveCard(body.card, body.version, req.actor?.id || null);
  });
  app.post('/api/cards/:id/reset', async (req) => {
    const { version } = z
      .object({ version: z.number().int().positive().nullable() })
      .parse(req.body);
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    return resetCard(id, version, req.actor?.id || null);
  });
  app.get('/api/cards/:id/history', async (req) => ({
    history: await cardHistory(z.object({ id: z.string().max(100) }).parse(req.params).id),
  }));
  app.patch('/api/workspace/meta', async (req) =>
    saveReleaseMeta(
      z
        .object({
          revision: z.number().int().nonnegative(),
          release: z.string().min(1).max(200),
          changelog: z.string().max(200000),
          changelogStamp: z.string().max(100),
        })
        .parse(req.body),
      req.actor?.id || null,
    ),
  );
  app.get('/api/workspace', async () => readWorkspace());
  app.put('/api/workspace', async (req) => {
    const body = z
      .object({ revision: z.number().int().nonnegative(), draft: z.unknown() })
      .parse(req.body);
    return saveWorkspace(body.draft, body.revision, false, req.actor?.id || null);
  });
  app.post('/api/import/legacy', async (req) => {
    const body = z
      .object({ revision: z.number().int().nonnegative(), draft: z.unknown() })
      .parse(req.body);
    return saveWorkspace(body.draft, body.revision, true, req.actor?.id || null);
  });
  app.post('/api/import/merge', async (req) => {
    const body = z
      .object({ revision: z.number().int().nonnegative(), draft: z.unknown() })
      .parse(req.body);
    return mergeLegacyDraft(body.draft, body.revision);
  });
  app.post('/api/assets', async (req) => {
    const file = await req.file();
    if (!file) throw new AppError(400, 'Выберите изображение');
    const data = await file.toBuffer();
    return { image: await storeImage(data) };
  });
  app.get('/api/assets/:id', async (req, reply) => {
    if (req.actor?.role !== 'admin' && !(await publicAsset(idOf(req.params))))
      throw new AppError(404, 'Изображение не найдено');
    const r = await pool.query('SELECT object_key,mime,sha256 FROM assets WHERE id=$1', [
      idOf(req.params),
    ]);
    if (!r.rowCount) throw new AppError(404, 'Изображение не найдено');
    const { data } = await getObject(r.rows[0].object_key);
    return reply
      .type(r.rows[0].mime)
      .header('Cache-Control', 'private,max-age=31536000,immutable')
      .header('ETag', r.rows[0].sha256)
      .send(data);
  });
  app.post('/api/pdf/build', async (req, reply) => {
    const { revision } = revisionBody.parse(req.body);
    const job = await createJob(revision);
    return reply
      .code(202)
      .send({ jobId: job.id, status: job.status === 'queued' ? 'running' : job.status });
  });
  app.get('/api/pdf/current', async () => {
    const job = await currentJob();
    return { job: job ? jobResponse(job) : null };
  });
  app.get('/api/pdf/jobs/:id', async (req) => jobResponse(await getJob(idOf(req.params))));
  app.get('/api/pdf/jobs/:id/file', async (req, reply) => {
    const job = await getJob(idOf(req.params));
    if (job.status !== 'ready') throw new AppError(409, 'PDF ещё не собран');
    const object = await getObject(job.object_key);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'inline; filename="bunker-rules.pdf"')
      .send(object.data);
  });
  app.get('/api/pdf/jobs/:id/html', async (req, reply) => {
    const job = await getJob(idOf(req.params));
    if (job.status !== 'ready') throw new AppError(409, 'HTML ещё не собран');
    const object = await getObject(job.html_key);
    return reply.type('text/html; charset=utf-8').send(object.data);
  });
  app.post('/api/releases', async (req, reply) => {
    const body = z
      .object({ jobId: z.string().uuid(), revision: z.number().int().nonnegative() })
      .parse(req.body);
    return reply.code(201).send(await publish(body.jobId, body.revision, req.actor?.id || null));
  });
  app.get('/api/releases', async () => ({
    releases: (
      await pool.query(
        'SELECT id,title,workspace_revision,created_at FROM releases ORDER BY created_at DESC',
      )
    ).rows,
  }));
  app.get('/releases/:id', async (req, reply) => {
    const r = await pool.query('SELECT snapshot FROM releases WHERE id=$1', [idOf(req.params)]);
    if (!r.rowCount) throw new AppError(404, 'Выпуск не найден');
    return reply.type('text/html; charset=utf-8').send(renderChangelog(r.rows[0].snapshot));
  });
  app.get('/releases/:id/pdf', async (req, reply) => {
    const r = await pool.query(
      'SELECT j.object_key FROM releases r JOIN pdf_jobs j ON j.id=r.pdf_job_id WHERE r.id=$1',
      [idOf(req.params)],
    );
    if (!r.rowCount) throw new AppError(404, 'Выпуск не найден');
    return reply.type('application/pdf').send((await getObject(r.rows[0].object_key)).data);
  });
  await app.register(staticFiles, {
    root: path.resolve('web-dist'),
    cacheControl: true,
    maxAge: '1y',
    immutable: true,
    setHeaders: (response, file) => {
      if (file.endsWith('index.html')) response.header('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (
      req.method === 'GET' &&
      ['/', '/admin', '/proposals', '/users', '/profile', '/tips', '/achievements'].includes(
        req.url.split('?')[0],
      )
    )
      return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
    return reply.code(404).send({ error: 'Страница не найдена' });
  });
  return app;
}
