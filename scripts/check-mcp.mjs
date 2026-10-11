import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Read-only deployment check, using the running container's existing DB environment.
// Never print that environment, card text, child stderr or error stacks.
const client = new Client({ name: 'bunker-production-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))],
  stderr: 'pipe',
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
    ),
    BUNKER_MCP_MODE: 'editor',
  },
});
transport.stderr?.on('data', () => {});
const read = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError);
  assert.ok(result.structuredContent);
  return result.structuredContent;
};
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.ok(tools.some((tool) => tool.name === 'compare_draft'));
  assert.ok(tools.some((tool) => tool.name === 'card_history'));
  const published = await read('encyclopedia_overview');
  const draft = await read('encyclopedia_overview', { source: 'draft' });
  assert.ok(published.total > 0 && draft.total > 0);
  const found = await read('search_cards', { limit: 1 });
  const cardId = found.cards[0].id;
  const card = await read('read_card', { cardId });
  assert.equal(card.card.id, cardId);
  await client.readResource({ uri: card.card.resourceUri });
  const prompt = await client.getPrompt({
    name: 'proofread_cards',
    arguments: { cardIds: cardId },
  });
  assert.ok(prompt.messages.length >= 2);
  await read('compare_draft', { cardId });
  await read('card_history', { cardId });
  // Also verify the public HTTP route in the running API, without a browser session.
  const publicClient = new Client({ name: 'bunker-public-production-check', version: '1.0.0' });
  try {
    await publicClient.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${process.env.PORT || '4173'}/mcp`),
        { requestInit: { headers: { Host: new URL(process.env.PUBLIC_ORIGIN).host } } },
      ),
    );
    const publicTools = (await publicClient.listTools()).tools;
    assert.equal(publicTools.length, 5);
    assert.ok(publicTools.every((tool) => tool.annotations?.readOnlyHint));
    const publicRead = await publicClient.callTool({ name: 'read_card', arguments: { cardId } });
    assert.ok(!publicRead.isError && publicRead.structuredContent);
    assert.equal(publicRead.structuredContent.card.source, 'published');
    const hiddenDraft = await publicClient.callTool({
      name: 'encyclopedia_overview',
      arguments: { source: 'draft' },
    });
    assert.equal(hiddenDraft.isError, true);
  } finally {
    await publicClient.close();
  }
  console.log(
    JSON.stringify({
      component: 'mcp',
      status: 'ok',
      publishedCards: published.total,
      draftCards: draft.total,
      tools: tools.length,
    }),
  );
} catch {
  console.error(
    'MCP production verification failed: startup, protocol or content access is unavailable.',
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
