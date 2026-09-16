import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header } from '../src/components/Header.js';
test('guest header contains branding only: no navigation, login or action buttons', () => {
  const html = renderToStaticMarkup(
    <Header user={null} path="/" publish={false} onLogout={() => {}} />,
  );
  assert.ok(html.includes('БУНКЕР'));
  assert.ok(!html.includes('<nav'));
  assert.ok(!html.includes('<button'));
  assert.deepEqual(
    [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    ['/'],
  );
});
test('trusted header offers proposals without administrative navigation', () => {
  const html = renderToStaticMarkup(
    <Header
      user={{ id: 'trusted', role: 'trusted', name: 'Игрок' }}
      path="/"
      publish={false}
      onLogout={() => {}}
    />,
  );
  assert.ok(html.includes('href="/proposals"'));
  assert.ok(!html.includes('href="/admin'));
  assert.ok(!html.includes('href="/users"'));
});
