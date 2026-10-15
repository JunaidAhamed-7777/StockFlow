import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { setImmediate } from "node:timers";
import ts from "typescript";
import * as remotePage from "../src/utils/remotePage.mjs";
import * as listState from "../src/utils/listState.mjs";
import * as format from "../src/utils/format.js";

// Run the maintained pages and list hooks with a deterministic hook scheduler.
// Only service, router and presentation boundaries are replaced; no API is used.
const apps = [];
afterEach(() => { for (const app of apps.splice(0)) app.dispose(); });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const equal = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const page = (total = 44, requestedPage = 1, pageSize = 20, rows) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(requestedPage, pageCount);
  return { rows: rows || Array.from({ length: Math.min(pageSize, total - (current - 1) * pageSize) }, (_, index) => ({
    id: (current - 1) * pageSize + index + 1, sku: `QA-${index}`, name: `Product ${index}`, categoryId: 1, supplierId: 1,
    quantity: 5, lowStockThreshold: 10, price: 4, visibleLineCount: 3, visibleAmount: 17, status: "PENDING", createdAt: "2026-01-01",
  })), page: current, pageSize, total, pageCount, hasNext: current < pageCount, hasPrevious: current > 1, summary: {} };
};

function setup(relative, { query = "", role = "ADMIN", supplier = { id: 1, companyName: "Supplier one" }, props = {} } = {}) {
  const slots = [], effects = [], reads = [], details = [], updates = [], deletions = [], navigations = [];
  let cursor = 0, dirty = true, tree, currentQuery = query;
  function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => {
      const value = typeof next === "function" ? next(slots[index]) : next;
      if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
    }];
  }
  function useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; }
  function useMemo(callback, dependencies) {
    const index = cursor++;
    if (!slots[index] || !equal(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: callback() };
    return slots[index].value;
  }
  function useEffect(callback, dependencies) {
    const index = cursor++;
    if (!slots[index] || !equal(slots[index].dependencies, dependencies)) {
      const previous = slots[index];
      slots[index] = { dependencies, cleanup: previous?.cleanup };
      effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
    }
  }
  const request = (collection) => (...args) => { const next = { ...deferred(), args }; collection.push(next); return next.promise; };
  const modules = {
    react: { useState, useRef, useMemo, useEffect },
    "react-router-dom": {
      useSearchParams: () => [new URLSearchParams(currentQuery), (next) => {
        const value = typeof next === "function" ? next(new URLSearchParams(currentQuery)) : next;
        const query = new URLSearchParams(value).toString();
        if (query !== currentQuery) { currentQuery = query; dirty = true; }
      }],
      useLocation: () => ({ pathname: "/list", search: currentQuery ? `?${currentQuery}` : "" }),
      useNavigate: () => (...args) => navigations.push(args),
    },
    "../../context/AuthContext": { useAuth: () => ({ role, supplier }) },
    "../../context/CartContext": { useCart: () => ({ addItem() {}, count: 0 }) },
    "../../services/product.service": { listProductPage: request(reads), deleteProduct: request(deletions) },
    "../../services/order.service": { listOrderPage: request(reads), getOrder: request(details), updateOrderStatus: request(updates) },
    "../../services/discovery.service": { getCategories: async () => [{ id: 1, name: "Office" }], getSuppliers: async () => [supplier].filter(Boolean) },
    "../../utils/errors": { getErrorMessage: (error) => error.message },
    "../../utils/format": format,
    "../../utils/listState.mjs": listState,
    "../utils/listState.mjs": listState,
    "../utils/remotePage.mjs": remotePage,
  };
  const compiledModules = new Map();
  function load(file) {
    if (compiledModules.has(file)) return compiledModules.get(file);
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, jsxFactory: "element", jsxFragmentFactory: "fragment",
    } }).outputText;
    const exports = {};
    const require = (name) => {
        if (modules[name]) return modules[name];
        if (name.endsWith("/hooks/useListState")) return load("hooks/useListState.js");
        if (name.endsWith("/hooks/useRemotePagination")) return load("hooks/useRemotePagination.js");
        if (name.includes("/components/")) return new Proxy({}, { get: (_, key) => ({ name: key }) });
        throw new Error(`Unexpected page dependency: ${name}`);
    };
    vm.runInThisContext(`(function(exports, require, element, fragment, AbortController, requestAnimationFrame) { ${compiled}\n})`)(exports, require, element, "fragment", AbortController, (callback) => callback());
    compiledModules.set(file, exports);
    return exports;
  }
  const exports = load(relative);
  const Component = exports.OrdersPage || exports[relative.split("/").at(-1).replace(".jsx", "")];
  function render() {
    cursor = 0; dirty = false;
    tree = Component(props);
    for (const effect of effects.splice(0)) effect();
  }
  const app = {
    reads, details, updates, deletions, navigations,
    get query() { return currentQuery; },
    navigate(query) { currentQuery = query; dirty = true; },
    find(name, predicate = () => true) {
      const found = [];
      function visit(node) {
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (!node || typeof node !== "object") return;
        if ((node.type?.name || node.type) === name && predicate(node.props)) found.push(node.props);
        visit(node.props?.children);
      }
      visit(tree);
      return found;
    },
    async flush() {
      for (let turn = 0; turn < 10; turn++) {
        if (dirty) render();
        await new Promise((resolve) => setImmediate(resolve));
        if (!dirty && effects.length === 0) return;
      }
      throw new Error("Page did not settle.");
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
  apps.push(app);
  return app;
}

test("each product page requests the restored server page and displays its complete rows without reslicing", async () => {
  for (const [file, size, role] of [["admin/AdminProducts.jsx", 20, "ADMIN"], ["supplier/SupplierProducts.jsx", 20, "SUPPLIER"], ["customer/CustomerProducts.jsx", 12, "CUSTOMER"]]) {
    const app = setup(`pages/${file}`, { query: "page=2&search=desk", role });
    await app.flush();
    assert.equal(app.reads.length, 1);
    assert.equal(app.reads[0].args[0].page, 2);
    assert.equal(app.reads[0].args[0].pageSize, size);
    assert.equal(app.reads[0].args[0].search, "desk");
    if (role === "SUPPLIER") assert.equal(app.reads[0].args[0].supplier, 1);
    app.reads[0].resolve(page(44, 2, size));
    await app.flush();
    const pager = app.find("Pagination")[0];
    assert.equal(pager.total, 44); assert.equal(pager.page, 2); assert.equal(pager.pageSize, size);
    if (role === "CUSTOMER") assert.equal(app.find("ProductImage").length, 12);
    else assert.equal(app.find("Table")[0].rows.length, 20);
  }
});

test("low-stock filtering is sent before pagination and supplier profiles fail closed", async () => {
  const admin = setup("pages/admin/AdminProducts.jsx", { query: "page=3&lowStock=1&supplier=2" });
  await admin.flush();
  assert.equal(admin.reads[0].args[0].stock, "low");
  assert.equal(admin.reads[0].args[0].supplier, "2");
  for (const file of ["pages/supplier/SupplierProducts.jsx", "pages/admin/AdminOrders.jsx"]) {
    const app = setup(file, { role: "SUPPLIER", supplier: null });
    await app.flush();
    assert.equal(app.reads.length, 0);
    assert.match(app.find("ErrorState")[0].message, /No supplier profile/);
  }
});

test("every remote list aborts superseded requests, ignores late responses and retains failed restored pages", async () => {
  for (const file of ["admin/AdminProducts.jsx", "supplier/SupplierProducts.jsx", "customer/CustomerProducts.jsx", "admin/AdminOrders.jsx", "customer/CustomerOrders.jsx"]) {
    const size = file === "customer/CustomerProducts.jsx" ? 12 : 20;
    const app = setup(`pages/${file}`, { query: "page=99&search=old" });
    await app.flush();
    const old = app.reads[0];
    app.navigate("page=2&search=new"); await app.flush();
    assert.equal(old.args[1].signal.aborted, true);
    app.reads[1].resolve(page(44, 2, size)); await app.flush();
    old.resolve(page(1, 1, size)); await app.flush();
    assert.equal(app.query, "page=2&search=new");
    const firstId = size === 12 ? app.find("ProductImage")[0].product.id : app.find("Table")[0].rows[0].id;
    assert.equal(firstId, size + 1);
    app.navigate("page=99&search=unavailable"); await app.flush();
    app.reads[2].reject(new Error("Synthetic unavailable")); await app.flush();
    assert.equal(app.query, "page=99&search=unavailable");
    assert.equal(app.find("Pagination").length, 0);
    assert.equal(app.find("ErrorState")[0].message, "Synthetic unavailable");
  }
});

test("deleting a last-page product refreshes the filtered count before clamping", async () => {
  const app = setup("pages/admin/AdminProducts.jsx", { query: "page=2&lowStock=1" });
  await app.flush(); app.reads[0].resolve(page(21, 2)); await app.flush();
  const table = app.find("Table")[0];
  const actions = table.columns.find((column) => column.key === "actions").render(table.rows[0]);
  actions.props.children.find((child) => child.props.variant === "danger").props.onClick();
  await app.flush();
  const deleting = app.find("ConfirmModal")[0].onConfirm(); await app.flush();
  app.deletions[0].resolve({ success: true }); await deleting; await app.flush();
  assert.equal(app.reads[1].args[0].page, 2); assert.equal(app.reads[1].args[0].stock, "low");
  assert.equal(app.query, "page=2&lowStock=1");
  app.reads[1].resolve(page(20, 2)); await app.flush();
  assert.equal(new URLSearchParams(app.query).get("page"), null);
  assert.equal(new URLSearchParams(app.query).get("lowStock"), "1");
});

test("customer orders use summary rows and refetch committed filters and pages", async () => {
  const app = setup("pages/customer/CustomerOrders.jsx", { role: "CUSTOMER", query: "page=2&status=PENDING&search=%231" });
  await app.flush();
  assert.equal(app.reads[0].args[0].search, "#1"); assert.equal(app.reads[0].args[0].status, "PENDING");
  app.reads[0].resolve(page(44, 2)); await app.flush();
  const table = app.find("Table")[0];
  assert.equal(table.rows.length, 20);
  assert.ok(table.columns.some((column) => column.key === "visibleLineCount"));
  const amount = table.columns.find((column) => column.key === "visibleAmount");
  assert.equal(amount.render({ visibleAmount: 17 }), "$17.00");
  app.navigate("status=SHIPPED"); await app.flush();
  assert.equal(app.reads[1].args[0].page, 1); assert.equal(app.reads[1].args[0].status, "SHIPPED");
  assert.equal(app.reads[0].args[1].signal.aborted, true);
});

test("supplier order details refuse mixed or unverified status updates even after foreign lines are redacted", async () => {
  const app = setup("pages/admin/AdminOrders.jsx", { role: "SUPPLIER", props: { title: "Orders", canUpdateStatus: true } });
  await app.flush(); app.reads[0].resolve(page(1)); await app.flush();
  const row = app.find("Table")[0].rows[0];
  assert.equal(app.find("Table")[0].columns.find((column) => column.key === "visibleAmount").render(row), "$17.00");
  const detail = { id: 1, status: "PENDING", totalAmount: 8, orderItems: [{ id: 1, quantity: 2, price: 4, product: { supplierId: 1 } }] };
  for (const hasOtherSuppliers of [true, undefined, false]) {
    app.find("Table")[0].columns.find((column) => column.key === "actions").render(row).props.onClick({ stopPropagation() {} });
    await app.flush();
    app.details.at(-1).resolve({ ...detail, hasOtherSuppliers }); await app.flush();
    const footer = app.find("Modal")[0].footer;
    assert.equal(Array.isArray(footer?.props?.children) && footer.props.children.some((child) => child?.type?.name === "Select"), hasOtherSuppliers === false);
  }
  assert.equal(app.updates.length, 0);
});

test("a saved status refreshes the current filtered page and totals while retaining the open detail", async () => {
  const app = setup("pages/admin/AdminOrders.jsx", { role: "SUPPLIER", query: "page=2&status=PENDING", props: { title: "Orders", canUpdateStatus: true } });
  await app.flush(); app.reads[0].resolve(page(21, 2)); await app.flush();
  const table = app.find("Table")[0];
  const row = table.rows[0];
  table.columns.find((column) => column.key === "actions").render(row).props.onClick({ stopPropagation() {} });
  await app.flush();
  const ownDetail = { id: row.id, status: "PENDING", totalAmount: 17, hasOtherSuppliers: false, orderItems: [{ id: 1, price: 17, quantity: 1, product: { supplierId: 1 } }] };
  app.details[0].resolve(ownDetail); await app.flush();
  const footer = app.find("Modal")[0].footer;
  footer.props.children.find((child) => child.type?.name === "Select").props.onChange({ target: { value: "PROCESSING" } });
  await app.flush();
  const action = app.find("Modal")[0].footer.props.children.find((child) => child.type?.name === "Button");
  const saving = action.props.onClick();
  await app.flush();
  app.updates[0].resolve({ id: row.id, status: "PROCESSING", totalAmount: 17, orderItems: [] });
  await app.flush();
  assert.equal(app.details.length, 2);
  app.details[1].resolve({ ...ownDetail, status: "PROCESSING" });
  await saving; await app.flush();
  assert.ok(app.find("Modal")[0].footer.props.children.some((child) => child.type?.name === "Select"), "a wholly-owned order retains controls only after the scoped detail is verified again");
  assert.equal(app.reads.length, 2); assert.equal(app.reads[1].args[0].page, 2); assert.equal(app.reads[1].args[0].status, "PENDING");
  assert.equal(app.find("Modal")[0].open, true);
  assert.equal(app.query, "page=2&status=PENDING", "pending refresh must not clamp the URL");
  app.reads[1].resolve(page(20, 2)); await app.flush();
  assert.equal(new URLSearchParams(app.query).get("page"), null);
  assert.equal(new URLSearchParams(app.query).get("status"), "PENDING");
  assert.equal(app.reads[2].args[0].page, 1);
  app.reads[2].resolve(page(20)); await app.flush();
  assert.equal(app.find("Pagination")[0].total, 20);
});

test("a failed detail refresh after a confirmed status save still reloads the list and offers only a safe detail retry", async () => {
  const app = setup("pages/admin/AdminOrders.jsx", { props: { title: "Orders", canUpdateStatus: true } });
  await app.flush(); app.reads[0].resolve(page(1)); await app.flush();
  const table = app.find("Table")[0];
  table.columns.find((column) => column.key === "actions").render(table.rows[0]).props.onClick({ stopPropagation() {} });
  await app.flush(); app.details[0].resolve({ id: 1, status: "PENDING", totalAmount: 17, orderItems: [] }); await app.flush();
  app.find("Modal")[0].footer.props.children.find((child) => child.type?.name === "Select").props.onChange({ target: { value: "PROCESSING" } });
  await app.flush();
  const saving = app.find("Modal")[0].footer.props.children.find((child) => child.type?.name === "Button").props.onClick();
  await app.flush(); app.updates[0].resolve({ id: 1, status: "PROCESSING" }); await app.flush();
  assert.equal(app.reads.length, 2);
  app.details[1].reject(new Error("Synthetic unavailable")); await saving; await app.flush();
  const error = app.find("ErrorState")[0];
  assert.match(error.message, /status update succeeded/);
  assert.equal(app.find("Modal")[0].footer.type.name, "Button");
  error.onRetry(); await app.flush();
  assert.equal(app.details.length, 3);
  assert.equal(app.updates.length, 1, "retry reloads details without repeating the mutation");
});
