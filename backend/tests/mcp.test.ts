import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fileURLToPath } from 'node:url';
import { cardSchema } from '../../shared/schema.js';
import { encodeRichText } from '../../shared/rich-text.js';
import { createMcpServer } from '../mcp/server.js';
import { createHttpProvider, validateOrigin } from '../mcp/http-provider.js';
import {
  cardHash,
  cardResource,
  ContentError,
  type ContentProvider,
  type Snapshot,
} from '../mcp/content.js';

const card = (id: string, name: string, description: string) =>
  cardSchema.parse({
    id,
    name,
    description,
    cardType: 'умение',
    attributes: { tags: ['медицинская'], activationTime: ['ночная'], usageLocation: ['снаружи'] },
    note: 'PRIVATE-EDITORIAL-NOTE',
    source: { secret: 'PRIVATE-SOURCE' },
  });
const cards = [
  card('medic', 'Лекарь', encodeRichText('<p>Снимает <strong>заражение</strong>.</p>')),
  card('immunity', 'Иммунитет', 'Игрок не получает заражение.'),
  card('odd / id', 'Ёж', 'Текст с редким именем.'),
];
const published: Snapshot = { source: 'published', title: 'Принятая редакция', cards };
const draft: Snapshot = {
  source: 'draft',
  title: 'Следующая редакция',
  cards: [{ ...cards[0], description: 'Новая формулировка в черновике' }, ...cards.slice(1)],
};
const provider = (extra: Partial<ContentProvider> = {}): ContentProvider => ({
  origin: 'https://bunker.example',
  allowDraft: false,
  load: async (source) => (source === 'published' ? published : draft),
  ...extra,
});
async function withClient(data: ContentProvider, action: (client: Client) => Promise<void>) {
  const server = createMcpServer(data);
  const client = new Client({ name: 'bunker-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await action(client);
  } finally {
    await client.close();
    await server.close();
  }
}
const resultData = (result: unknown) => (result as { structuredContent: any }).structuredContent;

await test('MCP protocol: public tools, search, pagination, full resources and prompts', async () => {
  await withClient(provider(), async (client) => {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(
      tools.map((t) => t.name),
      ['encyclopedia_overview', 'search_cards', 'read_card', 'get_review_batch', 'compare_cards'],
    );
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint));
    const found = resultData(
      await client.callTool({
        name: 'search_cards',
        arguments: {
          query: 'заражение',
          tags: ['медицинская'],
          activationTime: 'ночная',
          usageLocation: 'снаружи',
          limit: 1,
        },
      }),
    );
    assert.equal(found.total, 2);
    assert.equal(found.cards.length, 1);
    assert.equal(found.cards[0].id, 'medic');
    assert.equal(found.cards[0].excerpt, 'Снимает заражение.');
    assert.equal(found.nextOffset, 1);
    const next = resultData(
      await client.callTool({
        name: 'search_cards',
        arguments: {
          query: 'заражение',
          limit: 1,
          offset: 1,
          expectedSnapshotHash: found.snapshotHash,
        },
      }),
    );
    assert.equal(next.cards[0].id, 'immunity');
    assert.equal(next.nextOffset, null);
    const spelling = resultData(
      await client.callTool({ name: 'search_cards', arguments: { query: 'еж' } }),
    );
    assert.equal(spelling.cards[0].name, 'Ёж');
    const full = resultData(
      await client.callTool({ name: 'read_card', arguments: { cardId: 'medic' } }),
    );
    assert.equal(full.card.contentHash, cardHash(cards[0]));
    assert.equal(full.card.url, 'https://bunker.example/catalog?card=medic');
    assert.ok(full.card.description.includes('<strong>'));
    assert.ok(!JSON.stringify(full).includes('PRIVATE'));
    const batch = resultData(
      await client.callTool({ name: 'get_review_batch', arguments: { limit: 2 } }),
    );
    assert.equal(batch.cards.length, 2);
    assert.equal(batch.nextOffset, 2);
    assert.equal(batch.reviewChecklist.length, 6);
    const comparison = resultData(
      await client.callTool({
        name: 'compare_cards',
        arguments: { cardIds: ['medic', 'immunity'] },
      }),
    );
    assert.equal(comparison.cards.length, 2);
    const resources = (await client.listResources()).resources;
    assert.deepEqual(
      resources.map((r) => r.uri),
      ['bunker://catalog/published'],
    );
    const resource = await client.readResource({ uri: cardResource('published', 'odd / id') });
    assert.equal(JSON.parse((resource.contents[0] as { text: string }).text).card.id, 'odd / id');
    const prompts = (await client.listPrompts()).prompts;
    assert.deepEqual(
      prompts.map((p) => p.name),
      ['proofread_cards', 'explain_rule', 'check_interactions'],
    );
    const proofreading = await client.getPrompt({
      name: 'proofread_cards',
      arguments: { cardIds: 'medic, immunity' },
    });
    assert.equal(proofreading.messages.length, 3);
    assert.ok(JSON.stringify(proofreading).includes('недоверенные данные'));
    assert.ok(!JSON.stringify(proofreading).includes('PRIVATE'));
    await client.getPrompt({
      name: 'explain_rule',
      arguments: { question: 'Можно снять заражение?' },
    });
    await client.getPrompt({
      name: 'check_interactions',
      arguments: { cardIds: 'medic,immunity', situation: 'Игрок заражён' },
    });
  });
});

