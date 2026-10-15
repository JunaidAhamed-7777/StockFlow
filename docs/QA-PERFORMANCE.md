# Production browser performance QA · issue #9

Measured on 15 October 2026 against production assets built from `0516d14`.
The isolated QA harness was added in `d0c97be`; `424481b` prevents an older
document from labeling telemetry with a newly selected fixture dataset.
No production frontend or backend source changed for this analysis.

## Repeat the measurement

From the repository root:

```powershell
npm run build
node --test scripts/qa-browser-server.test.mjs
node scripts/qa-browser-server.mjs --products=44 --orders=44 --suppliers=40
```

Open `http://127.0.0.1:4173/__qa` for instructions, or `/login` for the real
production React application. Sign in with `admin@qa.example.test`,
`customer@qa.example.test`, or `supplier@qa.example.test` and any synthetic
password of at least 12 characters. These are fixture identities, not real
accounts. The server never reads credentials/environment files or connects to
the API, database, n8n, Discord, or a model. Business writes are rejected.

Keep `VITE_API_BASE_URL` unset when building this fixture run: it uses relative
`/api`. External network requests are blocked, external font links are removed,
and synthetic SKUs intentionally use the product-photo placeholder. This isolates
data processing; it is not an external-image/font benchmark.

Change sizes from a second terminal, then **reload the browser document**:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4173/__qa/config `
  -ContentType application/json `
  -Body '{"products":1000,"orders":1000,"suppliers":40}'
