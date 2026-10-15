export const TOKEN_KEY = "stockflow.token";
export const USER_KEY = "stockflow.user";
export const CART_KEY = "stockflow.cart";
export const SESSION_EXPIRED_EVENT = "stockflow:session-expired";

// Storage may be blocked by browser privacy settings. A session still works in
// memory, without crashing login or falling back to a less private store.
const memory = new Map<string, unknown>();
const memorySessionKeys = new Set<string>();

function browserStore(session = false): Storage | null {
  try {
    return session ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readStore(store: Storage | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function readStorage<T = unknown>(key: string, fallback: T | null = null): T | null {
  const value = memory.get(key) ?? readStore(browserStore(true), key) ?? readStore(browserStore(), key);
  return (value ?? fallback) as T | null;
}

export function writeStorage(key: string, value: unknown, options: { session?: boolean } = {}): void {
  const session = Boolean(options.session);
  memory.delete(key);
  memorySessionKeys.delete(key);
  try {
    browserStore(!session)?.removeItem(key);
    const target = browserStore(session);
    if (!target) throw new Error("Storage unavailable");
    target.setItem(key, JSON.stringify(value));
  } catch {
    // The current page can continue if storage is unavailable or full.
    memory.set(key, value);
    if (session) memorySessionKeys.add(key);
  }
}

export function isSessionKey(key: string): boolean {
  return memorySessionKeys.has(key) || readStore(browserStore(true), key) !== undefined;
}

export function removeStorage(key: string): void {
  memory.delete(key);
  memorySessionKeys.delete(key);
  for (const store of [browserStore(), browserStore(true)]) {
    try { store?.removeItem(key); } catch { /* A blocked store is already unavailable. */ }
  }
}

export function expireSession(): void {
  removeStorage(TOKEN_KEY);
  removeStorage(USER_KEY);
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
