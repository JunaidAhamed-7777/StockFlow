import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { profiles, products, photos, originalProductPhotos } from './data/demo-catalog.mjs';

test('demo fixtures contain only fictional, uniquely owned supplier/customer data', () => {
  assert.equal(profiles.length, 8);
  assert.equal(new Set(profiles.map(profile => profile.email)).size, 8);
  assert.ok(profiles.every(profile => profile.email.endsWith('@stockflow.example.test') && profile.name.includes('Demo')));
  const suppliers = profiles.filter(profile => profile.role === 'SUPPLIER');
  assert.equal(suppliers.length, 4);
  assert.equal(profiles.filter(profile => profile.role === 'CUSTOMER').length, 4);
  assert.equal(products.length, 40);
  assert.equal(new Set(products.map(product => product.sku)).size, 40);
  assert.ok(products.every(product => product.sku.startsWith('DEMO-') && suppliers.some(profile => profile.key === product.supplierKey)));
  for (const supplier of suppliers) assert.equal(products.filter(product => product.supplierKey === supplier.key).length, 10);
});

test('all 44 SKU images match maintained source metadata and retain HTTPS credits', async () => {
  const manifest = JSON.parse(await readFile(new URL('../client/src/data/product-images.json', import.meta.url), 'utf8'));
  const expected = Object.fromEntries([
    ...Object.entries(originalProductPhotos).map(([sku, key]) => [sku, photos[key]]),
    ...products.map(product => [product.sku, photos[product.photoKey]]),
  ]);
  assert.equal(Object.keys(expected).length, 44);
  assert.deepEqual(manifest, expected);
  for (const photo of Object.values(manifest)) {
    assert.ok(photo && photo.alt.startsWith('Illustrative') && photo.creditName);
    for (const field of ['src', 'creditUrl', 'licenseUrl']) assert.equal(new URL(photo[field]).protocol, 'https:');
    assert.ok(['images.unsplash.com', 'images.pexels.com'].includes(new URL(photo.src).hostname));
  }
});
