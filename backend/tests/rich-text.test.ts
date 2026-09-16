import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  richPrefix,
  encodeRichText,
  descriptionHtml,
  descriptionText,
} from '../../shared/rich-text.js';
import { cardSchema } from '../../shared/schema.js';
import { changes, summary } from '../../shared/model.js';
import { cardMarkup } from '../services/print-template.js';

test('legacy descriptions stay literal and formatted text preserves safe marks and lists', () => {
  assert.equal(descriptionText('A <b>Б</b>\nВ'), 'A <b>Б</b>\nВ');
  assert.equal(descriptionHtml('A <b>Б</b>\nВ'), '<p>A &lt;b&gt;Б&lt;/b&gt;<br>В</p>');
  const value = encodeRichText(
    '<p><strong>Ёж &amp; лис</strong> <span style="color: #b42318">красный</span></p><ul><li><p><mark style="background-color: #fff0a6">Важно</mark></p></li></ul>',
  );
  assert.match(descriptionHtml(value), /<strong>Ёж &amp; лис<\/strong>/);
  assert.match(descriptionHtml(value), /color:#b42318/);
  assert.match(descriptionHtml(value), /background-color:#fff0a6/);
  assert.match(descriptionHtml(value), /<ul><li>/);
  assert.match(descriptionText(value), /Ёж & лис красный\nВажно/);
});

test('API schema and all renderers discard executable HTML, network resources and unsafe styles', () => {
  const card = cardSchema.parse({
    id: 'x',
    name: 'Проверка',
    cardType: 'умение',
    description:
      richPrefix +
      '<script>alert(1)</script><p onclick="bad()">Текст<img src="https://evil.test"><iframe src="https://evil.test"></iframe><span style="color:red;position:fixed;background:url(https://evil.test)">безопасно</span></p>',
  });
  for (const output of [
    card.description,
    descriptionHtml(card.description),
    cardMarkup(card, ''),
  ]) {
    assert.doesNotMatch(output, /<script|onclick|<iframe|evil\.test|position:|url\(/);
    assert.match(output, /Текст/);
  }
});

test('format-only changes enter releases and PDF without exposing markup in changelog', () => {
  const before = cardSchema.parse({
    id: 'x',
    name: 'Проверка',
    cardType: 'умение',
    description: 'Текст',
  });
  const after = { ...before, description: encodeRichText('<p><strong>Текст</strong></p>') };
  const diff = changes([before], [after]);
  assert.equal(diff.length, 1);
  assert.match(summary(diff), /форматирование/);
  assert.doesNotMatch(summary(diff), /<strong>|bunker-rich/);
  assert.match(cardMarkup(after, ''), /<strong>Текст<\/strong>/);
});
