import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFixtures, createQAServer, validateConfig } from "./qa-browser-server.mjs";

test("fixture sizes are bounded and reject inherited property names", () => {
  assert.deepEqual(validateConfig({ products: 100_000, orders: 100_000, suppliers: 10_000 }), { products: 100_000, orders: 100_000, suppliers: 10_000 });
  for (const config of [{ products: -1 }, { orders: 1.5 }, { products: 100_001 }, { suppliers: 0 }, { products: 0, orders: 1 }, { constructor: 1 }, { toString: 1 }, null, []]) assert.throws(() => validateConfig(config));
  assert.deepEqual(validateConfig({ products: 0, orders: 0 }), { products: 0, orders: 0, suppliers: 4 });
});

test("deterministic fixtures preserve three-line totals and linked discovery records", () => {
  const fixtures = createFixtures({ products: 1000, orders: 1000, suppliers: 20 });
  assert.equal(fixtures.products.length, 1000);
  assert.equal(fixtures.orders.length, 1000);
  assert.equal(fixtures.suppliers[0].userId, fixtures.users.SUPPLIER.id);
  const itemIds = new Set();
  for (const order of fixtures.orders) {
    assert.equal(order.orderItems.length, 3);
    assert.equal(order.totalAmount, order.orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0));
    for (const item of order.orderItems) {
      assert.equal(item.product.id, item.productId);
      assert.equal(item.orderId, order.id);
      assert.equal(itemIds.has(item.id), false);
      itemIds.add(item.id);
    }
  }
  assert.deepEqual(createFixtures({ products: 4, orders: 4, suppliers: 2 }), createFixtures({ products: 4, orders: 4, suppliers: 2 }));
});

