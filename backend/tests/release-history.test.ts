import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Card } from '../../shared/contracts.js';

test('card history includes only final changes in published releases', async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'bunker_history_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import('../db/index.js');
  try {
    const { migrate } = await import('../db/migrate.js');
    const { upsertCards, readWorkspace } = await import('../services/workspace.js');
    const { saveCard, resetCard, saveReleaseMeta, cardHistory } =
      await import('../services/cards.js');
    const { publish } = await import('../services/jobs.js');
    const { cardSchema } = await import('../../shared/schema.js');
    const { changes, changeStamp, summary } = await import('../../shared/model.js');
    await migrate();
    const original = cardSchema.parse({
      id: 'history-card',
      name: 'Алиби',
      cardType: 'умение',
      description: 'Исходный текст',
    });
    await transaction(async (c) => {
      await upsertCards(c, [original]);
      await c.query('INSERT INTO workspace(id,baseline) VALUES(1,$1)', [
        JSON.stringify([original]),
      ]);
    });
    async function edit(description: string, note = '') {
      const state = await readWorkspace();
      await saveCard({ ...state.cards[0], description, note }, state.versions[original.id], null);
    }
    async function release(title: string) {
      let state = await readWorkspace();
      const diff = changes(state.base, state.cards);
      await saveReleaseMeta(
        {
          revision: state.revision,
          release: title,
          changelog: summary(diff) || 'Без изменений карточки',
          changelogStamp: changeStamp(diff),
        },
        null,
      );
      state = await readWorkspace();
      const jobId = randomUUID();
      // A ready PDF fixture exercises real publication without starting the PDF worker.
      await pool.query(
        `INSERT INTO pdf_jobs(id,status,workspace_revision,snapshot,template_version)
         VALUES($1,'ready',$2,$3,'history-test')`,
        [jobId, state.revision, JSON.stringify(state)],
      );
      return publish(jobId, state.revision);
    }

    await edit('Первое слово');
    await edit('Промежуточная правка');
    await edit('Итог первой версии', 'Пояснение автора');
    assert.deepEqual(await cardHistory(original.id), []);
    const first = await release('Версия 1');
    let history = await cardHistory(original.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].release_id, first.id);
    assert.equal(history[0].release_title, 'Версия 1');
    assert.equal(history[0].before_data.description, original.description);
    assert.equal(history[0].after_data.description, 'Итог первой версии');
    assert.equal(history[0].after_data.note, 'Пояснение автора');
    const frozen = structuredClone(history);

    await edit('Проба');
    await edit('Итог первой версии', 'Только новая заметка');
    assert.deepEqual(await cardHistory(original.id), frozen);
    await release('Без изменений механики');
    assert.deepEqual(await cardHistory(original.id), frozen);

    await edit('Итог второй версии', 'Новое пояснение');
    const second = await release('Версия 2');
    history = await cardHistory(original.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].release_id, second.id);
    assert.equal(history[0].before_data.description, 'Итог первой версии');
    assert.equal(history[0].after_data.description, 'Итог второй версии');
    assert.ok(history[0].created_at);
    assert.deepEqual(history[1], frozen[0]);
    await edit('Неопубликованный черновик');
    assert.deepEqual(await cardHistory(original.id), history);
    assert.deepEqual(await cardHistory('unknown-card'), []);

    const draft = await readWorkspace();
    const reset = await resetCard(original.id, draft.versions[original.id], null);
    assert.deepEqual(
      reset.card,
      draft.base.find((c: Card) => c.id === original.id),
    );
    const restored = await readWorkspace();
    assert.equal(changes(restored.base, restored.cards).length, 0);
    assert.equal(restored.changelogStamp, '');
    assert.equal(restored.revision, draft.revision + 1);
    assert.deepEqual(await cardHistory(original.id), history);
    await assert.rejects(resetCard(original.id, draft.versions[original.id], null), {
      statusCode: 409,
    });
    assert.deepEqual((await readWorkspace()).cards, restored.cards);

    const added = await saveCard({ ...original, id: 'new-draft', name: 'Новая' }, null, null);
    assert.equal((await resetCard('new-draft', added.version, null)).card, null);
    assert.deepEqual((await readWorkspace()).cards, restored.cards);
    assert.deepEqual(await cardHistory('new-draft'), []);
    // Discarding before the first autosave must not create a card.
    assert.equal((await resetCard('never-saved', null, null)).card, null);
    // A stale tab cannot remove a card created or edited by another editor.
    await assert.rejects(resetCard(original.id, null, null), { statusCode: 409 });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
