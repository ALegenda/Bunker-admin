import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardSchema } from '../../shared/schema.js';
import { changes, summary } from '../../shared/model.js';
import { effectSuggestions } from '../../shared/card-metadata.js';
import { tagDescriptionHash } from '../domain/card-tags.js';
import { enrichCardMetadata, metadataPlanSchema } from '../domain/card-metadata.js';
const source = JSON.parse(await readFile('resources/rules-2026-05-24/manifest.json', 'utf8'));
const plan = metadataPlanSchema.parse(
  JSON.parse(await readFile('resources/rules-2026-05-24/metadata-enrichment.json', 'utf8')),
);
const entry = plan.entries.find((e) => e.id === '120')!;
const card = cardSchema.parse(source.entries.find((e: any) => e.id === entry.id));

test('metadata evidence covers every illustrated card with source-consistent assignments', () => {
  assert.equal(plan.sourceSha256, source.sourceSha256);
  assert.equal(plan.entries.filter((e) => e.cardColor).length, 324);
  for (const e of plan.entries) {
    const original = source.entries.find((c: any) => c.id === e.id);
    assert.equal(e.descriptionSha256, tagDescriptionHash(original.description));
    assert.equal(e.name, original.name);
    assert.equal(e.colorEvidence?.page, original.source.pageStart);
    // Historical migration remains immutable; the new classification migrates the status.
    for (const effect of e.effects)
      assert.ok(
        effect === 'Опасная личность' || effectSuggestions.includes(effect.toLowerCase() as any),
      );
    const c = cardSchema.parse(original);
    const result = enrichCardMetadata(c, e, e.imageSha256);
    assert.deepEqual(result.skipped, []);
    assert.ok(cardSchema.safeParse(result.card).success);
    assert.equal(enrichCardMetadata(result.card, e, e.imageSha256).card, result.card);
  }
  assert.equal(plan.entries.find((e) => e.id === '0')?.cardColor, 'оранжевый');
  assert.equal(plan.entries.find((e) => e.id === '198')?.cardColor, 'чёрно-жёлтый');
  assert.ok(entry.effects.includes('Паралич'));
  assert.ok(!plan.entries.find((e) => e.id === '176')?.effects.length); // Soap removes effects, it does not apply them.
  assert.ok(!plan.entries.find((e) => e.id === '63')?.effects.includes('Бессмертие')); // Pierces immortality.
  assert.ok(!plan.entries.find((e) => e.id === '3')?.effects.includes('Иммунитет на голосовании')); // Clears votes, no lasting immunity.
});
test('image and text guards work independently and respect manually filled metadata', () => {
  const modified = { ...card, description: 'Новая механика' };
  const a = enrichCardMetadata(modified, entry, entry.imageSha256);
  assert.equal(a.card.attributes.cardColor, entry.cardColor);
  assert.equal(a.card.attributes.effects, undefined);
  assert.match(a.skipped.join(), /описание/);
  const b = enrichCardMetadata(card, entry, 'different-image');
  assert.equal(b.card.attributes.cardColor, undefined);
  assert.ok(b.card.attributes.effects?.includes('Паралич'));
  const custom = {
    ...card,
    attributes: {
      ...card.attributes,
      cardColor: 'красный' as const,
      effects: ['паралич', 'Мой эффект'],
    },
  };
  const c = enrichCardMetadata(custom, entry, entry.imageSha256);
  assert.equal(c.card.attributes.cardColor, 'красный');
  assert.deepEqual(c.card.attributes.effects?.slice(0, 2), ['паралич', 'Мой эффект']);
  assert.equal(c.card.attributes.effects?.filter((e) => e.toLowerCase() === 'паралич').length, 1);
  assert.equal(
    enrichCardMetadata({ ...card, name: 'Другая карта' }, entry, entry.imageSha256).card.attributes
      .cardColor,
    undefined,
  );
});
test('empty optional fields do not invent release changes for legacy cards', () => {
  const empty = cardSchema.parse({
    ...card,
    attributes: { ...card.attributes, cardColor: '', effects: [] },
  });
  assert.deepEqual(empty, card);
  assert.deepEqual(changes([card], [empty]), []);
  const updated = enrichCardMetadata(card, entry, entry.imageSha256).card;
  const text = summary(changes([card], [updated]));
  assert.match(text, /цвет карточки/);
  assert.match(text, /накладываемые эффекты/);
  assert.match(text, /Паралич/);
});
