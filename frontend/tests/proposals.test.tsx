import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Proposal, PublicCard } from '../../shared/contracts.js';
import { proposalChanges } from '../../shared/proposals.js';
import { ProposalForm } from '../src/components/Catalog.js';
import { ProposalDiff } from '../src/components/Proposals.js';

const card: PublicCard = {
  id: 'test',
  name: 'Карточка',
  cardType: 'умение',
  description: 'Текст',
  image: '',
  attributes: {
    activationTime: ['ночная'],
    usageLocation: ['снаружи'],
    tags: ['защита'],
    usageFrequency: 'по условию',
    usageCondition: 'После голосования',
    effects: ['забей'],
    cardColor: 'розовый',
    dangerousPersonality: true,
  },
};

test('existing and new proposals expose all editable metadata', () => {
  for (const initial of [card, null]) {
    const html = renderToStaticMarkup(<ProposalForm card={initial} close={() => {}} />);
    for (const label of [
      'Название',
      'Тип',
      'Время',
      'Место',
      'Кол-во использований',
      'Теги',
      'Цвет карты',
      'Опасная личность',
      'Накладываемые эффекты',
    ]) {
      assert.ok(html.includes(label), label);
    }
    assert.doesNotMatch(html, /disabled=""/);
    if (initial) {
      assert.match(html, /После голосования/);
      assert.match(html, /value="защита"/);
      assert.match(html, /value="забей"/);
      assert.match(html, /<option>роль<\/option>/);
    }
  }
});

test('review shows changed metadata and removals on both sides without unchanged description', () => {
  const proposed: PublicCard = {
    ...card,
    name: 'Новое название',
    cardType: 'роль',
    attributes: { activationTime: ['дневная'], usageLocation: [], usageFrequency: '', tags: [] },
  };
  const proposal: Proposal = {
    id: '1',
    card_id: card.id,
    base: card,
    proposed,
    status: 'pending',
    reason: 'Проверка',
    review_note: '',
    author_name: 'Игрок',
    created_at: '',
  };
  assert.equal(proposalChanges(card, proposed).length, 10);
  const html = renderToStaticMarkup(<ProposalDiff proposal={proposal} />);
  for (const value of [
    'Опубликовано',
    'Предложено',
    'Новое название',
    'Карточка',
    'роль',
    'умение',
    'Теги',
    'защита',
    'Не указано',
    'ночная',
    'дневная',
    'После голосования',
    'Нет',
    'Да',
  ]) {
    assert.ok(html.includes(value), value);
  }
  assert.doesNotMatch(html, /<h4>Описание/);
  const newCard = renderToStaticMarkup(<ProposalDiff proposal={{ ...proposal, base: null }} />);
  assert.doesNotMatch(newCard, /Опубликовано/);
  assert.match(newCard, /<h4>Описание/);
});

test('equivalent optional attributes do not produce false proposal changes', () => {
  const base = {
    ...card,
    attributes: { activationTime: [], usageLocation: [], usageFrequency: '', tags: [] },
  };
  assert.deepEqual(
    proposalChanges(base, {
      ...base,
      attributes: {
        ...base.attributes,
        effects: [],
        dangerousPersonality: false,
        cardColor: '',
        usageCondition: '',
      },
    }),
    [],
  );
});
