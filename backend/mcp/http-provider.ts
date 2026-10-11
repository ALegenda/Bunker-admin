import { z } from 'zod';
import { ContentError, publicCardSchema, type ContentProvider } from './content.js';

export function validateOrigin(value: string) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !local) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new ContentError(
      'BUNKER_MCP_ORIGIN: укажите HTTPS origin или HTTP на loopback, без пути и пароля.',
    );
  return url.origin;
}
const catalogSchema = z.object({
  title: z.string().max(200),
  cards: z.array(publicCardSchema).max(1500),
});

export function createHttpProvider(origin: string): ContentProvider {
  origin = validateOrigin(origin);
  return {
    origin,
    allowDraft: false,
    async load(source) {
      if (source !== 'published')
        throw new ContentError('Черновик доступен только в режиме editor.');
      try {
        // No cookies, credentials, redirects or persistent cache: each read uses the current catalogue.
        const response = await fetch(new URL('/api/catalog', origin), {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok || !response.body) throw new Error('Catalogue unavailable');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 20 * 1024 * 1024) throw new Error('Catalogue too large');
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const data = catalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (new Set(data.cards.map((c) => c.id)).size !== data.cards.length)
          throw new Error('Duplicate card IDs');
        return { source, ...data };
      } catch {
        throw new ContentError(
          'Не удалось прочитать опубликованный каталог. Проверьте адрес и доступность API.',
        );
      }
    },
  };
}
