import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('web-dist');
const base = process.env.VITE_APP_BASE || '/';
if (base !== '/Bunker-admin/') throw Error('Build Pages with VITE_APP_BASE=/Bunker-admin/');
const secure = (html) =>
  html.replace(
    '<head>',
    `<head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://bunker-vdk.ru data: blob:; connect-src https://bunker-vdk.ru; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action https://bunker-vdk.ru">`,
  );
const app = await readFile(path.join(output, 'index.html'), 'utf8');
const landing = await readFile(path.join(output, 'landing.html'), 'utf8');
if (!landing.includes('data-prerendered="landing"') || !app.includes(base + 'assets/'))
  throw Error('Build the frontend with the Pages environment before exporting');
for (const route of [
  'catalog',
  'admin',
  'proposals',
  'users',
  'profile',
  'tips',
  'achievements',
  'auth/callback',
]) {
  await mkdir(path.join(output, route), { recursive: true });
  await writeFile(path.join(output, route, 'index.html'), secure(app));
}
await writeFile(path.join(output, 'index.html'), secure(landing));
const qr = await readFile(path.join(output, 'qr.html'), 'utf8');
await mkdir(path.join(output, 'qr'), { recursive: true });
await writeFile(path.join(output, 'qr', 'index.html'), secure(qr));
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(
  path.join(output, '404.html'),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Страница не найдена</title><h1>Страница не найдена</h1><a href="/Bunker-admin/">На главную</a></html>',
);
console.log('Exported all frontend routes for GitHub Pages');
