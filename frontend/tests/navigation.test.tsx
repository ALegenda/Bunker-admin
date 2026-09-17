import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyCatalogUrl } from '../../shared/navigation.js';

test('old shared cards and repeated filters retain every parameter and fragment', () => {
  assert.equal(
    legacyCatalogUrl('/', '?card=role-medic&tag=one&tag=two&utm_source=chat', '#tips'),
    '/catalog?card=role-medic&tag=one&tag=two&utm_source=chat#tips',
  );
  assert.equal(
    legacyCatalogUrl('/', '?q=%D0%B2%D1%80%D0%B0%D1%87'),
    '/catalog?q=%D0%B2%D1%80%D0%B0%D1%87',
  );
  assert.equal(legacyCatalogUrl('/', '?type='), '/catalog?type=');
});

test('homepage campaign links and internal pages never become catalog redirects', () => {
  for (const search of ['', '?utm_source=telegram', '?view=publish'])
    assert.equal(legacyCatalogUrl('/', search), null);
  for (const path of ['/catalog', '/admin', '/profile'])
    assert.equal(legacyCatalogUrl(path, '?card=role-medic'), null);
});
