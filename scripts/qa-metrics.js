// Served only by qa-browser-server.mjs. Never records input values, tokens or error text.
(() => {
  const supported = PerformanceObserver.supportedEntryTypes || [];
  performance.setResourceTimingBufferSize(2000);
  const state = {
    lcpMs: null, clsSessionWindow: 0, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0,
    eventCount: 0, eventMaxMs: 0, errorCount: 0, unhandledRejectionCount: 0, consoleErrorCount: 0, pendingAPIRequests: 0, apiFailureCount: 0,
  };
  let clsStart = 0;
  let clsLast = 0;
  let clsValue = 0;
  let routeStartedAt = 0;
  let routeReadyMs = null;
  let lastURL = location.href;
  let pending;
  let posting = false;
  const observe = (type, callback, extra = {}) => {
    if (!supported.includes(type)) return;
    try { new PerformanceObserver((list) => callback(list.getEntries())).observe({ type, buffered: true, ...extra }); }
    catch { /* The support flags identify browser-specific coverage. */ }
  };
  observe("largest-contentful-paint", (entries) => { state.lcpMs = entries.at(-1).startTime; });
  observe("layout-shift", (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      if (!clsLast || entry.startTime - clsLast >= 1000 || entry.startTime - clsStart >= 5000) { clsStart = entry.startTime; clsValue = 0; }
      clsLast = entry.startTime;
      clsValue += entry.value;
      state.clsSessionWindow = Math.max(state.clsSessionWindow, clsValue);
    }
  });
  observe("longtask", (entries) => {
    for (const entry of entries) {
      state.longTaskCount += 1;
      state.longTaskTotalMs += entry.duration;
      state.longTaskMaxMs = Math.max(state.longTaskMaxMs, entry.duration);
    }
  });
  observe("event", (entries) => {
    for (const entry of entries) {
      state.eventCount += 1;
      state.eventMaxMs = Math.max(state.eventMaxMs, entry.duration);
    }
  }, { durationThreshold: 16 });
  window.addEventListener("error", () => { state.errorCount += 1; }, true);
  window.addEventListener("unhandledrejection", () => { state.unhandledRejectionCount += 1; });
  const originalError = console.error;
  console.error = function (...args) { state.consoleErrorCount += 1; return originalError.apply(this, args); };
  // Axios uses XHR. Wait for in-flight fixture requests as well as the page's loading UI.
  const apiXHR = new WeakSet();
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { const target = new URL(url, location.origin); if (target.origin === location.origin && target.pathname.startsWith("/api/")) apiXHR.add(this); else apiXHR.delete(this); }
    catch { apiXHR.delete(this); }
    return originalOpen.call(this, method, url, ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (apiXHR.has(this)) {
      state.pendingAPIRequests += 1;
      this.addEventListener("loadend", () => {
        state.pendingAPIRequests = Math.max(0, state.pendingAPIRequests - 1);
        if (this.status >= 400) state.apiFailureCount += 1;
        schedule();
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  function browserLabel() {
    const ua = navigator.userAgent;
    const chromium = /(?:Chrome|Chromium)\/(\d+)/.exec(ua);
    if (chromium) return `Chromium/${chromium[1]}`;
    const firefox = /Firefox\/(\d+)/.exec(ua);
    if (firefox) return `Firefox/${firefox[1]}`;
    return /Safari/.test(ua) ? "Safari" : "Other";
  }
  function rendered(element) { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }
  function snapshot() {
    const main = document.querySelector("main");
    const ready = Boolean(state.pendingAPIRequests === 0 && main?.querySelector("h1") && !main.querySelector('[aria-label="Loading page"], .animate-pulse') && !Array.from(main.querySelectorAll('[role="status"]')).some((element) => /^Loading/.test(element.textContent.trim())));
    if (ready && routeReadyMs === null) routeReadyMs = performance.now() - routeStartedAt;
    const rows = Array.from(main?.querySelectorAll("tbody tr") || []).filter(rendered);
    const resources = performance.getEntriesByType("resource").filter((entry) => !entry.name.includes("/__qa/"));
    const navigation = performance.getEntriesByType("navigation")[0];
    const allResources = navigation ? [navigation, ...resources] : resources;
    const api = resources.filter((entry) => { try { return new URL(entry.name).pathname.startsWith("/api/"); } catch { return false; } });
    const js = resources.filter((entry) => { try { return new URL(entry.name).pathname.endsWith(".js"); } catch { return false; } });
    const total = (entries, property) => entries.reduce((sum, entry) => sum + (entry[property] || 0), 0);
    const page = Number(new URLSearchParams(location.search).get("page"));
    return {
      ...state, path: location.pathname, page: Number.isSafeInteger(page) && page > 0 ? page : 1,
      elapsedMs: performance.now(), routeReadyMs, ready,
      resourceCount: allResources.length, transferBytes: total(allResources, "transferSize"), encodedBytes: total(allResources, "encodedBodySize"), decodedBytes: total(allResources, "decodedBodySize"),
      apiResourceCount: api.length, apiTransferBytes: total(api, "transferSize"), apiResourceTotalMs: total(api, "duration"), apiResourceMaxMs: Math.max(0, ...api.map((entry) => entry.duration)),
      jsResourceCount: js.length, jsTransferBytes: total(js, "transferSize"), navigationTransferBytes: navigation?.transferSize || 0, navigationDurationMs: navigation?.duration || 0, domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
      usedJSHeapBytes: performance.memory?.usedJSHeapSize || null,
      domElements: document.getElementsByTagName("*").length, mainElements: main?.querySelectorAll("*").length || 0,
      renderedRows: rows.length, viewportRows: rows.filter((row) => { const box = row.getBoundingClientRect(); return box.top < innerHeight && box.bottom > 0; }).length,
      productFigures: main?.querySelectorAll("figure").length || 0,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      browser: browserLabel(), viewportWidth: innerWidth, viewportHeight: innerHeight,
      supportsLCP: supported.includes("largest-contentful-paint"), supportsCLS: supported.includes("layout-shift"), supportsLongTasks: supported.includes("longtask"), supportsEvents: supported.includes("event"), supportsHeap: Boolean(performance.memory),
    };
  }
  async function publish() {
    if (posting) return;
    posting = true;
    try {
      await fetch("/__qa/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot()), keepalive: true });
    } catch { /* Metrics failures must not interfere with the application. */ }
    finally { posting = false; }
  }
  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(publish, 150);
  }
  function routeChanged() {
    if (location.href === lastURL) return;
    lastURL = location.href;
    routeStartedAt = performance.now();
    routeReadyMs = null;
    schedule();
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) { const result = original.apply(this, args); routeChanged(); return result; };
  }
  window.addEventListener("popstate", routeChanged);
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  }, { once: true });
  window.addEventListener("pagehide", publish);
  window.addEventListener("resize", schedule);
  // A steady final snapshot also includes observer entries delivered after the last DOM change.
  setInterval(publish, 2000);
})();
