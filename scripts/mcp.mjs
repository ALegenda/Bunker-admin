import { fileURLToPath } from 'node:url';

// MCP clients may launch from any directory. Database mode uses this repository's .env.
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
try {
  await import('../dist/backend/mcp/stdio.js');
} catch {
  console.error('MCP не собран. Выполните npm run build:mcp в каталоге Bunker-admin.');
  process.exitCode = 1;
}
