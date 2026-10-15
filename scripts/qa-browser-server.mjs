// Isolated synthetic browser QA. Never imports the backend or reads environment secrets.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { originalProductPhotos } from "./data/demo-catalog.mjs";
import { productPage, orderPage, supplierPage, orderDetail } from "./qa-paged-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDist = path.resolve(here, "../client/dist");
const limits = { products: 100_000, orders: 100_000, suppliers: 10_000 };
const roles = ["CUSTOMER", "SUPPLIER", "ADMIN"];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };

export function validateConfig(input, previous = { products: 44, orders: 44, suppliers: 4 }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a configuration object.");
  const result = { ...previous };
  for (const [key, value] of Object.entries(input)) {
    if (key === "photoFailure" && typeof value === "boolean") { result[key] = value; continue; }
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < (key === "suppliers" ? 1 : 0) || value > limits[key]) {
      throw new Error(`Invalid fixture size: ${key}.`);
    }
    result[key] = value;
  }
  if (result.orders && !result.products) throw new Error("Orders require at least one product.");
  return result;
}

export function createFixtures(config) {
  const users = Object.fromEntries(roles.map((role, index) => [role, {
    id: index + 1, name: `Synthetic ${role.toLowerCase()}`, email: `${role.toLowerCase()}@qa.example.test`, role,
  }]));
  const categories = ["Office", "Hardware", "Packaging", "Safety"].map((name, index) => ({ id: index + 1, name }));
  const suppliers = Array.from({ length: config.suppliers }, (_, index) => ({
    id: index + 1, userId: index ? 100 + index : users.SUPPLIER.id,
    companyName: `Synthetic Supplier ${String(index + 1).padStart(5, "0")}`, contactNumber: "0000000000", address: "Synthetic QA address",
    user: index ? { id: 100 + index, name: `Synthetic Supplier ${index + 1}`, email: `supplier${index + 1}@qa.example.test`, role: "SUPPLIER" } : users.SUPPLIER,
  }));
  const products = Array.from({ length: config.products }, (_, index) => ({
    id: index + 1, name: `Synthetic Product ${String(index + 1).padStart(6, "0")}`, sku: config.photoFailure && index === 0 ? Object.keys(originalProductPhotos)[0] : `QA-${String(index + 1).padStart(6, "0")}`,
    description: "Synthetic inventory for isolated browser performance testing.", price: (index % 1000) + 1.25,
    quantity: index % 51, lowStockThreshold: 10, categoryId: (index % categories.length) + 1, supplierId: (index % suppliers.length) + 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const statuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  const orders = Array.from({ length: config.orders }, (_, index) => {
    const orderItems = Array.from({ length: Math.min(3, products.length) }, (_, line) => {
      const product = products[(index + line) % products.length];
      return { id: index * 3 + line + 1, orderId: index + 1, productId: product.id, quantity: 2, price: product.price, product };
    });
    return { id: index + 1, customerId: users.CUSTOMER.id, customer: users.CUSTOMER, status: statuses[index % statuses.length], totalAmount: orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      createdAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
      orderItems,
    };
  });
  return { users, categories, suppliers, products, orders };
}

async function readJSON(req, maxBytes = 16_384) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw Object.assign(new Error("JSON content type required."), { status: 415 });
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error("Request too large."), { status: 413 });
  }
  try { return JSON.parse(body); } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}

