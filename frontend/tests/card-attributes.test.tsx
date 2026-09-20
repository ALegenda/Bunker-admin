import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicCard } from '../../shared/contracts.js';
import {
  attributeOptions,
  attributeValues,
  emptyAttributeFilters,
  filtersFromParams,
  appendFilterParams,
} from '../src/card-attributes.js';
import { createSearchIndex, searchCards } from '../src/card-search.js';
import { CardAttributes, CardAttributeFilters } from '../src/components/CardAttributes.js';

const matchesCard = (
  card: PublicCard,
  query: string,
  type: string,
  filters: ReturnType<typeof emptyAttributeFilters>,
) => searchCards(createSearchIndex([card]), query, type, filters).cards.length > 0;

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
const make = (id: string, time: string[], place = ['внутри бункера']): PublicCard => ({
  ...card,
  id,
  attributes: { ...card.attributes, activationTime: time, usageLocation: place },
});
const cards = [
  make('day', ['дневное']),
  make('night', ['ночная'], ['на вылазке']),
  make('both', ['дневная', 'ночное'], ['внутри бункера', 'на вылазке']),
  make('unknown', [], []),
];
const find = (time: string[], place: string[] = []) =>
  cards
    .filter((c) =>
      matchesCard(c, '', '', {
        ...emptyAttributeFilters(),
        activationTime: time,
        usageLocation: place,
      }),
    )
    .map((c) => c.id);

test('exact time categories distinguish single-phase, dual-phase, union and unknown', () => {
  assert.deepEqual(find(['day']), ['day']);
  assert.deepEqual(find(['night']), ['night']);
  assert.deepEqual(find(['both']), ['both']);
  assert.deepEqual(find(['day', 'both']), ['day', 'both']);
  assert.deepEqual(find(['night', 'both']), ['night', 'both']);
  assert.deepEqual(find(['day', 'night']), ['day', 'night']);
  assert.deepEqual(find(['unknown']), ['unknown']);
  assert.deepEqual(find([]), ['day', 'night', 'both', 'unknown']);
});
test('place categories use OR within a group and AND with time', () => {
  assert.deepEqual(find([], ['inside']), ['day']);
  assert.deepEqual(find([], ['outside']), ['night']);
  assert.deepEqual(find([], ['both']), ['both']);
  assert.deepEqual(find(['day', 'both'], ['outside', 'both']), ['both']);
  assert.deepEqual(find(['night'], ['inside']), []);
});
test('counts are per exact category and count duplicate values only once', () => {
  assert.deepEqual(
    attributeOptions([...cards, make('duplicate', ['дневная', 'дневное'])], 'activationTime'),
    [
      ['day', 2],
      ['night', 1],
      ['both', 1],
      ['unknown', 1],
    ],
  );
  assert.deepEqual(attributeOptions([card], 'tags', ['удалённый тег']), [
    ['голосование', 1],
    ['удалённый тег', 0],
  ]);
  const custom = make('custom', ['по условию']);
  assert.deepEqual(attributeValues(custom, 'activationTime'), ['по условию']);
  assert.ok(!matchesCard(custom, '', '', { ...emptyAttributeFilters(), activationTime: ['both'] }));
});
test('canonical search covers attributes and old spellings; tags and effects require all selections', () => {
  for (const query of [
    ' ГОЛОСОВАНИЕ ',
    'одноразовое',
    'одноразовая',
    'внутри бункера',
    'СУДЬЯ',
    'выберите',
  ])
    assert.ok(matchesCard(card, query, '', emptyAttributeFilters()), query);
  assert.ok(!matchesCard(card, 'ночная', '', emptyAttributeFilters()));
  assert.ok(
    matchesCard(card, '', 'умение', {
      ...emptyAttributeFilters(),
      tags: ['голосование'],
      dangerousPersonality: ['yes'],
    }),
  );
  assert.ok(!matchesCard(card, '', 'припас', emptyAttributeFilters()));
  assert.ok(
    !matchesCard(card, '', '', { ...emptyAttributeFilters(), tags: ['голосование', 'защита'] }),
  );
});
test('colors and dangerous personality have separate groups without tag duplicates', () => {
  const enriched: PublicCard = {
    ...card,
    attributes: {
      ...card.attributes,
      activationTime: ['дневное', 'ночное'],
      cardColor: 'розовый',
      effects: ['Опасная личность', 'Бессмертие', 'Телохранитель', 'Заминирован', 'Забей'],
      tags: ['Бессмертие', 'Защита', 'опасная личность'],
    },
  };
  const html = renderToStaticMarkup(<CardAttributes card={enriched} compact />);
  assert.equal((html.match(/<dt>/g) || []).length, 6);
  for (const label of ['Время', 'Место', 'Кол-во использований', 'Накладываемые эффекты', 'Теги'])
    assert.ok(html.includes(label));
  assert.match(html, /<details class="attribute-tags"/);
  assert.match(html, /дневная\/ночная/);
  assert.doesNotMatch(html, /дневное|Эффект:|Ещё |Цвет карточки|Частота/);
  assert.match(html, /color-swatch/);
  assert.equal((html.match(/>бессмертие</g) || []).length, 1);
  assert.deepEqual(attributeValues(enriched, 'tags'), ['защита']);
  assert.deepEqual(attributeValues(enriched, 'cardColor'), ['розовая']);
  assert.deepEqual(attributeValues(enriched, 'dangerousPersonality'), ['yes']);
  for (const effect of ['телохранитель', 'заминирован', 'забей']) assert.ok(html.includes(effect));
  assert.match(html, /нельзя снять/);
  assert.ok(
    matchesCard(enriched, '', '', {
      ...emptyAttributeFilters(),
      tags: ['защита'],
      cardColor: ['розовая'],
      dangerousPersonality: ['yes'],
      effects: ['бессмертие', 'забей'],
    }),
  );
  const full = renderToStaticMarkup(<CardAttributes card={enriched} />);
  assert.equal((full.match(/<dt>/g) || []).length, 7);
  assert.doesNotMatch(full, /<details/);
  const matched = renderToStaticMarkup(
    <CardAttributes
      card={enriched}
      compact
      selected={{ ...emptyAttributeFilters(), tags: ['защита'] }}
    />,
  );
  assert.match(matched, /<details class="attribute-tags" open=""/);
  assert.match(matched, /is-matched/);
});
test('unknown effects stay unspecified and all seven filter groups support checkboxes', () => {
  const html = renderToStaticMarkup(<CardAttributes card={cards[3]} />);
  assert.match(html, /не указаны/);
  const controls = renderToStaticMarkup(
    <CardAttributeFilters cards={cards} value={emptyAttributeFilters()} onChange={() => {}} />,
  );
  assert.equal((controls.match(/<fieldset/g) || []).length, 7);
  assert.doesNotMatch(controls, /<select/);
  assert.match(controls, /только дневная/);
  assert.match(controls, /Можно днём/);
});
test('shared links preserve multiple selections and translate legacy inclusive filters', () => {
  const filters = {
    ...emptyAttributeFilters(),
    activationTime: ['day', 'both'],
    usageLocation: ['outside', 'both'],
    usageFrequency: ['одноразовая', 'трёхразовая'],
    tags: ['защита'],
    cardColor: ['розовая'],
    dangerousPersonality: ['yes'],
    effects: ['забей'],
  };
  const params = new URLSearchParams();
  appendFilterParams(params, filters);
  assert.deepEqual(filtersFromParams(params), filters);
  const legacy = filtersFromParams(
    new URLSearchParams(
      'time=дневное&place=на вылазке&color=розовый&effect=Опасная личность&tag=Защита&frequency=трехразовое',
    ),
  );
  assert.deepEqual(legacy.activationTime, ['day', 'both']);
  assert.deepEqual(legacy.usageLocation, ['outside', 'both']);
  assert.deepEqual(legacy.tags, ['защита']);
  assert.deepEqual(legacy.cardColor, ['розовая']);
  assert.deepEqual(legacy.dangerousPersonality, ['yes']);
  assert.deepEqual(legacy.effects, []);
  assert.deepEqual(legacy.usageFrequency, ['трёхразовая']);
});

