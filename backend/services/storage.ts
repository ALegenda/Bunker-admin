import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import type { PdfLog } from './pdf-log.js';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { AppError } from '../domain/schema.js';
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  maxAttempts: 3,
  requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});
export async function storageHealthy() {
  await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
}
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch (e: any) {
    if (![404, 400].includes(e.$metadata?.httpStatusCode)) throw e;
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
}
export async function putObject(key: string, data: Buffer, mime: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: data, ContentType: mime }),
  );
}
export async function getObject(key: string) {
  const result = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  return {
    data: Buffer.from(await result.Body!.transformToByteArray()),
    mime: result.ContentType || 'application/octet-stream',
  };
}
export async function storeImage(input: Buffer, alias?: string) {
  if (input.length > 12 * 1024 * 1024) throw new AppError(413, 'Изображение слишком большое');
  let data: Buffer, meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format || '')) throw Error();
    data = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .webp({ quality: 95 })
      .toBuffer();
  } catch {
    throw new AppError(400, 'Нужна корректная картинка PNG, JPG или WebP');
  }
  const digest = createHash('sha256').update(data).digest('hex');
  const key = `images/${digest}.webp`;
  const existing = await pool.query('SELECT id FROM assets WHERE sha256=$1', [digest]);
  let id = existing.rows[0]?.id as string | undefined;
  if (!id) {
    await putObject(key, data, 'image/webp');
    const inserted = await pool.query(
      'INSERT INTO assets(id,object_key,sha256,mime,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id',
      [randomUUID(), key, digest, 'image/webp', data.length, meta.width, meta.height],
    );
    id = inserted.rows[0].id;
  }
  if (alias)
    await pool.query(
      'INSERT INTO asset_aliases(path,asset_id) VALUES($1,$2) ON CONFLICT(path) DO NOTHING',
      [alias, id],
    );
  return `/api/assets/${id}`;
}
export async function resolveImage(value: string, allowLegacy = false): Promise<string> {
  if (!value) return '';
  const match = value.match(/^\/api\/assets\/([a-f0-9-]{36})$/);
  if (match) {
    const result = await pool.query('SELECT id FROM assets WHERE id=$1', [match[1]]);
    if (result.rowCount) return value;
  }
  if (allowLegacy) {
    if (value.startsWith('data:image/')) {
      const raw = value.match(/^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
      if (!raw) throw new AppError(400, 'Некорректное изображение черновика');
      return storeImage(Buffer.from(raw[1], 'base64'));
    }
    const r = await pool.query('SELECT asset_id FROM asset_aliases WHERE path=$1', [value]);
    if (r.rowCount) return `/api/assets/${r.rows[0].asset_id}`;
  }
  throw new AppError(400, 'Изображение не найдено в хранилище. Загрузите его заново.');
}
export async function imageDataUrl(url: string, log?: PdfLog) {
  if (!url) return '';
  const id = url.match(/^\/api\/assets\/([a-f0-9-]{36})$/)?.[1];
  if (!id) throw Error('Unsupported image reference');
  const measure = <T>(name: string, action: () => Promise<T>) =>
    log ? log.stage(name, action, { assetId: id }) : action();
  const r = await measure('image.lookup', () =>
    pool.query('SELECT object_key FROM assets WHERE id=$1', [id]),
  );
  if (!r.rowCount) throw Error('Missing asset');
  const object = await measure('image.download', () => getObject(r.rows[0].object_key));
  const printImage = await measure('image.convert', () =>
    sharp(object.data)
      .resize({ width: 400, height: 620, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' })
      .jpeg({ quality: 88 })
      .toBuffer(),
  );
  log?.event('image.ready', {
    assetId: id,
    inputBytes: object.data.length,
    outputBytes: printImage.length,
  });
  return `data:image/jpeg;base64,${printImage.toString('base64')}`;
}
