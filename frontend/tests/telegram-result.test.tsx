import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telegramResult, type LoginResult } from '../src/telegram-result.js';

test('silent or blocked popup can be cancelled; a late result is ignored', async () => {
  const controller = new AbortController();
  let callback!: (result: LoginResult) => void;
  const result = telegramResult((value) => {
    callback = value;
  }, controller.signal);
  controller.abort(Error('timeout'));
  callback({ id_token: 'late-token' });
  await assert.rejects(result, /timeout/);
});

test('popup token resolves once and errors do not leave login pending', async () => {
  const signal = new AbortController().signal;
  assert.equal(
    await telegramResult((cb) => {
      cb({ id_token: 'signed-token' });
      cb({ error: 'popup_closed' });
    }, signal),
    'signed-token',
  );
  await assert.rejects(
    telegramResult((cb) => cb({ error: 'popup_closed' }), signal),
    /не завершён/,
  );
  await assert.rejects(
    telegramResult(() => {
      throw Error('SDK error');
    }, signal),
    /SDK error/,
  );
});

test('an already cancelled attempt never opens a popup', async () => {
  await assert.rejects(
    telegramResult(() => assert.fail('must not open'), AbortSignal.abort(Error('cancelled'))),
    /cancelled/,
  );
});
