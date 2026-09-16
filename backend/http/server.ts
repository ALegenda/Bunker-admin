import { createApp } from './app.js';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { migrate } from '../db/migrate.js';
await migrate();
const app = await createApp();
await app.listen({ host: config.HOST, port: config.PORT });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
