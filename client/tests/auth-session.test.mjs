import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as storage from "../src/utils/storage.ts";
import { publicUser } from "../src/utils/apiData.js";
import { normalizeRole, portalHome } from "../src/utils/roles.js";
import { getErrorMessage } from "../src/utils/errors.js";

// Compile the real provider, preserving its imports and behavior. Mock only the
// hook scheduler and API boundaries; these tests never open a browser or network.
const source = readFileSync(new URL("../src/context/AuthContext.jsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: "renderProvider" },
}).outputText;
const apps = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
  delete globalThis.window;
});

const identity = (id, role) => ({ id, role, name: `User ${id}`, email: `user${id}@example.test` });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
function store() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function setup(token, initialUser, session = false) {
  const handlers = new Map();
  globalThis.window = {
    localStorage: store(), sessionStorage: store(),
    addEventListener(name, handler) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
    },
    removeEventListener: (name, handler) => handlers.get(name)?.delete(handler),
    dispatchEvent(event) { for (const handler of handlers.get(event.type) || []) handler(event); },
  };
  storage.removeStorage(storage.TOKEN_KEY);
  storage.removeStorage(storage.USER_KEY);
  if (token) {
    storage.writeStorage(storage.TOKEN_KEY, token, { session });
    storage.writeStorage(storage.USER_KEY, initialUser, { session });
  }

  const slots = [];
  const effects = [];
  const me = [];
  const suppliers = [];
  const logins = [];
  let cursor = 0;
  let dirty = true;
  let value;
  const equal = (left, right) => left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => {
      const result = typeof next === "function" ? next(slots[index]) : next;
      if (!Object.is(result, slots[index])) { slots[index] = result; dirty = true; }
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
  const modules = {
    react: { createContext: () => ({ Provider: {} }), useContext: () => value, useState, useRef, useMemo, useCallback: useMemoCallback, useEffect },
    "../services/auth.service": {
      getMe: () => { const next = deferred(); me.push(next); return next.promise; },
      login: () => { const next = deferred(); logins.push(next); return next.promise; },
      register: () => Promise.resolve(),
    },
    "../services/discovery.service": { getSuppliers: () => { const next = deferred(); suppliers.push(next); return next.promise; } },
    "../utils/storage": storage,
    "../utils/roles": { normalizeRole, portalHome },
    "../utils/errors": { getErrorMessage },
    "../utils/apiData": { publicUser },
  };
  function useMemoCallback(callback, dependencies) { return useMemo(() => callback, dependencies); }
  const exports = {};
  const context = vm.createContext({
    window, exports,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected provider dependency: ${name}`);
      return modules[name];
    },
    renderProvider: (_component, props) => props.value,
  });
  vm.runInContext(compiled, context, { filename: "AuthContext.jsx" });

  function flush() {
    let iterations = 0;
    while (dirty || effects.length) {
      assert.ok(++iterations <= 30, "Provider exceeded the render limit");
      if (dirty) { dirty = false; cursor = 0; value = exports.AuthProvider({ children: null }); }
      while (effects.length) effects.shift()();
    }
  }
  async function settle() {
    for (let index = 0; index < 8; index++) { await Promise.resolve(); flush(); }
  }
  function change(nextToken, nextUser) {
    if (nextToken) window.localStorage.setItem(storage.TOKEN_KEY, JSON.stringify(nextToken));
    else window.localStorage.removeItem(storage.TOKEN_KEY);
    if (nextUser) window.localStorage.setItem(storage.USER_KEY, JSON.stringify(nextUser));
    else window.localStorage.removeItem(storage.USER_KEY);
    for (const key of [storage.TOKEN_KEY, storage.USER_KEY]) {
      window.dispatchEvent({ type: "storage", key });
      flush();
    }
  }
  function dispose() { for (const slot of slots) slot?.cleanup?.(); }
  flush();
  const app = { get value() { flush(); return value; }, me, suppliers, logins, change, settle, dispose };
  apps.push(app);
  return app;
}

test("remembered account replacement blocks the previous role and validates once", async () => {
  const app = setup("admin-token", identity(1, "ADMIN"));
  assert.equal(app.value.loading, true);
  assert.equal(app.value.user, null);
  app.me[0].resolve(identity(1, "ADMIN")); await app.settle();
  assert.equal(app.value.role, "ADMIN");
  app.change("customer-token", identity(2, "CUSTOMER"));
  assert.equal(app.value.loading, true);
  assert.equal(app.value.isAuthenticated, false);
  assert.equal(app.value.user, null);
  assert.equal(app.value.supplier, null);
  assert.equal(app.me.length, 2);
  app.me[1].resolve(identity(2, "CUSTOMER")); await app.settle();
  assert.equal(app.value.user.id, 2);
  assert.equal(app.value.role, "CUSTOMER");
  assert.equal(app.value.isAuthenticated, true);
});

test("a stale restoration response cannot resurrect the previous account", async () => {
  const app = setup("old-token", identity(1, "ADMIN"));
  const oldRestore = app.me[0];
  app.change("new-token", identity(2, "CUSTOMER"));
  app.me[1].resolve(identity(2, "CUSTOMER")); await app.settle();
  oldRestore.resolve(identity(1, "ADMIN")); await app.settle();
  assert.equal(app.value.user.id, 2);
  assert.equal(storage.readStorage(storage.TOKEN_KEY), "new-token");
});

test("a delayed supplier lookup cannot attach ownership to another account", async () => {
  const app = setup("supplier-token", identity(3, "SUPPLIER"));
  app.me[0].resolve(identity(3, "SUPPLIER")); await app.settle();
  assert.equal(app.suppliers.length, 1);
  assert.equal(app.value.loading, true);
  app.change("customer-token", identity(4, "CUSTOMER"));
  app.me[1].resolve(identity(4, "CUSTOMER")); await app.settle();
  app.suppliers[0].resolve([{ id: 30, userId: 3, companyName: "Old supplier" }]); await app.settle();
  assert.equal(app.value.user.id, 4);
  assert.equal(app.value.supplier, null);
  assert.equal(app.value.loading, false);
});

test("session-only accounts ignore another tab's remembered sign-in and sign-out", async () => {
  const app = setup("private-token", identity(5, "CUSTOMER"), true);
  app.me[0].resolve(identity(5, "CUSTOMER")); await app.settle();
  app.change("remembered-token", identity(6, "ADMIN"));
  assert.equal(app.me.length, 1);
  assert.equal(app.value.user.id, 5);
  assert.equal(storage.readStorage(storage.TOKEN_KEY), "private-token");
  app.change(null, null);
  assert.equal(app.value.user.id, 5);
  assert.equal(app.value.isAuthenticated, true);
});

test("cross-tab sign-out invalidates a pending profile refresh", async () => {
  const app = setup("refresh-token", identity(7, "ADMIN"));
  app.me[0].resolve(identity(7, "ADMIN")); await app.settle();
  const refresh = app.value.refreshUser();
  app.change(null, null);
  assert.equal(app.value.user, null);
  assert.equal(app.value.isAuthenticated, false);
  app.me[1].resolve(identity(7, "ADMIN")); await refresh; await app.settle();
  assert.equal(app.value.user, null);
  assert.equal(storage.readStorage(storage.TOKEN_KEY), null);
});

test("a stale local login cannot replace a newer cross-tab identity", async () => {
  const app = setup(null, null);
  const login = app.value.login("old@example.test", "unused").then(() => null, (error) => error);
  app.change("remote-token", identity(8, "CUSTOMER"));
  app.me[0].resolve(identity(8, "CUSTOMER")); await app.settle();
  app.logins[0].resolve({ token: "late-token", user: identity(9, "ADMIN") });
  assert.match((await login).message, /session changed/i);
  await app.settle();
  assert.equal(app.value.user.id, 8);
  assert.equal(storage.readStorage(storage.TOKEN_KEY), "remote-token");
});

test("a rejected login leaves no authenticated identity or stuck loading state", async () => {
  const app = setup(null, null);
  const login = app.value.login("bad@example.test", "unused").catch((error) => error);
  app.logins[0].reject(new Error("Invalid credentials"));
  assert.equal((await login).message, "Invalid credentials");
  await app.settle();
  assert.equal(app.value.loading, false);
  assert.equal(app.value.isAuthenticated, false);
});
