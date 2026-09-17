import { readFile, writeFile, access } from 'node:fs/promises';
import { renderLanding } from '../tmp/landing-prerender/prerender.js';

// The public landing is complete HTML/CSS: native controls work without a
// framework download. Internal pages retain their separate application shell.
let page = await readFile(new URL('../web-dist/landing.html', import.meta.url), 'utf8');
const markup = renderLanding();
if (!page.includes('<div id="root"></div>')) throw Error('Missing application root');
const stylesheets = [
  ...page.matchAll(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+)")[^>]*>/g),
];
if (/<script\b/i.test(page)) throw Error('Landing must work without JavaScript');
if (!stylesheets.length) throw Error('Missing production stylesheet');
for (const [tag, url] of stylesheets) {
  if (!url.startsWith('/assets/')) throw Error('Unexpected stylesheet path');
  const css = await readFile(new URL('../web-dist' + url, import.meta.url), 'utf8');
  if (/<\/style/i.test(css)) throw Error('Cannot inline stylesheet');
  page = page.replace(tag, () => '<style>' + css + '</style>');
}
// Validate responsive picture sources as well as regular img src attributes.
for (const url of new Set(markup.match(/\/assets\/[a-zA-Z0-9_.-]+/g))) {
  await access(new URL('../web-dist' + url, import.meta.url));
}
page = page.replace(
  '<div id="root"></div>',
  () => '<div id="root" data-prerendered="landing">' + markup + '</div>',
);
await writeFile(new URL('../web-dist/landing.html', import.meta.url), page);
console.log('Prerendered landing with inline styles: ' + Buffer.byteLength(page) + ' bytes');