test('conditional limits share one filter option and preserve details on the card', () => {
  const a = {
    ...card,
    attributes: { ...card.attributes, usageFrequency: 'одноразовое-двухразовое' },
  };
  const b = {
    ...card,
    attributes: { ...card.attributes, usageFrequency: 'одноразовая / многоразовая' },
  };
  assert.deepEqual(attributeOptions([a, b], 'usageFrequency'), [['по условию', 2]]);
  assert.ok(matchesCard(a, '', '', { ...emptyAttributeFilters(), usageFrequency: ['по условию'] }));
  const html = renderToStaticMarkup(<CardAttributes card={a} />);
  assert.match(html, /по условию/);
  assert.match(html, /Условия использования/);
  assert.match(html, /одноразовая \/ двухразовая/);
  const legacy = filtersFromParams(
    new URLSearchParams('tag=розовый&tag=опасная личность&frequency=одноразовая / многоразовая'),
  );
  assert.deepEqual(legacy.tags, []);
  assert.deepEqual(legacy.cardColor, ['розовая']);
  assert.deepEqual(legacy.dangerousPersonality, ['yes']);
  assert.deepEqual(legacy.usageFrequency, ['по условию']);
});
test('colors combine with OR while the dangerous flag can be included or excluded', () => {
  const a = { ...card, attributes: { ...card.attributes, cardColor: 'розовый' as const } };
  const b = {
    ...card,
    attributes: { ...card.attributes, tags: [], cardColor: 'голубой' as const },
  };
  const filters = {
    ...emptyAttributeFilters(),
    cardColor: ['розовая', 'голубая'],
    dangerousPersonality: ['no'],
  };
  assert.ok(!matchesCard(a, '', '', filters));
  assert.ok(matchesCard(b, '', '', filters));
});