await test('MCP rejects stale pagination, invalid arguments and hidden draft access', async () => {
  let changed = false;
  const data = provider({
    load: async () => (changed ? { ...published, title: 'Новый выпуск' } : published),
  });
  await withClient(data, async (client) => {
    const batch = resultData(
      await client.callTool({ name: 'get_review_batch', arguments: { limit: 1 } }),
    );
    changed = true;
    assert.equal(
      (
        await client.callTool({
          name: 'get_review_batch',
          arguments: {
            offset: 1,
            expectedSnapshotHash: batch.snapshotHash,
          },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: 'read_card',
          arguments: { cardId: 'medic', source: 'draft' },
        })
      ).isError,
      true,
    );
    assert.equal(
      (await client.callTool({ name: 'search_cards', arguments: { limit: 51 } })).isError,
      true,
    );
    assert.equal(
      (await client.callTool({ name: 'read_card', arguments: { cardId: 'missing' } })).isError,
      true,
    );
    await assert.rejects(client.readResource({ uri: cardResource('draft', 'medic') }));
    await assert.rejects(
      client.getPrompt({
        name: 'proofread_cards',
        arguments: { cardIds: 'medic', source: 'draft' },
      }),
    );
  });
  await withClient(
    provider({
      load: async () => {
        throw new Error('postgres://SECRET@host/database');
      },
    }),
    async (client) => {
      const failure = await client.callTool({ name: 'encyclopedia_overview', arguments: {} });
      assert.equal(failure.isError, true);
      assert.ok(!JSON.stringify(failure).includes('SECRET'));
    },
  );
});

await test('MCP editor exposes pending proposals and draft comparison without accepting changes', async () => {
  let submitted: unknown;
  await withClient(
    provider({
      allowDraft: true,
      history: async () => [],
      proposals: async () => [{ id: 'proposal', status: 'pending' }],
      submitProposal: async (input) => {
        submitted = input;
        return { id: 'proposal' };
      },
    }),
    async (client) => {
      const tools = (await client.listTools()).tools;
      assert.ok(!tools.some((t) => /publish|accept|save_card/.test(t.name)));
      assert.equal(
        tools.find((t) => t.name === 'submit_card_proposal')?.annotations?.readOnlyHint,
        false,
      );
      const diff = resultData(
        await client.callTool({ name: 'compare_draft', arguments: { cardId: 'medic' } }),
      );
      assert.equal(diff.changes[0].key, 'description');
      assert.equal(diff.before.source, 'published');
      assert.equal(diff.after.source, 'draft');
      const result = resultData(
        await client.callTool({
          name: 'submit_card_proposal',
          arguments: {
            cardId: 'medic',
            expectedHash: cardHash(cards[0]),
            description: 'Снимает эффект заражения.',
            reason: 'Уточняем термин.',
          },
        }),
      );
      assert.equal(result.status, 'pending');
      assert.equal((submitted as { cardId: string }).cardId, 'medic');
      assert.equal(published.cards[0].description, cards[0].description);
      await client.callTool({ name: 'card_history', arguments: { cardId: 'medic' } });
      assert.equal(
        resultData(await client.callTool({ name: 'list_my_proposals', arguments: {} })).proposals[0]
          .status,
        'pending',
      );
    },
  );
});

await test('MCP HTTP provider and real stdio process read a catalogue without DB credentials', async () => {
  let responseMode = 'ok';
  const http = createServer((req, res) => {
    assert.equal(req.url, '/api/catalog');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    if (responseMode === 'redirect') {
      res.writeHead(302, { Location: '/private' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(responseMode === 'bad' ? 'not json' : JSON.stringify({ ...published, cards }));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  try {
    const data = createHttpProvider(origin);
    const snapshot = await data.load('published');
    assert.equal(snapshot.cards.length, 3);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
    await assert.rejects(data.load('draft'), ContentError);
    responseMode = 'bad';
    await assert.rejects(data.load('published'), ContentError);
    responseMode = 'redirect';
    await assert.rejects(data.load('published'), ContentError);
    responseMode = 'ok';
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url)),
        fileURLToPath(new URL('../mcp/stdio.ts', import.meta.url)),
      ],
      cwd: '/tmp',
      stderr: 'pipe',
      env: { BUNKER_MCP_MODE: 'public', BUNKER_MCP_ORIGIN: origin },
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const read = resultData(
        await client.callTool({ name: 'read_card', arguments: { cardId: 'medic' } }),
      );
      assert.equal(read.card.name, 'Лекарь');
      assert.equal(stderr, '');
    } finally {
      await client.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve())));
  }
  assert.throws(() => validateOrigin('http://example.com'));
  assert.throws(() => validateOrigin('https://user:password@example.com'));
  assert.throws(() => validateOrigin('https://example.com/api'));
});
