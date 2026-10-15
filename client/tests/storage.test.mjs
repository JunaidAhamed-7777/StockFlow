import test from "node:test";
import assert from "node:assert/strict";
import { TOKEN_KEY, USER_KEY, SESSION_EXPIRED_EVENT, readStorage, writeStorage, removeStorage, isSessionKey, expireSession } from "../src/utils/storage.ts";

function store() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}

test("session-only login removes a previously remembered token", () => {
  globalThis.window = { localStorage: store(), sessionStorage: store() };
  writeStorage(TOKEN_KEY, "previous-token");
  writeStorage(TOKEN_KEY, "session-token", { session: true });
  assert.equal(window.localStorage.getItem(TOKEN_KEY), null);
  assert.equal(readStorage(TOKEN_KEY), "session-token");
  assert.equal(isSessionKey(TOKEN_KEY), true);
  removeStorage(TOKEN_KEY);
  assert.equal(readStorage(TOKEN_KEY), null);
});

test("cross-tab changes are read directly rather than hidden by an in-memory cache", () => {
  globalThis.window = { localStorage: store(), sessionStorage: store() };
  writeStorage(TOKEN_KEY, "first-token");
  window.localStorage.setItem(TOKEN_KEY, JSON.stringify("updated-in-another-tab"));
  assert.equal(readStorage(TOKEN_KEY), "updated-in-another-tab");
  window.localStorage.removeItem(TOKEN_KEY);
  assert.equal(readStorage(TOKEN_KEY), null);
});

test("blocked storage falls back to the current page and still supports explicit sign out", () => {
  globalThis.window = {};
  Object.defineProperty(window, "localStorage", { get() { throw new Error("Blocked"); } });
  Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Blocked"); } });
  writeStorage(TOKEN_KEY, "memory-token", { session: true });
  assert.equal(readStorage(TOKEN_KEY), "memory-token");
  assert.equal(isSessionKey(TOKEN_KEY), true);
  removeStorage(TOKEN_KEY);
  assert.equal(readStorage(TOKEN_KEY), null);
});

test("session expiration clears credentials and announces a state change without token data", () => {
  const events = [];
  globalThis.window = { localStorage: store(), sessionStorage: store(), dispatchEvent: (event) => events.push(event) };
  writeStorage(TOKEN_KEY, "expired-token");
  writeStorage(USER_KEY, { id: 1 });
  expireSession();
  assert.equal(readStorage(TOKEN_KEY), null);
  assert.equal(readStorage(USER_KEY), null);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, SESSION_EXPIRED_EVENT);
  assert.equal("detail" in events[0], false);
});
