import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationBlocker } from '../src/publication-state.js';

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