test("loopback synthetic server isolates writes, filters fixtures, and sanitizes reports", async (t) => {
  const prefix = path.join(tmpdir(), "stockflow-qa-");
  const distRoot = await mkdtemp(prefix);
  const server = createQAServer({ distRoot, config: { products: 44, orders: 44, suppliers: 4 } });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(distRoot.startsWith(prefix));
    await rm(distRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(distRoot, "assets"));
  await writeFile(path.join(distRoot, "index.html"), '<!doctype html><html><head><link href="https://fonts.example.test/font.css" rel="stylesheet"></head><body><div id="root"></div><script src="/assets/test-abcdefgh.js"></script></body></html>');
  await writeFile(path.join(distRoot, "assets/test-abcdefgh.js"), 'console.log("fixture");');
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const auth = { Authorization: "Bearer synthetic-qa-ADMIN" };
  const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const request = (url, options) => fetch(`${origin}${url}`, options);
  const raw = (url, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: url, headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });

  await t.test("host, origin, traversal, invalid JSON and payload size boundaries", async () => {
    assert.equal(await raw("/__qa/report", { Host: `external.example.test:${port}` }), 403);
    assert.equal(await raw("/__qa/report", { Host: `127.0.0.1:${port}`, Origin: "https://external.example.test" }), 403);
    assert.equal(await raw("/__qa/report", { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "cross-site" }), 403);
    for (const url of ["/../package.json", "/%2e%2e/package.json", "/%5c..%5cpackage.json", "/bad%00path", "/%zz"]) assert.equal(await raw(url), 400);
    assert.equal((await request("/__qa/config", { method: "POST", body: "{}" })).status, 415);
    assert.equal((await request("/__qa/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" })).status, 400);
    assert.equal((await request("/__qa/report", json({ unused: "x".repeat(20_000) }))).status, 413);
    assert.equal((await request("/__qa/config", json({ constructor: 1 }))).status, 400);
  });

  await t.test("static HTML strips external fonts, injects metrics, and caches hashed assets", async () => {
    const response = await request("/customer/products");
    const html = await response.text();
    assert.match(html, /<head><script src="\/__qa\/metrics.js"><\/script>/);
    assert.doesNotMatch(html, /fonts.example.test/);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await request("/assets/test-abcdefgh.js")).headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal((await request("/assets/missing.js")).status, 404);
    assert.equal((await request("/customer/products", { method: "POST" })).status, 405);
    assert.equal((await request("/__qa/metrics.js")).status, 200);
  });

  await t.test("fixture login and API contract shapes do not permit business writes", async () => {
    assert.equal((await request("/api/products")).status, 401);
    assert.equal((await request("/api/auth/login", json({ email: "real@example.test", password: "synthetic-password" }))).status, 401);
    for (const role of ["customer", "supplier", "admin"]) {
      const response = await request("/api/auth/login", json({ email: `${role}@qa.example.test`, password: "synthetic-password" }));
      const { data } = await response.json();
      assert.equal(data.token, `synthetic-qa-${role.toUpperCase()}`);
      assert.equal(data.user.role, role.toUpperCase());
    }
    assert.equal((await request("/api/auth/me", { headers: auth })).status, 200);
    assert.equal((await request("/api/stock/transactions", { headers: auth })).status, 501);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal((await request("/api/products/1", { method, headers: auth })).status, 405);
    assert.equal((await request("/api/auth/register", json({ email: "admin@qa.example.test" }))).status, 405);
    const all = (await (await request("/api/products", { headers: auth })).json()).data;
    assert.equal(all.length, 44);
    const filtered = (await (await request("/api/products?category=1&supplier=1&lowStock=true&search=QA-0000", { headers: auth })).json()).data;
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every((row) => row.categoryId === 1 && row.supplierId === 1 && row.quantity <= 10));
    assert.deepEqual((await (await request("/api/products?search=nomatch", { headers: auth })).json()).data, []);
    const supplierOrders = (await (await request("/api/orders", { headers: { Authorization: "Bearer synthetic-qa-SUPPLIER" } })).json()).data;
    assert.ok(supplierOrders.length > 0);
    assert.ok(supplierOrders.every((order) => order.orderItems.every((item) => item.product.supplierId === 1)));
    const detail = (await (await request(`/api/orders/${supplierOrders[0].id}`, { headers: { Authorization: "Bearer synthetic-qa-SUPPLIER" } })).json()).data;
    assert.equal(detail.orderItems.length, 3);
  });

  await t.test("report storage is redacted, bounded, resettable and tied to fixture configuration", async () => {
    const { generation } = await (await request("/__qa/report")).json();
    assert.match(generation, /^[a-f0-9-]{36}$/);
    const metrics = await (await request("/__qa/metrics.js")).text();
    assert.ok(metrics.includes(`const generation = "${generation}";`));
    assert.ok(!metrics.includes("__STOCKFLOW_QA_GENERATION__"));
    const report = { generation, path: "/admin/products", browser: "Chromium/140", ready: true, routeReadyMs: 150, usedJSHeapBytes: null, errorCount: 0, password: "never keep", token: "never keep", message: "never keep" };
    for (let index = 0; index < 122; index += 1) assert.equal((await request("/__qa/report", json(report))).status, 200);
    let result = await (await request("/__qa/report")).json();
    assert.equal(result.reports.length, 120);
    assert.equal(result.reports.at(-1).config.products, 44);
    assert.equal(result.reports.at(-1).routeReadyMs, 150);
    assert.equal(result.reports.at(-1).usedJSHeapBytes, null);
    assert.doesNotMatch(JSON.stringify(result), /never keep/);
    assert.ok(result.apiBytes > 0);
    assert.equal((await request("/__qa/config", json({ products: 1000, orders: 1000, suppliers: 20 }))).status, 200);
    result = await (await request("/__qa/report")).json();
    assert.deepEqual(result.config, { products: 1000, orders: 1000, suppliers: 20 });
    assert.notEqual(result.generation, generation);
    assert.deepEqual(result.reports, []);
    assert.equal((await request("/__qa/report", json(report))).status, 409);
    assert.deepEqual((await (await request("/__qa/report")).json()).reports, []);
    assert.equal((await request("/__qa/report", json({ ...report, generation: result.generation }))).status, 200);
    const current = (await (await request("/__qa/report")).json()).reports;
    assert.equal(current.length, 1);
    assert.equal(current[0].generation, result.generation);
    assert.equal(current[0].config.products, 1000);
    assert.equal((await (await request("/api/products", { headers: auth })).json()).data.length, 1000);
    assert.equal((await (await request("/api/orders", { headers: auth })).json()).data.length, 1000);
    assert.equal((await (await request("/api/discovery/suppliers", { headers: auth })).json()).data.length, 20);
    assert.equal((await request("/__qa/report", { method: "DELETE" })).status, 200);
    assert.deepEqual((await (await request("/__qa/report")).json()).apiRequests, {});
  });
});
