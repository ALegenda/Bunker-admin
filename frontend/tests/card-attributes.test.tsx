import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicCard } from '../../shared/contracts.js';
import {
  attributeOptions,
  compactAttributes,
  emptyAttributeFilters,
  matchesCard,
} from '../src/card-attributes.js';
import { CardAttributes, CardAttributeFilters } from '../src/components/CardAttributes.js';

const card: PublicCard = {
  id: 'judge',
  name: 'Судья',
  cardType: 'умение',
  description: 'Выберите игрока.',
  image: '',
  attributes: {
    activationTime: ['дневное'],
    usageFrequency: 'одноразовое',
    usageLocation: ['внутри бункера'],
    tags: ['Голосование', 'опасная личность'],
  },
};
test('voting tag is both visible and filterable, alongside all other attributes', () => {
  const badges = renderToStaticMarkup(<CardAttributes card={card} />);
  const controls = renderToStaticMarkup(
    <CardAttributeFilters cards={[card]} value={emptyAttributeFilters()} onChange={() => {}} />,
  );
  for (const value of [
    'Голосование',
    'опасная личность',
    'дневное',
    'одноразовое',
    'внутри бункера',
  ]) {
    assert.ok(badges.includes(value));
    assert.ok(controls.includes(value));
  }
  assert.ok(controls.includes('type="checkbox"'));
  assert.ok(badges.includes('Теги:'));
});
test('search includes attributes, ignores case and trims whitespace', () => {
  for (const query of [' ГОЛОСОВАНИЕ ', 'одноразовое', 'внутри бункера', 'СУДЬЯ', 'выберите']) {
    assert.ok(matchesCard(card, query, '', emptyAttributeFilters()));
  }
  assert.ok(!matchesCard(card, 'ночное', '', emptyAttributeFilters()));
});
test('all selected tags and other attribute filters must match together', () => {
  const filters = {
    ...emptyAttributeFilters(),
    tags: ['Голосование', 'опасная личность'],
    usageFrequency: ['одноразовое'],
    activationTime: ['дневное'],
    usageLocation: ['внутри бункера'],
  };
  assert.ok(matchesCard(card, '', 'умение', filters));
  assert.ok(!matchesCard(card, '', 'припас', filters));
  assert.ok(!matchesCard(card, '', '', { ...filters, tags: ['Голосование', 'несуществующий'] }));
  assert.ok(!matchesCard(card, '', '', { ...filters, usageFrequency: ['многоразовое'] }));
});
test('options count cards once and preserve obsolete selections so they can be cleared', () => {
  const duplicate = {
    ...card,
    attributes: { ...card.attributes, tags: ['Голосование', 'Голосование'] },
  };
  assert.deepEqual(attributeOptions([card, duplicate], 'tags', ['Удалённый тег']), [
    ['Голосование', 2],
    ['опасная личность', 1],
    ['Удалённый тег', 0],
  ]);
  assert.deepEqual(
    attributeOptions(
      [{ ...card, attributes: { ...card.attributes, usageFrequency: '' } }],
      'usageFrequency',
    ),
    [],
  );
});

test('compact cards expose overflow in native disclosure without nested buttons or lost attributes', () => {
  const enriched = {
    ...card,
    attributes: {
      ...card.attributes,
      cardColor: 'голубой' as const,
      effects: ['Паралич', 'Бессмертие'],
      tags: ['Голосование', 'металлический', 'Защита', 'Вылазка', 'Тег с очень длинным названием'],
    },
  };
  const html = renderToStaticMarkup(<CardAttributes card={enriched} compact />);
  assert.match(html, /<details class="attribute-overflow">/);
  assert.match(html, /<summary>/);
  assert.match(html, /Ещё /);
  for (const value of ['Паралич', 'Бессмертие', 'голубой', ...enriched.attributes.tags])
    assert.ok(html.includes(value));
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /color-swatch/);
  const full = renderToStaticMarkup(<CardAttributes card={enriched} />);
  assert.doesNotMatch(full, /Ещё /);
  assert.match(full, /<dt>Эффекты<\/dt>/);
  const filters = { ...emptyAttributeFilters(), effects: ['Паралич'], cardColor: ['голубой'] };
  assert.ok(matchesCard(enriched, 'ПАРАЛИЧ', '', filters));
  assert.ok(!matchesCard(enriched, '', '', { ...filters, cardColor: ['жёлтый'] }));
});

test('compact preview prioritizes selected values and defers duplicate labels without losing groups', () => {
  const enriched = {
    ...card,
    attributes: {
      ...card.attributes,
      cardColor: 'голубой' as const,
      effects: ['Бессмертие', 'Паралич'],
      tags: ['Бессмертие', 'Голосование'],
    },
  };
  const filters = { ...emptyAttributeFilters(), effects: ['Паралич'], tags: ['Голосование'] };
  const preview = compactAttributes(enriched, filters);
  assert.deepEqual(preview.visible.slice(0, 2), [
    { key: 'effects', value: 'Паралич' },
    { key: 'tags', value: 'Голосование' },
  ]);
  assert.equal(new Set(preview.visible.map((item) => item.value)).size, preview.visible.length);
  assert.ok(preview.hidden.some((item) => item.key === 'tags' && item.value === 'Бессмертие'));
  assert.equal(preview.visible.length + preview.hidden.length, preview.total);
});
