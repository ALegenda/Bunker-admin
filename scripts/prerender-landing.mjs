import { readFile, writeFile, access } from 'node:fs/promises';
import { renderLanding } from '../tmp/landing-prerender/prerender.js';

const base = process.env.VITE_APP_BASE || '/';
const assetFile = (url) => {
  if (!url.startsWith(base + 'assets/')) throw Error('Unexpected asset path: ' + url);
  return new URL('../web-dist/' + url.slice(base.length), import.meta.url);
};

// The public landing is complete HTML/CSS with lightweight menu and scroll enhancements.
// Native controls also work without JS; no application framework is loaded.
let page = await readFile(new URL('../web-dist/landing.html', import.meta.url), 'utf8');
const markup = renderLanding();
if (!page.includes('<div id="root"></div>')) throw Error('Missing application root');
const stylesheets = [
  ...page.matchAll(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+)")[^>]*>/g),
];
const scripts = [...page.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
if (scripts.length !== 1 || !scripts[0][1].startsWith(base + 'assets/landing-'))
  throw Error('Landing must load only its lightweight enhancements');
const preloads = [
  ...page.matchAll(/<link\b(?=[^>]*\brel="modulepreload")(?=[^>]*\bhref="([^"]+)")[^>]*>/g),
];
let scriptBytes = 0;
for (const url of new Set([...scripts, ...preloads].map((match) => match[1]))) {
  if (
    !/^\/assets\/(?:landing(?:-menu)?|back-to-top|modulepreload-polyfill)-[\w-]+\.js$/.test(
      '/' + url.slice(base.length),
    )
  )
    throw Error('Unexpected landing script: ' + url);
  scriptBytes += (await readFile(assetFile(url))).length;
}
if (scriptBytes > 4096) throw Error('Keep all landing scripts under 4 KB');
if (!stylesheets.length) throw Error('Missing production stylesheet');
for (const [tag, url] of stylesheets) {
  if (!url.startsWith(base + 'assets/')) throw Error('Unexpected stylesheet path');
  const css = await readFile(assetFile(url), 'utf8');
  if (/<\/style/i.test(css)) throw Error('Cannot inline stylesheet');
  page = page.replace(tag, () => '<style>' + css + '</style>');
}
// Validate responsive picture sources as well as regular img src attributes.
for (const url of new Set(markup.match(/\/(?:[\w-]+\/)*assets\/[a-zA-Z0-9_.-]+/g))) {
  await access(assetFile(url));
}
page = page.replace(
  '<div id="root"></div>',
  () => '<div id="root" data-prerendered="landing">' + markup + '</div>',
);
await writeFile(new URL('../web-dist/landing.html', import.meta.url), page);
console.log('Prerendered landing with inline styles: ' + Buffer.byteLength(page) + ' bytes');
