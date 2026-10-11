import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cardSchema } from '../../shared/schema.js';
import { config } from '../config.js';
import { security } from '../http/security.js';
import { mcpRoutes } from '../http/routes/mcp.js';
import { type ContentProvider } from '../mcp/content.js';
import { executeCommand, parseCommand, withPublicMcp } from '../../scripts/mcp-client.mjs';

await test('public HTTP MCP works anonymously and cannot expose editor capabilities', async (t) => {
  const previous = { ...config };
  config.AUTH_MODE = 'local';
  config.HOST = '127.0.0.1';
  config.NODE_ENV = 'test';
  const cards = ['medic', 'immunity'].map((id) =>
    cardSchema.parse({
      id,
      name: id === 'medic' ? 'Лекарь' : 'Иммунитет',
      cardType: 'умение',
      description: 'Снимает заражение.',
      note: 'PRIVATE-EDITORIAL-NOTE',
      source: { secret: 'PRIVATE-SOURCE' },
    }),
  );
  const provider: ContentProvider = {
    origin: 'https://bunker.example',
    allowDraft: true,
    load: async (source) => {
      assert.equal(source, 'published');
      return { source, title: 'Принятая редакция', cards };
    },
    history: async () => assert.fail('editor history must not be used'),
    submitProposal: async () => assert.fail('proposals must not be used'),
    proposals: async () => assert.fail('proposals must not be used'),
    close: async () => assert.fail('HTTP request must not close the shared provider'),
  };
  const app = Fastify();
  await security(app);
  await mcpRoutes(app, provider);
  app.get('/api/workspace', async () => ({ private: true }));
  app.put('/api/cards/:id', async () => ({ changed: true }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as { port: number };
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: 'public-http-test', version: '1.0.0' });
  try {
    await t.test(
      'official HTTP client discovers five read-only tools, resources and prompts',
      async () => {
        await client.connect(new StreamableHTTPClientTransport(url));
        const tools = (await client.listTools()).tools;
        assert.deepEqual(
          tools.map((tool) => tool.name),
          [
            'encyclopedia_overview',
            'search_cards',
            'read_card',
            'get_review_batch',
            'compare_cards',
          ],
        );
        assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint));
        const found = await client.callTool({
          name: 'search_cards',
          arguments: { query: 'лекарь' },
        });
        assert.equal((found.structuredContent as any).cards[0].id, 'medic');
        const result = await client.callTool({ name: 'read_card', arguments: { cardId: 'medic' } });
        assert.ok(!JSON.stringify(result).includes('PRIVATE'));
        assert.equal((result.structuredContent as any).card.source, 'published');
        await client.readResource({ uri: (result.structuredContent as any).card.resourceUri });
        await client.getPrompt({ name: 'explain_rule', arguments: { question: 'Как лечить?' } });
        await client.callTool({
          name: 'compare_cards',
          arguments: { cardIds: ['medic', 'immunity'] },
        });
        assert.equal(
          (
            await client.callTool({
              name: 'read_card',
              arguments: { cardId: 'medic', source: 'draft' },
            })
          ).isError,
          true,
        );
        await assert.rejects(client.readResource({ uri: 'bunker://catalog/draft' }));
        assert.deepEqual(
          (await client.listResources()).resources.map((resource) => resource.uri),
          ['bunker://catalog/published'],
        );
      },
    );
    await t.test('CLI and exported client use HTTP and preserve protocol errors', async () => {
      const check = (await withPublicMcp(
        (connected: Client) => executeCommand(connected, { command: 'check' }),
        url,
      )) as any;
      assert.equal(check.status, 'ok');
      assert.equal(check.publishedCards, 2);
      assert.equal(check.tools.length, 5);
      const run = (args: string[], input = '') =>
        new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [fileURLToPath(new URL('../../scripts/mcp-client.mjs', import.meta.url)), ...args],
            {
              cwd: tmpdir(),
              // The CLI runs from another directory; test-only dotenv/tsx preload paths
              // must not be inherited by this plain Node subprocess.
              env: { ...process.env, NODE_OPTIONS: '', BUNKER_MCP_URL: url.href },
              stdio: 'pipe',
            },
          );
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('close', (code) => resolve({ code, stdout, stderr }));
          child.stdin.end(input);
        });
      const good = await run(['call', 'read_card', '--stdin'], '{"cardId":"medic"}');
      assert.equal(good.code, 0);
      assert.equal(good.stderr, '');
      assert.equal(JSON.parse(good.stdout).structuredContent.card.name, 'Лекарь');
      const failedTool = await run(['call', 'read_card', '{"cardId":"missing"}']);
      assert.equal(failedTool.code, 1);
      assert.equal(JSON.parse(failedTool.stdout).isError, true);
      const badJson = await run(['call', 'read_card', '--stdin'], '{');
      assert.equal(badJson.code, 1);
      assert.equal(badJson.stdout, '');
      assert.match(badJson.stderr, /JSON/);
      assert.throws(() => parseCommand(['call', 'read_card', '[]']));
    });
    await t.test(
      'production requests need no session or CSRF, but Host, Origin and API security remain enforced',
      async () => {
        config.AUTH_MODE = 'telegram';
        config.NODE_ENV = 'production';
        config.PUBLIC_ORIGIN = 'https://bunker.example';
        const headers = {
          host: 'bunker.example',
          origin: 'https://chatgpt.com',
          accept: 'application/json, text/event-stream',
        };
        const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
        const anonymous = await app.inject({ method: 'POST', url: '/mcp', headers, payload });
        assert.equal(anonymous.statusCode, 200);
        assert.equal(anonymous.json().result.tools.length, 5);
        assert.equal(anonymous.headers['cache-control'], 'no-store');
        assert.equal(anonymous.headers['access-control-allow-origin'], 'https://chatgpt.com');
        assert.equal(anonymous.headers['mcp-session-id'], undefined);
        assert.equal(anonymous.headers['set-cookie'], undefined);
        assert.equal(anonymous.headers['x-content-type-options'], 'nosniff');
        const ambient = await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: {
            ...headers,
            cookie: 'bunker_session=ignored',
            authorization: 'Bearer ignored',
          },
          payload,
        });
        assert.equal(ambient.statusCode, 200);
        assert.deepEqual(ambient.json().result.tools, anonymous.json().result.tools);
        const preflight = await app.inject({ method: 'OPTIONS', url: '/mcp', headers });
        assert.equal(preflight.statusCode, 204);
        assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
        for (const origin of ['https://evil.example', 'https://chatgpt.com.evil.example', 'null']) {
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: '/mcp',
                headers: { ...headers, origin },
                payload,
              })
            ).statusCode,
            403,
          );
        }
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/mcp',
              headers: { ...headers, host: 'evil.example' },
              payload,
            })
          ).statusCode,
          403,
        );
        for (const method of ['GET', 'DELETE', 'PUT', 'PATCH'] as const) {
          assert.equal((await app.inject({ method, url: '/mcp', headers })).statusCode, 405);
        }
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/mcp',
              headers: { ...headers, accept: 'text/plain' },
              payload,
            })
          ).statusCode,
          406,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/mcp',
              headers,
              payload: { ...payload, padding: 'x'.repeat(65536) },
            })
          ).statusCode,
          413,
        );
        assert.equal(
          (await app.inject({ url: '/api/workspace', headers: { host: 'bunker.example' } }))
            .statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: '/api/cards/medic',
              headers: { host: 'bunker.example' },
              payload: {},
            })
          ).statusCode,
          403,
        );
      },
    );
  } finally {
    await client.close();
    await app.close();
    Object.assign(config, previous);
  }
});
