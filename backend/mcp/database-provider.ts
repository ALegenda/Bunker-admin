import { pool, transaction } from '../db/index.js';
import { config } from '../config.js';
import { catalog } from '../services/catalog.js';
import { readWorkspace } from '../services/workspace.js';
import { cardHistory } from '../services/cards.js';
import { submitProposal, listProposals } from '../services/proposals.js';
import { AppError } from '../domain/schema.js';
import type { PublicCard } from '../../shared/contracts.js';
import { validateOrigin } from './http-provider.js';
import { cardHash, ContentError, publicCardSchema, type ContentProvider } from './content.js';

export function createDatabaseProvider(
  options: { origin?: string; authorId?: string } = {},
): ContentProvider {
  const authorId = options.authorId;
  return {
    origin: validateOrigin(options.origin || config.PUBLIC_ORIGIN),
    allowDraft: true,
    async load(source) {
      if (source === 'draft') {
        const state = await readWorkspace();
        return {
          source,
          title: state.release,
          cards: state.cards.map((c) => publicCardSchema.parse(c)),
        };
      }
      const state = await transaction(async (c) => {
        await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        return catalog(c);
      });
      return {
        source,
        title: state.title,
        cards: state.cards.map((c) => publicCardSchema.parse(c)),
      };
    },
    async history(cardId) {
      return (await cardHistory(cardId)).map((entry) => ({
        releaseId: entry.release_id,
        title: entry.release_title,
        createdAt: entry.created_at,
        action: entry.action,
        before: entry.before_data ? publicCardSchema.parse(entry.before_data) : null,
        after: entry.after_data ? publicCardSchema.parse(entry.after_data) : null,
      }));
    },
    ...(authorId
      ? {
          async submitProposal(input) {
            const row = (
              await pool.query('SELECT data FROM public_cards WHERE id=$1', [input.cardId])
            ).rows[0];
            if (!row) throw new ContentError('Карточка отсутствует в опубликованном каталоге.');
            const base: PublicCard = publicCardSchema.parse(row.data);
            if (cardHash(base) !== input.expectedHash)
              throw new ContentError(
                'Опубликованная карточка изменилась. Прочитайте её заново перед отправкой.',
              );
            try {
              return await submitProposal(
                {
                  cardId: base.id,
                  name: input.name ?? base.name,
                  cardType: base.cardType,
                  description: input.description,
                  reason: '[MCP] ' + input.reason,
                },
                authorId,
                base,
              );
            } catch (error) {
              if (error instanceof AppError) throw new ContentError(error.message);
              throw error;
            }
          },
          async proposals() {
            const user = (
              await pool.query('SELECT role,disabled FROM users WHERE id=$1', [authorId])
            ).rows[0];
            if (!user || user.disabled || !['trusted', 'admin'].includes(user.role))
              throw new ContentError('Автор предложений отключён или не имеет нужной роли.');
            return (await listProposals(authorId, false)).map((p) => ({
              id: p.id,
              cardId: p.card_id,
              name: p.proposed.name,
              status: p.status,
              reason: p.reason,
              reviewNote: p.review_note,
              createdAt: p.created_at,
            }));
          },
        }
      : {}),
    close: () => pool.end(),
  };
}
