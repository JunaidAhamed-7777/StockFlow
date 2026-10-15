import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Exercise the real request serializer without a browser, database, or network.
globalThis.window = { location: { origin: "http://localhost:5173" } };
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
});
after(async () => { await vite.close(); delete globalThis.window; });

const { api } = await vite.ssrLoadModule("/src/services/api.ts");
const { createProduct, updateProduct } = await vite.ssrLoadModule("/src/services/product.service.js");
let lastBody;
api.defaults.adapter = async (config) => {
  lastBody = JSON.parse(config.data);
  return { data: { data: { id: 5, ...lastBody } }, status: 200, statusText: "OK", headers: {}, config };
};

const product = { name: "Test packaging", sku: "TEST-PACK", description: "", price: 12.5, lowStockThreshold: 10, categoryId: 1 };

test("editing product metadata never serializes an absent stock quantity", async () => {
  await updateProduct(5, product);
  assert.equal(Object.hasOwn(lastBody, "quantity"), false);
  assert.equal(lastBody.description, "");
});

test("new products retain a zero opening quantity", async () => {
  await createProduct({ ...product, quantity: 0 });
  assert.equal(lastBody.quantity, 0);
});

test("fractional or out-of-range inventory values never reach the API adapter", async () => {
  for (const quantity of [-1, 0.5, Infinity, 2_147_483_648]) {
    lastBody = undefined;
    await assert.rejects(() => createProduct({ ...product, quantity }), /whole numbers/);
    assert.equal(lastBody, undefined);
  }
});
