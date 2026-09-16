import sanitize from 'sanitize-html';
import { decodeHTML } from 'entities';

// Existing descriptions remain literal plain text, including text resembling HTML.
export const richPrefix = '<!--bunker-rich-text:v1-->';
export const isRichText = (value: string) => value.startsWith(richPrefix);
const color = /^(?:#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
export function cleanHtml(html: string) {
  return sanitize(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'h2',
      'h3',
      'span',
      'mark',
    ],
    allowedAttributes: { span: ['style'], mark: ['style'], ol: ['start'] },
    allowedStyles: {
      span: { color: [color] },
      mark: { 'background-color': [color], color: [color] },
    },
  });
}
export function encodeRichText(html: string) {
  return richPrefix + cleanHtml(html);
}
export function normalizeDescription(value: string) {
  return isRichText(value) ? encodeRichText(value.slice(richPrefix.length)) : value;
}
export function descriptionHtml(value: string) {
  if (isRichText(value)) return cleanHtml(value.slice(richPrefix.length));
  const escaped = value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
  return escaped
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replaceAll('\n', '<br>')}</p>`)
    .join('');
}
export function descriptionText(value: string) {
  if (!isRichText(value)) return value;
  const html = descriptionHtml(value).replace(
    /<br\s*\/?\s*>|<\/(?:p|li|h2|h3|blockquote)>/gi,
    '\n',
  );
  return decodeHTML(sanitize(html, { allowedTags: [], allowedAttributes: {} })).trim();
}
