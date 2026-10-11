import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from '../../config.js';
import { AppError } from '../../domain/schema.js';
import { ContentError, type ContentProvider } from '../../mcp/content.js';
import { createPublicDatabaseProvider } from '../../mcp/public-provider.js';
import { createMcpServer } from '../../mcp/server.js';

export async function mcpRoutes(
  app: FastifyInstance,
  provider: ContentProvider = createPublicDatabaseProvider(),
) {
  // Keep the HTTP surface public even if an editor provider is accidentally supplied.
  const published: ContentProvider = {
    origin: provider.origin,
    allowDraft: false,
    load(source) {
      if (source !== 'published')
        throw new ContentError('Доступна только опубликованная редакция.');
      return provider.load('published');
    },
  };
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url !== '/mcp') return;
    const origin = request.headers.origin;
    if (origin) {
      const allowed = [config.PUBLIC_ORIGIN, 'https://chatgpt.com', 'https://chat.openai.com'];
      if (config.AUTH_MODE === 'local') {
        allowed.push(`http://${request.headers.host}`, `https://${request.headers.host}`);
      }
      if (!allowed.includes(origin)) throw new AppError(403, 'Недопустимый источник запроса MCP');
      reply.header('Vary', 'Origin').header('Access-Control-Allow-Origin', origin);
    }
    reply.header('Cache-Control', 'no-store');
  });
  app.options('/mcp', async (_request, reply) =>
    reply
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
      )
      .header('Access-Control-Max-Age', '600')
      .code(204)
      .send(),
  );
  app.route({
    method: ['GET', 'HEAD', 'DELETE', 'PUT', 'PATCH'],
    url: '/mcp',
    handler: async (_request, reply) =>
      reply
        .header('Allow', 'POST, OPTIONS')
        .code(405)
        .send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Используйте MCP Streamable HTTP через POST.' },
        }),
  });
  app.post('/mcp', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    // A fresh stateless transport per request keeps players independent and supports restarts.
    const server = createMcpServer(published);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.hijack();
    const close = () => {
      void server.close();
    };
    reply.raw.once('close', close);
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch {
      request.log.error('Public MCP transport failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'MCP временно недоступен. Повторите запрос.' },
          }),
        );
      }
    } finally {
      reply.raw.off('close', close);
      await server.close();
    }
  });
}
