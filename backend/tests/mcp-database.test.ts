import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { cardSchema } from '../../shared/schema.js';
import { cardHash } from '../mcp/content.js';

await test('MCP database: safe projections, attribution, stale bases, roles and proposal review', async () => {
  const control = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'bunker_test_' + randomUUID().replaceAll('-', '');
  await control.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  const { migrate } = await import('../db/migrate.js');
  const { refreshCatalog } = await import('../services/catalog.js');
  const { upsertCards, readWorkspace } = await import('../services/workspace.js');
  const { submitProposal, reviewProposal } = await import('../services/proposals.js');
  const { createDatabaseProvider } = await import('../mcp/database-provider.js');
  const original = cardSchema.parse({
    id: 'medic',
    name: 'Лекарь',
    cardType: 'умение',
    description: 'Снимает заражение',
    note: 'PRIVATE',
    source: { secret: 'PRIVATE' },
  });
  const author = randomUUID();
  try {
    await migrate();
    await transaction(async (c) => {
      await upsertCards(c, [original]);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [
        JSON.stringify([original]),
      ]);
      await refreshCatalog(c, [original]);
      await c.query(
        "INSERT INTO users(id,telegram_id,display_name,role) VALUES($1,'100','Редактор','trusted')",
        [author],
      );
    });
    const readonly = createDatabaseProvider();
    assert.equal(readonly.submitProposal, undefined);
    const editor = createDatabaseProvider({ authorId: author });
    assert.ok(!JSON.stringify(await editor.load('draft')).includes('PRIVATE'));
    const initial = (await editor.load('published')).cards[0];
    const input = {
      cardId: original.id,
      expectedHash: cardHash(initial),
      description: 'Снимает эффект заражения.',
      reason: 'Единый термин.',
    };
    const proposal = await editor.submitProposal!(input);
    const row = (await pool.query('SELECT * FROM proposals WHERE id=$1', [proposal.id])).rows[0];
    assert.equal(row.author_id, author);
    assert.equal(row.status, 'pending');
    assert.match(row.reason, /^\[MCP\]/);
    assert.equal((await readWorkspace()).cards[0].description, original.description);
    assert.equal((await editor.load('published')).cards[0].description, original.description);
    assert.ok(!JSON.stringify(await editor.proposals!()).includes('author_id'));
    await transaction((c) => refreshCatalog(c, [{ ...original, description: 'Новая публикация' }]));
    await assert.rejects(editor.submitProposal!(input), /изменилась/);
    // The service verifies again under a shared row lock, after the adapter's initial read.
    await assert.rejects(
      submitProposal(
        {
          cardId: original.id,
          name: original.name,
          cardType: original.cardType,
          description: 'Другая правка',
          reason: 'Тест',
        },
        author,
        initial,
      ),
      { statusCode: 409 },
    );
    await transaction((c) => refreshCatalog(c, [original]));
    await pool.query("UPDATE users SET role='player' WHERE id=$1", [author]);
    await assert.rejects(editor.submitProposal!(input), /прав/);
    await assert.rejects(editor.proposals!(), /роли/);
    await pool.query("UPDATE users SET role='trusted',disabled=true WHERE id=$1", [author]);
    await assert.rejects(editor.submitProposal!(input), /прав/);
    await pool.query('UPDATE users SET disabled=false WHERE id=$1', [author]);
    await reviewProposal(proposal.id, 'accepted', 'Проверено', null);
    assert.equal((await readWorkspace()).cards[0].description, input.description);
    assert.equal((await editor.load('published')).cards[0].description, original.description);
    await assert.rejects(reviewProposal(proposal.id, 'accepted', '', null), { statusCode: 409 });
  } finally {
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  }
});
