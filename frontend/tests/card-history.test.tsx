import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardHistoryEntry } from '../../shared/contracts.js';
import { historyChanges, historyTitle, textChanges } from '../src/card-history.js';
import { CardHistory, HistoryDetails } from '../src/components/CardHistory.js';
import { encodeRichText } from '../../shared/rich-text.js';

const entry: CardHistoryEntry = {
  id: '1',
  action: 'card.update',
  created_at: '2026-09-17T10:00:00Z',
  display_name: 'Антон',
  before_data: {
    name: 'Лекарь',
    description: 'Раз за игру лечит игрока.',
    attributes: {
      activationTime: [],
      usageFrequency: 'Раз за игру',
      usageLocation: [],
      tags: ['Лечение'],
    },
    note: '',
  },
  after_data: {
    name: 'Лекарь',
    description: 'Раз за раунд лечит игрока.',
    attributes: {
      activationTime: [],
      usageFrequency: 'Раз за раунд',
      usageLocation: [],
      tags: ['Лечение'],
    },
    note: 'Усилена способность',
  },
};
test('history identifies individual attributes and editorial changes without unchanged fields', () => {
  assert.deepEqual(
    historyChanges(entry).map((c) => c.field),
    ['description', 'attributes.usageFrequency', 'note'],
  );
  const html = renderToStaticMarkup(<HistoryDetails entry={entry} />);
  assert.ok(html.includes('Частота применения'));
  assert.ok(html.includes('Раз за игру'));
  assert.ok(html.includes('Раз за раунд'));
  assert.ok(html.includes('<del>игру</del><ins>раунд</ins>'));
  assert.ok(!html.includes('<h3>Название</h3>'));
});
test('word diff reconstructs both versions, including repeated words and large fallback', () => {
  for (const [before, after] of [
    ['Раз за игру лечит игрока.', 'Раз за раунд лечит игрока.'],
    ['', 'новый текст'],
    ['Удалить', ''],
    ['а а б а', 'а б б а'],
    ['Без изменений', 'Без изменений'],
    ['Начало ' + 'старый '.repeat(600) + 'конец', 'Начало ' + 'новый '.repeat(600) + 'конец'],
  ]) {
    const parts = textChanges(before, after);
    assert.equal(
      parts
        .filter((p) => p.kind !== 'added')
        .map((p) => p.text)
        .join(''),
      before,
    );
    assert.equal(
      parts
        .filter((p) => p.kind !== 'removed')
        .map((p) => p.text)
        .join(''),
      after,
    );
  }
});
test('format-only changes display rich versions and explicit explanation', () => {
  const formatted = {
    ...entry,
    before_data: { description: 'Текст' },
    after_data: { description: encodeRichText('<p><strong>Текст</strong></p>') },
  };
  assert.equal(historyChanges(formatted)[0].formatOnly, true);
  assert.match(historyTitle(formatted), /оформление описания/);
  const html = renderToStaticMarkup(<HistoryDetails entry={formatted} />);
  assert.ok(html.includes('Изменено только оформление'));
  assert.ok(html.includes('<strong>Текст</strong>'));
});
test('creation, archive and image replacement render meaningful snapshots', () => {
  const created = { ...entry, action: 'card.create', before_data: null };
  assert.equal(historyTitle(created), 'Карточка создана');
  assert.ok(renderToStaticMarkup(<HistoryDetails entry={created} />).includes('При добавлении'));
  const archived = { ...entry, action: 'source.archive', after_data: null };
  assert.equal(historyTitle(archived), 'Карточка архивирована');
  const html = renderToStaticMarkup(<HistoryDetails entry={archived} />);
  assert.ok(html.includes('До архивации'));
  assert.ok(html.includes('Раз за игру'));
  const images = {
    ...entry,
    before_data: { image: '/api/assets/old' },
    after_data: { image: '/api/assets/new' },
  };
  const imageHtml = renderToStaticMarkup(<HistoryDetails entry={images} />);
  assert.ok(imageHtml.includes('src="/api/assets/old"'));
  assert.ok(imageHtml.includes('src="/api/assets/new"'));
});
test('system attribution, loading, failure and empty states are distinct', () => {
  const render = (entries: CardHistoryEntry[] | null, error = '') =>
    renderToStaticMarkup(<CardHistory entries={entries} error={error} onRetry={() => {}} />);
  assert.ok(render(null).includes('Загружаем историю'));
  assert.ok(render([]).includes('Сохранённых правок пока нет'));
  const failure = render(null, 'Сеть недоступна');
  assert.ok(failure.includes('role="alert"'));
  assert.ok(failure.includes('Повторить'));
  assert.ok(!failure.includes('Invalid Date'));
  assert.ok(
    render([{ ...entry, action: 'source.migrate', display_name: null }]).includes('Система'),
  );
  assert.ok(render([{ ...entry, display_name: null }]).includes('Автор не указан'));
});
test('historical text stays escaped and source key order does not create false changes', () => {
  const unsafe = {
    ...entry,
    before_data: { description: '' },
    after_data: { description: '<script>alert(1)</script>' },
  };
  assert.ok(!renderToStaticMarkup(<HistoryDetails entry={unsafe} />).includes('<script>'));
  assert.deepEqual(
    historyChanges({
      ...entry,
      before_data: { source: { a: 1, b: 2 } },
      after_data: { source: { b: 2, a: 1 } },
    }),
    [],
  );
});
