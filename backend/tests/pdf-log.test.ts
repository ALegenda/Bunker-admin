import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPdfLog } from '../services/pdf-log.js';

test('PDF stages preserve results and correlate timed structured events', async () => {
  const events: Record<string, any>[] = [];
  const log = createPdfLog({ jobId: 'job-1', attemptId: 'attempt-1' }, (line) =>
    events.push(JSON.parse(line)),
  );
  const value = { bytes: 42 };
  assert.equal(await log.stage('image.download', async () => value, { assetId: 'asset-1' }), value);
  assert.deepEqual(
    events.map((e) => e.event),
    ['image.download.started', 'image.download.completed'],
  );
  for (const e of events) {
    assert.equal(e.jobId, 'job-1');
    assert.equal(e.attemptId, 'attempt-1');
    assert.equal(e.assetId, 'asset-1');
    assert.ok(Number.isFinite(Date.parse(e.timestamp)));
    assert.ok(e.elapsedMs >= 0);
  }
  assert.ok(events[1].durationMs >= 0);
});

test('PDF stages log failures without swallowing errors or URL credentials', async () => {
  const events: Record<string, any>[] = [];
  const log = createPdfLog({ jobId: 'job-2' }, (line) => events.push(JSON.parse(line)));
  const error = Object.assign(new Error('Connection to https://user:secret@example.test failed'), {
    code: 'ECONNRESET',
  });
  await assert.rejects(
    log.stage('upload.pdf', async () => {
      throw error;
    }),
    (e) => e === error,
  );
  assert.equal(events[1].event, 'upload.pdf.failed');
  assert.equal(events[1].errorCode, 'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(events), /user:secret/);
});

test('unfinished PDF stages emit progress and stop the timer on completion', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const events: Record<string, any>[] = [];
  const log = createPdfLog({}, (line) => events.push(JSON.parse(line)));
  let finish!: () => void;
  const pending = log.stage(
    'chromium.print',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  t.mock.timers.tick(15000);
  assert.equal(events.at(-1)?.event, 'chromium.print.waiting');
  finish();
  await pending;
  const count = events.length;
  t.mock.timers.tick(30000);
  assert.equal(events.length, count);
  assert.equal(events.at(-1)?.event, 'chromium.print.completed');
});
