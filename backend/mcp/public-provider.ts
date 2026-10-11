import { config } from '../config.js';
import { transaction } from '../db/index.js';
import { catalog } from '../services/catalog.js';
import { ContentError, publicCardSchema, type ContentProvider } from './content.js';

// This provider never reads the workspace, users, proposals or editorial history.
// The API owns the shared database pool; closing an MCP request must not close it.
export function createPublicDatabaseProvider(): ContentProvider {
  return {
    origin: config.PUBLIC_ORIGIN,
    allowDraft: false,
    async load(source) {
      if (source !== 'published')
        throw new ContentError('Доступна только опубликованная редакция.');
      const state = await transaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return catalog(client);
      });
      return {
        source,
        title: state.title,
        cards: state.cards.map((card) => publicCardSchema.parse(card)),
      };
    },
  };
}
