import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardSchema } from '../../shared/schema.js';
import { encodeRichText } from '../../shared/rich-text.js';
import { tagPlanSchema, tagDescriptionHash, enrichCardTags } from '../domain/card-tags.js';

const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
const plan = tagPlanSchema.parse(
  JSON.parse(await readFile('resources/rules-2026-05-24/tag-enrichment.json', 'utf8')),
);
const tags = (id: string) => plan.entries.find((e) => e.id === id)?.tags || [];

test('every curated assignment references an exact source card and known tag', () => {
  assert.equal(plan.sourceSha256, source.sourceSha256);
  assert.equal(plan.entries.length, 321);
  for (const entry of plan.entries) {
    const card = cardSchema.parse(source.entries.find((e: any) => e.id === entry.id));
    assert.equal(entry.name, card.name);
    assert.equal(entry.cardType, card.cardType);
    assert.equal(entry.descriptionSha256, tagDescriptionHash(card.description));
    const enriched = enrichCardTags(card, entry);
    assert.equal(enriched.skipped, undefined);
    assert.ok(cardSchema.safeParse(enriched.card).success);
    assert.equal(enrichCardTags(enriched.card, entry).card, enriched.card);
  }
});
test('mechanical classifications avoid keyword false positives and ambiguous materials', () => {
  for (const id of ['0', '2', '3', '108', '205', '252'])
    assert.ok(tags(id).includes('Голосование'));
  assert.ok(!tags('8').includes('Голосование')); // Immortality explicitly does not prevent expulsion.
  assert.ok(!tags('135').includes('Голосование')); // Alarm is set after voting, without affecting it.
  for (const id of ['147', '180', '198', '210']) assert.ok(tags(id).includes('металлический'));
  for (const id of ['59', '129', '134', '154', '159', '197'])
    assert.ok(!tags(id).includes('металлический'));
  assert.ok(!tags('154').includes('легковоспламеняющийся'));
  assert.ok(!tags('pdf24-d39e5b578e0d').includes('взрывоопасный'));
  assert.ok(tags('141').includes('взрывоопасный'));
  assert.ok(tags('128').includes('медицинский'));
  assert.ok(tags('194').includes('съедобный'));
  assert.ok(!tags('195').includes('съедобный'));
  for (const entry of plan.entries) {
    if (entry.tags.some((t) => ['металлический', 'медицинский', 'съедобный', 'оружие'].includes(t)))
      assert.equal(entry.cardType, 'припас');
  }
});
test('enrichment preserves custom tags, formatting and non-tag attributes without mutating input', () => {
  const entry = plan.entries.find((e) => e.id === '0')!;
  const original = cardSchema.parse(source.entries.find((e: any) => e.id === '0'));
  const card = {
    ...original,
    attributes: {
      ...original.attributes,
      tags: [' голосование ', 'Мой тег'],
      activationTime: ['особое время'],
    },
    note: 'не публиковать',
    kind: 'Механика и баланс',
  };
  const before = structuredClone(card);
  const result = enrichCardTags(card, entry).card;
  assert.deepEqual(card, before);
  assert.deepEqual(result.attributes.tags.slice(0, 2), [' голосование ', 'Мой тег']);
  assert.equal(
    result.attributes.tags.filter((t) => t.trim().toLowerCase() === 'голосование').length,
    1,
  );
  assert.deepEqual(
    { ...result, attributes: { ...result.attributes, tags: [] } },
    { ...card, attributes: { ...card.attributes, tags: [] } },
  );
  assert.equal(
    tagDescriptionHash(encodeRichText('<p><strong>Первый</strong>  второй</p>')),
    tagDescriptionHash('Первый второй'),
  );
});
test('edited descriptions, renamed cards, changed types and overflowing tags are skipped', () => {
  const entry = plan.entries[0];
  const card = cardSchema.parse(source.entries.find((e: any) => e.id === entry.id));
  for (const edited of [
    { ...card, description: 'Новая механика' },
    { ...card, name: 'Новое имя' },
    { ...card, cardType: 'припас' as const },
    {
      ...card,
      attributes: { ...card.attributes, tags: Array.from({ length: 50 }, (_, i) => 'Свой ' + i) },
    },
  ]) {
    const result = enrichCardTags(edited, entry);
    assert.ok(result.skipped);
    assert.equal(result.card, edited);
  }
  assert.ok(!tagPlanSchema.safeParse({ ...plan, entries: [entry, entry] }).success);
  assert.ok(
    !tagPlanSchema.safeParse({ ...plan, entries: [{ ...entry, tags: ['Несуществующий'] }] })
      .success,
  );
});
