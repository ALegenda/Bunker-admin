import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAttributes,
  normalizeUsage,
  colorLabels,
} from '../../shared/card-classification.js';
import { effectSuggestions } from '../../shared/card-metadata.js';
import { cardSchema } from '../../shared/schema.js';
import { classifyCard } from '../services/classification-migration.js';

const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
test('normalization merges aliases without losing limits, custom tags or removable and permanent effects', () => {
  const before = {
    activationTime: ['Ночное', 'дневное-ночное'],
    usageFrequency: 'трехразовое-одноразовое',
    usageLocation: ['внутри бункера-на вылазке', 'опасная личность*'],
    tags: ['Защита', 'защита', 'Опасная личность', 'Бессмертие', 'металлический', 'Мой тег'],
    effects: ['Опасная личность', 'Бессмертие', 'Телохранитель', 'Заминирован', 'Забей'],
    cardColor: 'розовый' as const,
  };
  const copy = structuredClone(before);
  const after = normalizeAttributes(before);
  assert.deepEqual(before, copy);
  assert.deepEqual(after.activationTime, ['дневная', 'ночная']);
  assert.equal(after.usageFrequency, 'по условию');
  assert.equal(after.usageCondition, 'одноразовая / трёхразовая');
  assert.equal(after.dangerousPersonality, true);
  assert.deepEqual(after.usageLocation, ['внутри бункера', 'снаружи']);
  assert.deepEqual(after.tags, ['защита', 'металлическая', 'мой тег']);
  assert.deepEqual(after.effects, ['бессмертие', 'телохранитель', 'заминирован', 'забей']);
  assert.deepEqual(normalizeAttributes(after), after);
  assert.equal(colorLabels[after.cardColor], 'розовая');
  assert.ok(!effectSuggestions.some((value) => value === ('опасная личность' as string)));
  assert.equal(normalizeUsage('по условию'), 'по условию');
  assert.equal(normalizeUsage('одноразовое, многоразовое'), 'по условию');
  assert.equal(
    normalizeUsage('трёхразовое-одноразовое'),
    normalizeUsage('одноразовое, трехразовое'),
  );
  assert.equal(normalizeUsage('раз в 2-3 дня'), 'по условию');
  assert.equal(normalizeUsage('1-2-3 разовое'), 'по условию');
});
test('outside corrections are source guarded and never overwrite changed card mechanics', () => {
  for (const id of ['20', '94']) {
    const card = cardSchema.parse(source.entries.find((c: { id: string }) => c.id === id));
    assert.deepEqual(classifyCard(card, source.entries).card.attributes.usageLocation, [
      'внутри бункера',
      'снаружи',
    ]);
    const edited = { ...card, description: 'Можно только внутри при новых условиях' };
    const result = classifyCard(edited, source.entries);
    assert.deepEqual(result.card.attributes.usageLocation, ['внутри бункера']);
    assert.ok(result.skipped);
    const custom = { ...card, attributes: { ...card.attributes, usageLocation: ['особое место'] } };
    assert.deepEqual(classifyCard(custom, source.entries).card.attributes.usageLocation, [
      'особое место',
    ]);
  }
});
test('all source cards remain schema-valid and normalization is idempotent', () => {
  for (const entry of source.entries) {
    const before = cardSchema.parse(entry);
    const after = classifyCard(before, source.entries).card;
    assert.ok(cardSchema.safeParse(after).success, before.name);
    assert.deepEqual(classifyCard(after, source.entries).card, after, before.name);
  }
});

test('separate fields remove legacy tags and allow clearing the dangerous-personality flag', () => {
  const attributes = {
    activationTime: [],
    usageLocation: [],
    usageFrequency: 'раз в 2-3 дня',
    tags: ['Опасная личность', 'Розовый', 'Защита'],
  };
  const normalized = normalizeAttributes(attributes);
  assert.equal(normalized.dangerousPersonality, true);
  assert.equal(normalized.cardColor, 'розовый');
  assert.deepEqual(normalized.tags, ['защита']);
  assert.equal(normalized.usageFrequency, 'по условию');
  assert.equal(normalized.usageCondition, 'раз в 2-3 дня');
  assert.equal(
    normalizeAttributes({ ...normalized, dangerousPersonality: false }).dangerousPersonality,
    undefined,
  );
  assert.equal(
    normalizeAttributes({ ...normalized, usageFrequency: 'одноразовая' }).usageCondition,
    undefined,
  );
});
