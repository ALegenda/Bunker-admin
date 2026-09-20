import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PublicCard } from '../../shared/contracts.js';
import { createSearchIndex, searchCards, searchDocument } from '../src/card-search.js';
import { emptyAttributeFilters } from '../src/card-attributes.js';
import { richPrefix } from '../../shared/rich-text.js';

const make = (id: string, name: string, description = ''): PublicCard => ({
  id,
  name,
  description,
  cardType: 'умение',
  image: '',
  attributes: { activationTime: [], usageLocation: [], usageFrequency: '', tags: [] },
});
const banker = make('banker', 'Банкир', 'Выберите игрока.');
const find = (cards: PublicCard[], query: string, filters = emptyAttributeFilters(), type = '') =>
  searchCards(createSearchIndex(cards), query, type, filters);

test('search tolerates one missing, extra, substituted or transposed letter', () => {
  for (const query of ['банкр', 'баанкир', 'бонкир', 'банкри', 'абнкир']) {
    const result = find([banker], query);
    assert.deepEqual(result.cards, [banker], query);
    assert.equal(result.approximateCount, 1, query);
  }
  assert.equal(find([banker], 'бонкер').cards.length, 0, 'two errors remain excluded');
  assert.equal(find([banker], 'несуществующее').cards.length, 0);
});

test('short queries and numbers remain literal, exact prefixes still match', () => {
  const cards = [make('short', 'Кот'), make('number', '1234'), banker];
  for (const query of ['кит', 'бнк', '1235'])
    assert.equal(find(cards, query).cards.length, 0, query);
  assert.deepEqual(find(cards, 'ба').cards, [banker]);
  assert.deepEqual(
    find(cards, '1234').cards.map((c) => c.id),
    ['number'],
  );
});

test('normalizes case, whitespace and ё, including words in a different order', () => {
  const card = make('black', 'Чёрный банкир', 'Выберите игрока.');
  for (const query of [' ЧЕРНЫЙ   БАНКИР ', 'банкир черный', 'игрока чёрный']) {
    const result = find([card], query);
    assert.deepEqual(result.cards, [card]);
    assert.equal(result.approximateCount, 0);
  }
  assert.equal(find([card], 'черный лекарь').cards.length, 0, 'every term is required');
  assert.deepEqual(find([card], 'черный банкри').cards, [card]);
});

test('ranks exact names before name fragments, descriptions and typo matches', () => {
  const description = make('description', 'Карта', 'Помогает банкир');
  const partial = make('partial', 'Банкир бункера');
  const fuzzy = make('fuzzy', 'Банкер');
  const cards = [fuzzy, description, partial, banker];
  assert.deepEqual(
    find(cards, 'банкир').cards.map((c) => c.id),
    ['banker', 'partial', 'description', 'fuzzy'],
  );
  assert.equal(find(cards, 'банкир').approximateCount, 1);
  assert.deepEqual(find(cards, '   ').cards, cards, 'empty query preserves catalog order');
});

test('typos never bypass type, tag, effect or category filters', () => {
  const card: PublicCard = {
    ...banker,
    attributes: {
      ...banker.attributes,
      activationTime: ['дневная'],
      usageLocation: ['внутри бункера'],
      tags: ['экономика', 'торговля'],
      effects: ['защита'],
      cardColor: 'жёлтый',
    },
  };
  const filters = {
    ...emptyAttributeFilters(),
    activationTime: ['day'],
    tags: ['экономика', 'торговля'],
    effects: ['защита'],
  };
  assert.deepEqual(find([card], 'банкри', filters, 'умение').cards, [card]);
  assert.equal(find([card], 'банкри', filters, 'роль').cards.length, 0);
  assert.equal(find([card], 'банкри', { ...filters, activationTime: ['night'] }).cards.length, 0);
  assert.equal(find([card], 'банкри', { ...filters, tags: ['экономика', 'еда'] }).cards.length, 0);
  assert.equal(find([card], 'банкри', { ...filters, effects: ['бессмертие'] }).cards.length, 0);
  assert.deepEqual(find([card], 'экономка').cards, [card]);
  assert.deepEqual(find([card], 'желтый').cards, [card], 'legacy color aliases remain searchable');
});

test('indexes visible rich text and conditions, without indexing HTML markup', () => {
  const card: PublicCard = {
    ...banker,
    description: richPrefix + '<p><strong>Кислород</strong> &amp; вода</p>',
    attributes: {
      ...banker.attributes,
      usageFrequency: 'по условию',
      usageCondition: 'После голосования',
    },
  };
  assert.deepEqual(find([card], 'кислорд').cards, [card]);
  assert.deepEqual(find([card], 'голосования').cards, [card]);
  assert.equal(find([card], 'strong').cards.length, 0);
  assert.equal(find([card], 'bunker-rich-text').cards.length, 0);
  assert.equal(searchDocument(card).description, 'Кислород & вода');
});

test('rebuilding an index reflects edited cards and attributes, additions and deletions', () => {
  const oldIndex = createSearchIndex([banker]);
  const updated: PublicCard = {
    ...banker,
    name: 'Лекарь',
    attributes: { ...banker.attributes, tags: ['медицина'] },
  };
  const newIndex = createSearchIndex([updated, make('new', 'Судья')]);
  assert.equal(searchCards(newIndex, 'банкир', '', emptyAttributeFilters()).cards.length, 0);
  assert.deepEqual(searchCards(newIndex, 'медицина', '', emptyAttributeFilters()).cards, [updated]);
  assert.equal(searchCards(newIndex, 'судья', '', emptyAttributeFilters()).cards.length, 1);
  assert.deepEqual(searchCards(oldIndex, 'банкир', '', emptyAttributeFilters()).cards, [banker]);
  assert.equal(find([], 'банкир').cards.length, 0);
});