// Discard arbitrary submitted strings, URLs, tokens and error messages.
function cleanReport(input) {
  const report = {};
  if (typeof input?.path === "string" && /^\/(?:admin|supplier|customer|login|register)?(?:\/[a-z0-9-]+)*$/i.test(input.path)) report.path = input.path;
  const keys = ["elapsedMs", "routeReadyMs", "lcpMs", "clsSessionWindow", "longTaskCount", "longTaskTotalMs", "longTaskMaxMs", "eventCount", "eventMaxMs", "resourceCount", "transferBytes", "encodedBytes", "decodedBytes", "apiResourceCount", "apiTransferBytes", "apiResourceTotalMs", "apiResourceMaxMs", "pendingAPIRequests", "apiFailureCount", "jsResourceCount", "jsTransferBytes", "navigationTransferBytes", "navigationDurationMs", "domContentLoadedMs", "usedJSHeapBytes", "domElements", "mainElements", "renderedRows", "viewportRows", "productFigures", "horizontalOverflowPx", "errorCount", "unhandledRejectionCount", "consoleErrorCount", "viewportWidth", "viewportHeight", "page"];
  for (const key of keys) {
    if (input?.[key] === null) report[key] = null;
    else if (Number.isFinite(input?.[key]) && input[key] >= 0 && input[key] <= 1e12) report[key] = input[key];
  }
  if (typeof input?.ready === "boolean") report.ready = input.ready;
  for (const key of ["supportsLCP", "supportsCLS", "supportsLongTasks", "supportsEvents", "supportsHeap"]) if (typeof input?.[key] === "boolean") report[key] = input[key];
  if (/^(?:Chromium|Firefox|Safari|Other)(?:\/\d+)?$/.test(input?.browser)) report.browser = input.browser;
  return report;
}