```

Repeat with 10,000 products/orders. Orders have three nested product lines, with
computed totals. A unique fixture generation is embedded when the metrics script
loads. After a configuration change, old documents receive HTTP 409 for telemetry
until reloaded; their measurements are not stored under the new sizes. Close
unused fixture tabs before changing sizes. Never run this server on a public
interface; its CLI binds `127.0.0.1` and validates Host/Origin.

For each size, inspect admin products, orders and suppliers. Verify row counts
and totals before recording a sample. Exercise Next, unsubmitted search typing,
submitted search, no matches, clear, and supplier detail open/close. Use full
document navigation to separate per-document resource totals; SPA totals include
earlier routes. Inspect the customer catalog at desktop and phone widths.

Save a local capture after each stage:

```powershell
$qaCapture = Invoke-RestMethod http://127.0.0.1:4173/__qa/report
$qaCapture | ConvertTo-Json -Depth 12 | Set-Content .local/qa-performance.json
```

The report retains 120 samples. `DELETE /__qa/report` clears counters without
changing fixtures. To repeat a genuinely cold origin, start the exported
`createQAServer` on a previously unused loopback port and use the same tab there;
reload that origin for its warm sample. Do not call a warm SPA navigation a cold
document load.

## Observed environment and results

Codex in-app Chromium 155, desktop viewport 1440 × 1000. Phone verification used
390 × 844; no CPU/network throttling or physical phone was used. Timing values
are individual laboratory observations, not medians, field percentiles, or SLAs.
Responses are uncompressed on loopback. Resource Timing transfer includes browser
header overhead; server response-byte counters measure uncompressed bodies.

- Fresh-origin sign-in: 342,687 JavaScript transfer bytes, LCP 648 ms, navigation
  557.8 ms, CLS 0. Warm reload: zero JavaScript transfer bytes, LCP 108 ms,
  navigation 76.9 ms, CLS 0. Saved in `.local/qa9-cold-login.json` and
  `.local/qa9-warm-login.json`.
- 44 products: observed readiness 218.6 ms and 20 rows. This was a SPA route:
  products added 3 API resources / 23,405 transfer bytes beyond the supplier view.
  The next 44-order view added 1 / 59,317 bytes, with readiness 242.6 ms and 20
  rows. These share document LCP 252 ms and CLS 0; resource totals must not be
  treated as separate cold loads. Capture: `.local/qa9-44.json`.
- 1,000 products: readiness 809.2 ms, LCP 640 ms, CLS 0.00057, 312,344 API transfer
  bytes, maximum API-resource duration 18.7 ms, approximately 10.2 MB observed JS
  heap, 20 rows. Capture: `.local/qa9-1000-products.json`.
- 1,000 three-line orders: readiness 394.8 ms, LCP 296 ms, CLS 0, 1,365,188 API
  transfer bytes, maximum API-resource duration 28.3 ms, approximately 11.3 MB JS
  heap, 20 rows. One 59 ms long task. Capture: `.local/qa9-1000-orders.json`.
- 10,000 products: readiness 606.2 ms, LCP 376 ms, CLS 0.00057, 3,034,593 API
  transfer bytes, maximum API-resource duration 68.6 ms, approximately 18.5 MB JS
  heap, 20 rows. No recorded long tasks. Capture:
  `.local/qa9-10000-products.json`.
- 10,000 three-line orders: readiness 640.2 ms, LCP 512 ms, CLS 0, 13,772,034 API
  transfer bytes, maximum API-resource duration 201 ms, approximately 35.5 MB JS
  heap, 20 rows. One 74 ms long task. Capture:
  `.local/qa9-10000-orders.json`.
- Supplier counts agreed with fixtures: 44 products distributed over 40 suppliers
  yield 2 for the first four suppliers and 1 for the others; 10,000 products yield
  250 each. Both directory views render 20 rows. The clean 10,000-product typing
  repeat recorded maximum event duration 24 ms and a 54 ms long task. An earlier
  interrupted typing attempt recorded 2,288 ms but did not reproduce; it is an
  outlier, not a confirmed application defect.

The 1,000/10,000-record document samples used warm hashed JS assets (zero JS
transfer). Readiness is the first sampled state with a heading, no skeleton and
no pending API XHR. Sampling uses a 150 ms debounce and a periodic final snapshot;
it is a readiness proxy, not exact paint latency. LCP/CLS, events, resources and
heap are document-scoped. Event Timing maximum is **not** field INP. Heap readings
vary with garbage collection and are not retained-memory measurements.

The samples above were selected using observed UI counts and document navigation
timings. Earlier captures predate the generation fix and contain trailing samples
from a previous document after configuration changes; those mislabeled trailing
samples were excluded. New runs reject them automatically.

## Browser behavior and findings

Three products → orders → suppliers navigation cycles kept every table at 20
rows, with no new console errors/warnings. Initial supplier loading plus those
cycles read about 62.5 MB of uncompressed fixture API bodies. Recorded heap peaked
near 60.8 MB and subsequently fell near 42.7 MB; this short run establishes
neither a leak nor absence of leaks. Capture: `.local/qa9-navigation-cycles.json`.

At 1,000 orders, Next, ten draft-search keystrokes, committed no-match search and
Clear left the order request count at one. Page 2 showed 21–40; no matches reset
to page 1; Clear restored the first 20. Maximum recorded event duration was 56 ms.
Supplier detail opened/closed correctly. At 10,000 products, the customer catalog
rendered 12 cards on desktop and phone, without document overflow; its native
category popup opened and closed. Dashboard previews remained bounded. Page,
console and unhandled-rejection counters were zero in the selected clean samples.

The live development catalog was separately checked with the existing customer
test account: 44 real local records, 12 rendered cards, visible photographs
loading, no page overflow, and no new console warnings/errors. Large-fixture
image placeholders do not prove external-image performance. Screenshots are in
ignored `artifacts/qa/`; raw captures remain in ignored `.local/`.

Priority 1: complete-array transfer grows with history size even when only 20
rows are rendered. This is confirmed by the browser data and tracked in
[issue #14](https://github.com/JunaidAhamed-7777/StockFlow/issues/14). Server paging
and summary projections require an explicitly authorized backend contract.

Lower-priority profiling candidates are repeated discovery reads on committed
catalog searches and supplier SKU-count scans during rerenders. The clean typing
sample does not establish a user-visible defect. No speculative production
optimization or cache with uncertain freshness was introduced.

For future runs on this same fixture/browser setup, proposed regression signals
are 1.5 seconds sampled list readiness, 100 ms maximum event duration during the
repeat typing/paging task, and 2 MB API transfer per fresh list document. These
are proposed local budgets with headroom over the repeat samples, not product
SLAs. The first **tested** payload-budget breach is 10,000 records for both list
types; no exact intervening boundary or device-independent timing limit was
established. Physical mobile, slow-network, cross-engine and longer memory-soak
coverage remain open work.

## Checks

TypeScript, production build, frontend lint, 22 client tests, seven harness tests
and the strict frontend ownership audit passed. The harness tests cover loopback
and origin boundaries, traversal, write rejection, fixture filters/totals,
redacted bounded reports, asset cache policy and stale-generation rejection.
No database records, workflow activation, notifications or paid model sessions
were changed by this issue.
