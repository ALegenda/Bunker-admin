import { pool } from './db/index.js';
import { runOne } from './worker.js';

// Scheduled hosts pay for execution time: drain the queue, then exit.
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopped = true;
  });

try {
  while (!stopped && (await runOne())) {
    // The existing worker leases and processes one immutable snapshot at a time.
  }
} finally {
  await pool.end();
}
