import { pool } from './db/index.js';
import { runOne } from './worker.js';
import { setTimeout as sleep } from 'node:timers/promises';

// Scheduled hosts pay for execution time: drain the queue, then exit.
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopped = true;
  });

try {
  let failures = 0;
  while (!stopped) {
    try {
      if (!(await runOne())) break;
      failures = 0;
    } catch (error) {
      // A freshly started scheduled container can briefly lose its DB connection.
      // Leases make retrying the queue safe; persistent failures still fail the run.
      if (++failures >= 3) throw error;
      console.error('PDF queue connection failed; retrying', { attempt: failures });
      await sleep(2000 * failures);
    }
  }
} finally {
  await pool.end();
}
