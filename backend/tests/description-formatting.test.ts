import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  descriptionFormattingPlanSchema,
  descriptionFormattingHash,
  formatCardDescription,
} from '../domain/description-formatting.js';
import { cardSchema } from '../../shared/schema.js';
import { descriptionHtml, descriptionText, encodeRichText } from '../../shared/rich-text.js';
import { cardMarkup } from '../services/print-template.js';

const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
const plan = descriptionFormattingPlanSchema.parse(
  JSON.parse(await readFile('resources/rules-2026-05-24/description-formatting.json', 'utf8')),
);

test('all 329 descriptions retain rule text and game numbers, replacing only native list markers', () => {
  assert.equal(plan.entries.length, 329);
  assert.equal(plan.sourceSha256, source.sourceSha256);
  assert.deepEqual(
    plan.entries.map((e) => e.id),
    source.entries.map((e: any) => e.id),
  );
  const markers = (text: string) =>
    text.replace(/(^|\n)\s*(?:\d+[.)]\s+|-\s+)/g, '$1').replace(/\s/g, '');
  let changed = 0;
  for (const entry of plan.entries) {
    const original = source.entries.find((e: any) => e.id === entry.id);
    assert.equal(entry.beforeDescriptionSha256, descriptionFormattingHash(original.description));
    let before = descriptionText(original.description);
    // Recover the three floating PDF list markers as native ordered-list numbers.
    if (entry.id === '196') before = before.replace(/(?<!\S)[123]\.\s+/g, '');
    assert.equal(markers(descriptionText(entry.description)), markers(before), entry.name);
    const card = cardSchema.parse({ ...original, image: '/my-image', note: 'Моя заметка' });
    const result = formatCardDescription(card, entry);
    assert.equal(result.skipped, undefined, entry.name);
    assert.deepEqual({ ...result.card, description: card.description }, card, entry.name);
    if (result.card !== card) changed++;
  }
  assert.equal(changed, 201);
});

test('Mixer has separate introduction, three readable colored choices and a usage limit in web and PDF', () => {
  const entry = plan.entries.find((e) => e.name === 'Мешатель')!;
  const html = descriptionHtml(entry.description);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.match(html, /<\/p><p>Вы будете вытягивать/);
  assert.match(html, /<\/ul><p>Давать сыворотку игрокам можно раз в сутки\.<\/p>/);
  assert.equal((html.match(/background-color:#008000/g) || []).length, 3);
  assert.equal((html.match(/background-color:#800080/g) || []).length, 3);
  assert.equal((html.match(/color:#ffffff/g) || []).length, 8);
  const card = cardSchema.parse(entry);
  assert.ok(cardMarkup(card, '').includes(html));
  const tattoo = plan.entries.find((e) => e.id === '196')!;
  assert.match(tattoo.description, /<ol><li>/);
  assert.doesNotMatch(descriptionText(tattoo.description), /(?:он|него|в) [123]\./);
});

test('manual wording, formatting and card identity changes are preserved', () => {
  const entry = plan.entries.find((e) => e.name === 'Мешатель')!;
  const original = source.entries.find((e: any) => e.id === entry.id);
  const card = cardSchema.parse(original);
  for (const edited of [
    { ...card, description: 'Собственное правило' },
    {
      ...card,
      description: encodeRichText(
        '<p><strong>' + descriptionText(card.description) + '</strong></p>',
      ),
    },
    { ...card, name: 'Новое имя' },
    { ...card, cardType: 'припас' as const },
  ]) {
    const result = formatCardDescription(edited, entry);
    assert.equal(result.card, edited);
    assert.ok(result.skipped);
  }
  const formatted = formatCardDescription(card, entry).card;
  assert.equal(formatCardDescription(formatted, entry).card, formatted);
  assert.throws(
    () => descriptionFormattingPlanSchema.parse({ ...plan, entries: [entry, entry] }),
    /Duplicate card ID/,
  );
});