export function createQAServer({ distRoot = defaultDist, config = {} } = {}) {
  let sizes = validateConfig(config);
  let fixtures = createFixtures(sizes);
  let generation = randomUUID();
  let reports = [];
  let requests = {};
  let apiBytes = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = "application/json") => {
      const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      if (req.url?.startsWith("/api/")) apiBytes += Buffer.byteLength(payload);
      const immutableAsset = status === 200 && /^\/assets\/[^?]+-[a-zA-Z0-9_-]{8,}\.[a-z0-9]+(?:\?.*)?$/.test(req.url || "");
      res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": immutableAsset ? "public, max-age=31536000, immutable" : "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
      res.end(req.method === "HEAD" ? undefined : payload);
    };
    try {
      const host = new URL(`http://${req.headers.host || "invalid"}`);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) || host.port !== String(server.address().port) || req.headers.host !== host.host) return send(403, { message: "Loopback host required." });
      if (req.headers.origin && req.headers.origin !== host.origin) return send(403, { message: "Same-origin requests required." });
      if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { message: "Cross-site requests rejected." });
      const rawPath = decodeURIComponent((req.url || "").split("?")[0]);
      if (!rawPath.startsWith("/") || rawPath.startsWith("//") || rawPath.includes("\\") || rawPath.includes("\0") || rawPath.split("/").includes("..")) return send(400, { message: "Invalid path." });
      const url = new URL(req.url, host.origin);
      const pathname = url.pathname;
      if (pathname === "/__qa/config") {
        if (req.method !== "POST") return send(405, { message: "Use POST JSON fixture sizes." });
        sizes = validateConfig(await readJSON(req, 1024), sizes);
        fixtures = createFixtures(sizes);
        generation = randomUUID();
        reports = []; requests = {}; apiBytes = 0;
        return send(200, { synthetic: true, generation, config: sizes });
      }
      if (pathname === "/__qa/report") {
        if (req.method === "POST") {
          const input = await readJSON(req);
          if (input?.generation !== generation) return send(409, { message: "Fixture generation changed. Reload this QA document." });
          reports.push({ ...cleanReport(input), generation, config: { ...sizes }, receivedAt: new Date().toISOString() });
          reports = reports.slice(-120);
          return send(200, { accepted: true });
        }
        if (req.method === "DELETE") { reports = []; requests = {}; apiBytes = 0; return send(200, { reset: true }); }
        if (req.method === "GET") return send(200, { synthetic: true, generation, config: sizes, apiRequests: requests, apiBytes, reports });
        return send(405, { message: "Unsupported report method." });
      }
      if (pathname === "/__qa/metrics.js" && req.method === "GET") return send(200, (await readFile(path.join(here, "qa-metrics.js"), "utf8")).replace("__STOCKFLOW_QA_GENERATION__", generation), "text/javascript");
      if (pathname === "/__qa" && req.method === "GET") return send(200, '<!doctype html><html><meta charset="utf-8"><title>Synthetic StockFlow QA</title><body><h1>Synthetic StockFlow QA metrics</h1><p>Isolated fixtures; browser measurements are laboratory observations, not production guarantees. LCP and CLS cover the document lifetime; route readiness and DOM counts cover the current route. Event Timing maximum is not field INP. Transfer sizes use browser Resource Timing; API byte counts use uncompressed server responses.</p><p>Sign in as customer@qa.example.test, supplier@qa.example.test or admin@qa.example.test with any password of at least 12 characters.</p><p><a href="/login">Open application</a></p><pre id="qa-report">Loading report…</pre><script src="/__qa/metrics-view.js"></script></body></html>', "text/html");
      if (pathname === "/__qa/metrics-view.js" && req.method === "GET") return send(200, 'async function update(){const data=await fetch("/__qa/report").then(r=>r.json());document.getElementById("qa-report").textContent=JSON.stringify(data,null,2)}update();setInterval(update,2000);', "text/javascript");
      if (pathname.startsWith("/api/")) {
        const normalized = pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
        const key = /^\/api\/(?:health|auth\/(?:me|login)|users\/me|discovery\/(?:categories|suppliers(?:\/:id)?)|products(?:\/:id)?|orders(?:\/:id)?|stock\/(?:low-stock|transactions)|dashboard)$/.test(normalized) ? normalized : "unsupported";
        requests[key] = (requests[key] || 0) + 1;
        if (pathname === "/api/auth/login" && req.method === "POST") {
          const body = await readJSON(req, 4096);
          const role = roles.find((candidate) => fixtures.users[candidate].email === body.email);
          if (!role || typeof body.password !== "string" || body.password.length < 12) return send(401, { success: false, message: "Use a synthetic QA account and a password of at least 12 characters." });
          return send(200, { success: true, data: { token: `synthetic-qa-${role}`, user: fixtures.users[role] } });
        }
        if (req.method !== "GET") return send(405, { success: false, message: "Synthetic QA is read-only. Business mutations are disabled." });
        if (pathname === "/api/health") return send(200, { success: true, synthetic: true });
        if ([...url.searchParams.keys()].some((key) => /^(?:page|pageSize)(?:\[|\.)/.test(key))) return send(400, { message: "Structured page parameters are invalid." });
        const paged = url.searchParams.has("page") || url.searchParams.has("pageSize");
        // Paged catalog/discovery fixtures reproduce the existing public API boundary.
        if (pathname === "/api/products" && paged) return send(200, productPage(fixtures, url.searchParams));
        if (pathname === "/api/discovery/suppliers" && paged) return send(200, supplierPage(fixtures, url.searchParams));
        const role = roles.find((candidate) => req.headers.authorization === `Bearer synthetic-qa-${candidate}`);
        if (!role) return send(401, { success: false, message: "Synthetic QA login required." });
        const { users, products, categories, suppliers, orders } = fixtures;
        const scope = { role, userId: users[role].id, supplierId: suppliers.find((row) => row.userId === users[role].id)?.id };
        const ok = (data) => send(200, { success: true, data });
        if (["/api/auth/me", "/api/users/me"].includes(pathname)) return ok(users[role]);
        if (pathname === "/api/discovery/categories") return ok(categories);
        if (pathname === "/api/discovery/suppliers") {
          if (url.searchParams.has("includeProductCounts")) return send(400, { message: "Supplier aggregates require page." });
          return ok(suppliers);
        }
        if (/^\/api\/discovery\/suppliers\/\d+$/.test(pathname)) {
          const supplier = suppliers.find((row) => row.id === Number(pathname.split("/").at(-1)));
          return supplier ? ok(supplier) : send(404, { message: "Supplier not found." });
        }
        if (pathname === "/api/products") {
          const search = (url.searchParams.get("search") || "").toLowerCase();
          const category = Number(url.searchParams.get("category"));
          const supplier = Number(url.searchParams.get("supplier"));
          const threshold = Number(url.searchParams.get("lowStockThreshold")) || 10;
          return ok(products.filter((row) => (!search || `${row.name} ${row.sku} ${row.description}`.toLowerCase().includes(search)) && (!category || row.categoryId === category) && (!supplier || row.supplierId === supplier) && (url.searchParams.get("lowStock") !== "true" || row.quantity <= threshold)));
        }
        if (/^\/api\/products\/\d+$/.test(pathname)) {
          const product = products.find((row) => row.id === Number(pathname.split("/").at(-1)));
          return product ? ok({ ...product, category: categories[product.categoryId - 1], supplier: suppliers[product.supplierId - 1] }) : send(404, { message: "Product not found." });
        }
        const scopedOrders = role === "SUPPLIER" ? orders.filter((order) => order.orderItems.some((item) => item.product.supplierId === 1)) : orders;
        if (pathname === "/api/orders") {
          if (paged) return send(200, orderPage(fixtures, url.searchParams, scope));
          if (url.searchParams.has("view")) return send(400, { message: "Order views require page." });
          return ok(role === "SUPPLIER" ? scopedOrders.map((order) => ({ ...order, orderItems: order.orderItems.filter((item) => item.product.supplierId === 1) })) : scopedOrders);
        }
        if (/^\/api\/orders\/\d+$/.test(pathname)) {
          return ok(orderDetail(fixtures, Number(pathname.split("/").at(-1)), scope));
        }
        if (pathname === "/api/stock/low-stock") return ok(products.filter((row) => row.quantity <= row.lowStockThreshold && (role !== "SUPPLIER" || row.supplierId === 1)));
        if (pathname === "/api/stock/transactions") return send(501, { success: false, code: "NOT_IMPLEMENTED", message: "Stock transaction listing not implemented yet." });
        if (pathname === "/api/dashboard") {
          const ownedProducts = role === "SUPPLIER" ? products.filter((row) => row.supplierId === 1) : products;
          const stock = ownedProducts.reduce((sum, row) => sum + row.quantity, 0);
          const pendingOrders = scopedOrders.filter((row) => row.status === "PENDING").length;
          const metrics = role === "ADMIN" ? { totalProducts: products.length, totalStock: stock, totalOrders: orders.length, pendingOrders, totalCustomers: 1, totalSuppliers: suppliers.length } : role === "SUPPLIER" ? { productCount: ownedProducts.length, stock } : { orderCount: orders.length, pendingOrders, deliveredOrders: orders.filter((row) => row.status === "DELIVERED").length, totalSpending: orders.reduce((sum, row) => sum + row.totalAmount, 0) };
          return send(200, { success: true, role, metrics });
        }
        return send(404, { success: false, message: "No synthetic fixture for this endpoint." });
      }
      if (!["GET", "HEAD"].includes(req.method)) return send(405, { message: "Read-only static server." });
      const root = await realpath(distRoot);
      let target = path.resolve(root, `.${pathname}`);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) return send(400, { message: "Invalid path." });
      try { if (!(await stat(target)).isFile()) target = path.join(root, "index.html"); }
      catch { if (path.extname(pathname)) return send(404, { message: "Asset not found." }); target = path.join(root, "index.html"); }
      target = await realpath(target);
      if (!target.startsWith(`${root}${path.sep}`)) return send(403, { message: "Asset outside dist rejected." });
      let body = await readFile(target);
      if (path.extname(target) === ".html") {
        body = body.toString().replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, "").replace("<head>", '<head><script src="/__qa/metrics.js"></script>');
      }
      return send(200, body, mime[path.extname(target)] || "application/octet-stream");
    } catch (error) {
      return send(error.status || (error instanceof URIError ? 400 : 400), { message: error.status ? error.message : "Invalid QA request or unavailable dist. Build client first." });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (const argument of process.argv.slice(2)) {
    const match = /^--(products|orders|suppliers)=(\d+)$/.exec(argument);
    if (!match) throw new Error(`Unsupported option: ${argument}`);
    options[match[1]] = Number(match[2]);
  }
  const server = createQAServer({ config: options });
  server.listen(4173, "127.0.0.1", () => process.stdout.write("Synthetic QA: http://127.0.0.1:4173/__qa (read-only; no real API/DB calls)\n"));
}
