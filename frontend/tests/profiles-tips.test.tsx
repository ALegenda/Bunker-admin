import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileStats, ProgressHistory } from '../src/components/Profile.js';
import { TipItem } from '../src/components/CardTips.js';
import type { CardTip, PlayerProfile } from '../../shared/contracts.js';

test('profile shows real defaults, awards and currency history including deductions', () => {
  const profile: PlayerProfile = {
    userId: '1',
    name: 'Игрок',
    role: 'player',
    level: 1,
    balance: 0,
    achievements: [],
    revision: 0,
  };
  const initial = renderToStaticMarkup(<ProfileStats profile={profile} />);
  assert.ok(initial.includes('Пока нет достижений'));
  assert.ok(initial.includes('Текущий баланс'));
  const award = {
    id: 'a',
    title: 'Первая победа',
    description: 'За победу',
    awardedAt: '2026-09-17T00:00:00.000Z',
  };
  const earned = renderToStaticMarkup(
    <ProfileStats profile={{ ...profile, level: 2, balance: 100, achievements: [award] }} />,
  );
  assert.ok(earned.includes('Первая победа'));
  const history = renderToStaticMarkup(
    <ProgressHistory
      history={[
        {
          id: '1',
          created_at: award.awardedAt,
          before_data: { level: 2, balance: 100, achievements: [award] },
          after_data: { level: 1, balance: 75, achievements: [], reason: 'Корректировка' },
        },
      ]}
    />,
  );
  assert.ok(history.includes('Валюта: -25'));
  assert.ok(history.includes('Уровень: 2 → 1'));
  assert.ok(history.includes('Отозвано достижение: Первая победа'));
  assert.ok(history.includes('Корректировка'));
});
test('tips escape user content; moderation actions are only rendered for administrators', () => {
  const tip: CardTip = {
    id: '1',
    card_id: 'card-1',
    card_name: 'Умение',
    author_name: '<script>alert(1)</script>',
    body: '<img src=x onerror=alert(1)>',
    status: 'published',
    created_at: '2026-09-17T00:00:00Z',
  };
  const html = renderToStaticMarkup(<TipItem tip={tip} />);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<button'));
  assert.ok(html.includes('&lt;img'));
  const admin = renderToStaticMarkup(<TipItem tip={tip} moderation />);
  assert.ok(admin.includes('Снять с публикации'));
  assert.ok(!admin.includes('Опубликовать для всех'));
  const pending = renderToStaticMarkup(<TipItem tip={{ ...tip, status: 'pending' }} moderation />);
  assert.ok(pending.includes('Опубликовать для всех'));
  assert.ok(pending.includes('Отклонить'));
});

test('unfinished achievements show progress without counting as earned; legacy awards remain earned', () => {
  const partial = {
    id: 'v',
    title: 'Ветеран',
    description: 'Сыграть 100 игр',
    target: 100,
    progress: 37,
    awardedAt: null,
  };
  const legacy = {
    id: 'old',
    title: 'Первая победа',
    description: '',
    awardedAt: '2026-09-17T00:00:00Z',
  };
  const profile: PlayerProfile = {
    userId: '1',
    name: 'Игрок',
    role: 'player',
    level: 1,
    balance: 0,
    revision: 0,
    achievements: [partial, legacy],
  };
  const html = renderToStaticMarkup(<ProfileStats profile={profile} />);
  assert.ok(html.includes('ДОСТИЖЕНИЯ</small><strong>1</strong>'));
  assert.ok(html.includes('В процессе · 37 / 100'));
  assert.ok(html.includes('value="37" max="100"'));
  assert.ok(!html.includes('Invalid Date'));
  const history = renderToStaticMarkup(
    <ProgressHistory
      history={[
        {
          id: '1',
          created_at: legacy.awardedAt,
          before_data: { level: 1, balance: 0, achievements: [partial] },
          after_data: {
            level: 1,
            balance: 0,
            reason: 'Сотая игра',
            achievements: [{ ...partial, progress: 100, awardedAt: legacy.awardedAt }],
          },
        },
      ]}
    />,
  );
  assert.ok(history.includes('37 / 100 → 100 / 100'));
  assert.ok(history.includes('Достижение получено'));
});
