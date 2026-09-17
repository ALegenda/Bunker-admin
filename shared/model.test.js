import test from 'node:test';
import assert from 'node:assert/strict';
import { changes, summary } from './model.js';
test('unchanged cards do not enter the release; edits and additions do', () => {
  const base = [{ id: '1', name: 'Алиби', description: 'До', attributes: {} }];
  assert.equal(changes(base, structuredClone(base)).length, 0);
  const draft = [
    { ...base[0], description: 'После' },
    { id: '2', name: 'Новая', description: 'Текст' },
  ];
  assert.equal(changes(base, draft).length, 2);
  assert.match(summary(changes(base, draft)), /описание/);
  assert.match(summary(changes(base, draft)), /Добавлено: Новая/);
  assert.equal(base[0].description, 'До');
});
test('author explanation appears in summary literally', () => {
  assert.match(
    summary([{ card: { name: 'Алиби', note: 'Теперь действует ночью' }, before: {} }]),
    /Теперь действует ночью/,
  );
});

test('author explanation supplements before/after instead of replacing it', () => {
  const before = { id: '1', name: 'Алиби', description: 'Один раз за раунд' };
  const card = { ...before, description: 'Один раз за игру', note: '  Выбирайте момент.  ' };
  const text = summary(changes([before], [card]));
  assert.match(text, /Выбирайте момент\.\n\nОбновлено: описание\./);
  assert.match(text, /Было: Один раз за раунд\nСтало: Один раз за игру/);
});

test('new cards retain their description alongside the author explanation', () => {
  const text = summary([
    { card: { name: 'Новая', description: 'Описание механики', note: 'Зачем добавлена' } },
  ]);
  assert.match(text, /Добавлено: Новая\n\nЗачем добавлена\n\nОписание механики/);
  assert.doesNotMatch(text, /Было:/);
});

test('summary compares only changed attributes and labels empty values', () => {
  const before = {
    id: '1',
    name: 'Алиби',
    description: 'Текст',
    attributes: {
      activationTime: ['Ночью'],
      usageFrequency: 'Раз за раунд',
      usageLocation: ['Бункер'],
      tags: [],
    },
  };
  const card = {
    ...before,
    note: 'Изменили ограничения',
    attributes: {
      ...before.attributes,
      usageFrequency: 'Раз за игру',
      usageLocation: [],
      tags: ['Защита'],
    },
  };
  const text = summary(changes([before], [card]));
  assert.match(text, /Изменили ограничения/);
  assert.match(text, /частота применения\.\nБыло: Раз за раунд\nСтало: Раз за игру/);
  assert.match(text, /место применения\.\nБыло: Бункер\nСтало: не указано/);
  assert.match(text, /теги\.\nБыло: не указано\nСтало: Защита/);
  assert.doesNotMatch(text, /Ночью|время применения|характеристики/);
});

test('blank notes do not add empty paragraphs to comparisons', () => {
  const before = { name: 'Алиби', description: 'До' };
  const card = { ...before, description: 'После' };
  assert.equal(
    summary([{ before, card }]),
    summary([{ before, card: { ...card, note: '  \n ' } }]),
  );
});

import { migrateImages } from './model.js';
test('image migration preserves edits and user images, upgrades prototype images', () => {
  const input = [
    { id: '1', description: 'Моя правка', image: '' },
    { id: '2', image: 'data:image/png;base64,custom' },
    { id: '3', image: '/assets/card-1.png' },
    { id: '4', image: '' },
  ];
  const mapping = {
    1: { image: '/assets/cards/1.webp' },
    2: { image: '/assets/cards/2.webp' },
    3: { image: '/assets/cards/3.webp' },
  };
  const output = migrateImages(input, mapping);
  assert.equal(output[0].description, 'Моя правка');
  assert.equal(output[0].image, mapping['1'].image);
  assert.equal(output[1].image, input[1].image);
  assert.equal(output[2].image, mapping['3'].image);
  assert.equal(output[3].image, '');
  assert.equal(input[0].image, '');
  assert.deepEqual(migrateImages(output, mapping), output);
});
test('bundled image enrichment does not generate a false release change', () => {
  const original = [{ id: '0', description: 'Текст', image: '/assets/card-1.png' }];
  const map = { 0: { image: '/assets/cards/0.webp' } };
  assert.equal(
    changes(migrateImages(original, map), migrateImages(structuredClone(original), map)).length,
    0,
  );
});

import { addImportedEntries } from './model.js';
test('import extends existing drafts without resetting edits or duplicating entries', () => {
  const draft = [
    { id: '1', description: 'Моя правка', image: 'data:image/png;base64,user' },
    { id: 'custom', description: 'Моя карточка' },
  ];
  const seed = [
    { id: '1', description: 'Исходник' },
    { id: 'rule-intro', description: 'Об игре' },
  ];
  const merged = addImportedEntries(draft, seed);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].description, 'Моя правка');
  assert.equal(merged[1].id, 'custom');
  assert.deepEqual(addImportedEntries(merged, seed), merged);
  merged[2].description = 'Правка раздела';
  assert.equal(seed[1].description, 'Об игре');
});

import { groupChanges, changeStamp } from './model.js';
test('editorial metadata alone is not a change to the published rules', () => {
  const base = [{ id: 'x', name: 'Алиби', description: 'Текст', kind: 'Уточнение', note: '' }];
  assert.equal(
    changes(base, [{ ...base[0], kind: 'Механика и баланс', note: 'Комментарий' }]).length,
    0,
  );
});
test('summary groups new cards, mechanics, clarifications and typos with real before/after', () => {
  const items = [
    { card: { id: 'new', name: 'Новая', description: 'Новая механика' } },
    {
      card: { id: 'a', name: 'Алиби', description: 'Теперь', kind: 'Механика и баланс' },
      before: { id: 'a', name: 'Алиби', description: 'Раньше' },
    },
    {
      card: { id: 'b', name: 'Раздел', description: 'Текст', kind: 'Исправление опечатки' },
      before: { id: 'b', name: 'Раздел', description: 'Текcт' },
    },
  ];
  assert.deepEqual(
    groupChanges(items).map((g) => g.title),
    ['Новое в игре', 'Механика и баланс', 'Исправления опечаток'],
  );
  const text = summary(items);
  assert.match(text, /Было: Раньше/);
  assert.match(text, /Стало: Теперь/);
});
test('a changed rule or editorial note makes the summary stale', () => {
  const item = { card: { id: 'a', description: 'До', kind: 'Уточнение', note: '' } };
  const stamp = changeStamp([item]);
  assert.equal(stamp, changeStamp(structuredClone([item])));
  item.card.description = 'После';
  assert.notEqual(stamp, changeStamp([item]));
  const next = changeStamp([item]);
  item.card.note = 'Пояснение';
  assert.notEqual(next, changeStamp([item]));
});

test('JSONB object order does not create false changes', () => {
  const base = [
    { id: '1', name: 'Карточка', attributes: { tags: ['А'], usageFrequency: 'одноразовое' } },
  ];
  const draft = [{ ...base[0], attributes: { usageFrequency: 'одноразовое', tags: ['А'] } }];
  assert.equal(changes(base, draft).length, 0);
});
