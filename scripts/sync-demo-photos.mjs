import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { photos, products, originalProductPhotos } from './data/demo-catalog.mjs';

const target = new URL('../client/src/data/product-images.json', import.meta.url);
const manifest = Object.fromEntries([
  ...Object.entries(originalProductPhotos).map(([sku, photoKey]) => [sku, photos[photoKey]]),
  ...products.map((product) => [product.sku, photos[product.photoKey]]),
]);

if (process.argv.includes('--verify')) {
  for (const [key, photo] of Object.entries(photos)) {
    const response = await fetch(photo.src, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      throw new Error(`Photo ${key} failed verification: HTTP ${response.status}`);
    }
    console.log(`Verified ${key}: HTTP ${response.status}, ${response.headers.get('content-type')}`);
  }
}

const content = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== content) throw new Error('Photo manifest is out of date. Run node scripts/sync-demo-photos.mjs.');
  console.log(`Photo manifest is current (${Object.keys(manifest).length} SKUs).`);
} else {
  await mkdir(new URL('../client/src/data/', import.meta.url), { recursive: true });
  await writeFile(target, content);
  console.log(`Saved photo manifest for ${Object.keys(manifest).length} SKUs.`);
}
