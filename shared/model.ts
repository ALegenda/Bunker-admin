import type { Card } from './schema.js';
export type Change = { card: Card; before: Card | undefined };
// JSONB does not preserve object-key order. Compare semantic values consistently.
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const fields = ['name', 'description', 'attributes', 'image', 'cardType'] as const;
export function changes(base: Card[], cards: Card[]): Change[] {
  const old = new Map(base.map((c) => [c.id, c]));
  return cards
    .filter((c) => !old.has(c.id) || fields.some((k) => stable(c[k]) !== stable(old.get(c.id)![k])))
    .map((c) => ({ card: c, before: old.get(c.id) }));
}
export function groupChanges(items: Change[]) {
  const names = ['Новое в игре', 'Механика и баланс', 'Уточнения правил', 'Исправления опечаток'];
  return names
    .map((title) => ({
      title,
      items: items.filter(({ card, before }) => {
        const group = !before
          ? names[0]
          : card.kind === 'Механика и баланс'
            ? names[1]
            : card.kind === 'Исправление опечатки'
              ? names[3]
              : names[2];
        return group === title;
      }),
    }))
    .filter((group) => group.items.length);
}
const labels: Record<string, string> = {
  name: 'Название',
  description: 'Описание',
  attributes: 'Характеристики',
  image: 'Изображение',
  cardType: 'Тип',
};
function valueText(value: unknown) {
  return value == null || value === ''
    ? 'не указано'
    : Array.isArray(value)
      ? value.join(', ')
      : String(value);
}
export function fieldChanges(card: Card, before?: Card) {
  return fields
    .filter((k) => stable(card[k]) !== stable(before?.[k]))
    .map((k) => ({ field: k, label: labels[k], before: before?.[k], after: card[k] }));
}
function attributesText(attrs: unknown) {
  const labels: Record<string, string> = {
    activationTime: 'Время',
    usageFrequency: 'Частота',
    usageLocation: 'Место',
    tags: 'Теги',
  };
  return (
    Object.entries(attrs || {})
      .map(([k, v]) => `${labels[k] || k}: ${valueText(v)}`)
      .join('; ') || 'не указаны'
  );
}
export function summary(items: Change[]) {
  return groupChanges(items)
    .map(
      (group) =>
        `## ${group.title}\n\n` +
        group.items
          .map(({ card, before }) => {
            const heading = `### ${before ? 'Изменено' : 'Добавлено'}: ${card.name}`;
            if (card.note?.trim()) return `${heading}\n\n${card.note.trim()}`;
            if (!before) return `${heading}\n\n${card.description || 'Добавлен новый элемент.'}`;
            const details = fieldChanges(card, before)
              .map((change) => {
                if (change.field === 'image') return 'Обновлено изображение.';
                const format = change.field === 'attributes' ? attributesText : valueText;
                return `Обновлено: ${change.label.toLowerCase()}.\nБыло: ${format(change.before)}\nСтало: ${format(change.after)}`;
              })
              .join('\n\n');
            return `${heading}\n\n${details}`;
          })
          .join('\n\n'),
    )
    .join('\n\n');
}
// Compact non-security fingerprint tracks content and editorial notes for stale-summary warnings.
export function changeStamp(items: Change[]) {
  let a = 2166136261,
    b = 5381;
  const text = stable(
    items.map(({ card }) => [card.id, ...fields.map((k) => card[k]), card.kind, card.note]),
  );
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    a = Math.imul(a ^ n, 16777619);
    b = Math.imul(b, 33) ^ n;
  }
  return `${a >>> 0}-${b >>> 0}-${text.length}`;
}

// Upgrade bundled illustrations without overwriting user uploads or text edits.
export function migrateImages(cards: Card[], imageMap: Record<string, { image: string }>) {
  return cards.map((card) => {
    const image = imageMap[card.id]?.image;
    const bundled = !card.image || /^\/assets\/card-\d+\.png$/.test(card.image);
    return image && bundled ? { ...card, image } : { ...card };
  });
}

export function addImportedEntries(draft: Card[], seed: Card[]) {
  const existing = new Set(draft.map((entry) => entry.id));
  return [
    ...draft,
    ...seed.filter((entry) => !existing.has(entry.id)).map((entry) => structuredClone(entry)),
  ];
}
