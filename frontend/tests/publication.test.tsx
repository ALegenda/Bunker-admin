import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationBlocker } from '../src/publication-state.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Publication } from '../src/components/Publication.js';
import { cardSchema } from '../../shared/schema.js';

const ready = {
  busy: false,
  loadingJob: false,
  title: 'Выпуск',
  log: 'Уточнены правила',
  reviewed: true,
  contentChanged: false,
  revision: 7,
  job: { jobId: 'job', revision: 7, status: 'ready' as const },
};
test('publication opens with an automatic summary and keeps saved editorial text', () => {
  const card = cardSchema.parse({
    id: 'test',
    name: 'Лекарь',
    cardType: 'роль',
    description: 'Лечит',
  });
  const workspace = {
    revision: 1,
    versions: { test: 1 },
    release: 'Выпуск',
    base: [card],
    cards: [{ ...card, description: 'Лечит дважды' }],
    changelog: '',
    changelogStamp: '',
  };
  const html = renderToStaticMarkup(<Publication initial={workspace} />);
  assert.match(html, /Было: Лечит\nСтало: Лечит дважды/);
  assert.doesNotMatch(html, /Составить сводку изменений/);
  const saved = renderToStaticMarkup(
    <Publication initial={{ ...workspace, changelog: 'Текст редактора' }} />,
  );
  assert.match(saved, /Текст редактора/);
  assert.doesNotMatch(saved, /Было: Лечит/);
});
test('reviewing after PDF completion allows publication without rebuilding', () => {
  assert.match(publicationBlocker({ ...ready, reviewed: false }), /Подтвердите/);
  assert.equal(publicationBlocker(ready), '');
});
test('restored ready PDF allows publication after loading finishes', () => {
  assert.match(publicationBlocker({ ...ready, loadingJob: true }), /Проверяем/);
  assert.equal(publicationBlocker(ready), '');
});
test('every blocking state explains the next step', () => {
  for (const [patch, expected] of [
    [{ busy: true }, /Сохраняем/],
    [{ title: ' ' }, /название/],
    [{ log: ' ' }, /сводку/],
    [{ contentChanged: true }, /изменились/],
    [{ job: null }, /Соберите PDF/],
    [{ job: { ...ready.job, revision: 6 } }, /после сборки/],
    [{ job: { ...ready.job, status: 'running' as const } }, /Дождитесь/],
    [{ job: { ...ready.job, status: 'failed' as const } }, /ошибкой/],
  ] as const)
    assert.match(publicationBlocker({ ...ready, ...patch }), expected);
});
