import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createMcpServer } from './server.js';
import { createHttpProvider } from './http-provider.js';
import { ContentError, type ContentProvider } from './content.js';

let provider: ContentProvider | undefined;
try {
  // Editor access must be selected by the client environment, never by a tool argument.
  const settings = z
    .object({
      BUNKER_MCP_MODE: z.enum(['public', 'editor']).default('public'),
      BUNKER_MCP_ORIGIN: z.string().url().optional(),
      BUNKER_MCP_AUTHOR_ID: z.string().uuid().optional(),
    })
    .parse(process.env);
  if (settings.BUNKER_MCP_MODE === 'editor') {
    const { createDatabaseProvider } = await import('./database-provider.js');
    provider = createDatabaseProvider({
      origin: settings.BUNKER_MCP_ORIGIN,
      authorId: settings.BUNKER_MCP_AUTHOR_ID,
    });
  } else {
    if (settings.BUNKER_MCP_AUTHOR_ID)
      throw new ContentError('Для отправки предложений выберите BUNKER_MCP_MODE=editor.');
    provider = createHttpProvider(settings.BUNKER_MCP_ORIGIN || 'https://bunker-vdk.ru');
  }
  const server = createMcpServer(provider);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await provider?.close?.();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
  // When the client exits, release DB connections even without a termination signal.
  server.server.onclose = () => {
    void close();
  };
  process.stdin.once('end', () => {
    void close();
  });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(
    error instanceof ContentError
      ? error.message
      : 'Не удалось запустить MCP. Проверьте режим, сборку и конфигурацию приложения.',
  );
  await provider?.close?.();
  process.exitCode = 1;
}
