import { readFileSync } from 'node:fs';
const changelogCss = readFileSync('resources/print/changelog.css', 'utf8');
import { readFile } from 'node:fs/promises';
import type { Draft, Card } from '../domain/schema.js';
import { imageDataUrl } from './storage.js';
export const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>`)
    .join('');
export function cardMarkup(c: Card, image: string) {
  const attrs = c.attributes;
  const details = [
    ...attrs.activationTime,
    attrs.usageFrequency,
    ...attrs.tags,
    attrs.usageLocation.length ? 'используется, находясь ' + attrs.usageLocation.join(', ') : '',
  ]
    .filter(Boolean)
    .join('/');
  let description = c.description;
  const prefix = description.slice(0, c.name.length);
  if (
    prefix.toLowerCase() === c.name.toLowerCase() &&
    /^\s+[–—-]\s+/.test(description.slice(c.name.length))
  )
    description = description.slice(c.name.length).replace(/^\s*[–—-]\s*/, '');
  return `<article class="card" data-card-id="${escapeHtml(c.id)}">${image ? `<img class="card-picture" src="${image}" alt="">` : ''}<div class="card-description"><strong>${escapeHtml(c.name)}</strong>${description ? ' — ' : ''}${paragraphs(description)}</div>${details ? `<p class="attributes">(${escapeHtml(details)})</p>` : ''}</article>`;
}
export async function renderRules(state: Draft) {
  const rulesCss = await readFile('resources/print/rules.css', 'utf8');
  const fonts = await Promise.all(
    ['segoepr.ttf', 'segoeprb.ttf'].map(async (n) =>
      (await readFile('resources/fonts/' + n)).toString('base64'),
    ),
  );
  const images = new Map<string, string>();
  for (const c of state.cards) {
    if (c.image && !images.has(c.image)) images.set(c.image, await imageDataUrl(c.image));
  }
  const groups: [string, string][] = [
    ['правило', 'Правила игры'],
    ['роль', 'Роли'],
    ['умение', 'Умения'],
    ['мёртвый бонус', 'Игра мёртвых'],
    ['припас', 'Припасы'],
    ['наёмник', 'Наёмники'],
  ];
  const content = groups
    .map(([type, title]) => {
      const cards = state.cards.filter((c) => c.cardType === type);
      if (!cards.length) return '';
      return `<section><h1>${escapeHtml(title)}</h1>${cards.map((c) => (type === 'правило' ? `<article class="rule"><h2>${escapeHtml(c.name)}</h2>${paragraphs(c.description)}</article>` : cardMarkup(c, images.get(c.image) || ''))).join('')}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>${escapeHtml(state.release)}</title><style>
 @font-face{font-family:Rules;src:url(data:font/ttf;base64,${fonts[0]}) format('truetype');font-weight:400}@font-face{font-family:Rules;src:url(data:font/ttf;base64,${fonts[1]}) format('truetype');font-weight:700}
${rulesCss}
 </style></head><body><header><div class="release-label">Бункер · ${escapeHtml(state.release)}</div></header>${content}</body></html>`;
}
export function renderChangelog(state: Draft) {
  const content = state.changelog
    .split(/\n\s*\n/)
    .map((p) =>
      p.startsWith('### ')
        ? `<h3>${escapeHtml(p.slice(4))}</h3>`
        : p.startsWith('## ')
          ? `<h2>${escapeHtml(p.slice(3))}</h2>`
          : paragraphs(p),
    )
    .join('');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(state.release)}</title><style>${changelogCss}</style><article><small>БУНКЕР / ЖУРНАЛ ОБНОВЛЕНИЙ</small><h1>${escapeHtml(state.release)}</h1>${content}<footer>Увидимся в Бункере.</footer></article></html>`;
}
