# Bounded product and order reads · issue #14

Verified on 16 October 2026 on Windows, after explicit approval of the existing
server-read exception described in `PAGINATED-READ-CONTRACT.md`. Schema, routes,
authentication and business write behavior remain unchanged. Missing product
detail now returns 404 so cart validation can distinguish a deleted product.

## Implemented behavior

Explicit paged services replace every frontend complete product/order list read.
Catalog cards request 12 rows, tables 20, and dashboards six/eight-row previews.
Server pages use one repeatable database snapshot for filtering, exact totals,
complete summaries and deterministic page selection. Product/order text is
bounded; list orders omit line arrays. Supplier subtotals and line counts include
only owned products. Customer directories group lifetime orders before search;
supplier directories count products without downloading the catalog.

Legacy callers that omit page retain complete arrays, including automation and
native role tools. Existing order detail uses a public customer projection and
supplier-only lines/subtotal with an independent mixed-supplier flag. The UI
requires that flag to explicitly permit supplier status updates. After a write,
it refetches both the filtered list and verified detail instead of trusting the
legacy mutation response's projection. Cart validation fetches only its product
IDs, with at most four concurrent requests.

## Real PostgreSQL/API integration

`node scripts/qa-paged-api.mjs --run-isolated --evidence artifacts/qa/paged-api.json`
passed against a uniquely owned PostgreSQL 16 container and the actual API.
The unchanged datamodel was applied only to this disposable database. Synthetic
fixtures grow from 44 to 1,000 to 10,000 products/orders, include long descriptions,
bounded-label cases and a 1,000-line mixed-supplier order.

- Product 20-row response bodies: 3,798 / 3,809 / 3,817 bytes.
- Order 20-row response bodies: 6,392 / 6,421 / 6,450 bytes.
- The same 10,000-record fixture's unpaged bodies remain complete: 41,884,028
  product bytes and 49,498,954 order bytes. Its long descriptions/line fan-out
  differ from #9, so these are not substituted for #9's original observations.
- Passed strict/malformed/unknown query rejection, literal wildcard search,
  filter-before-page, deterministic ties, exact summaries, empty/clamped pages,
  customer/supplier ownership, unresolved supplier denial, scoped mixed-order
  details, safe customer fields, grouped customer totals and supplier counts.
- Final aligned run also verified fixture sequences for browser-created records;
  all successful runs reported owned-container cleanup true. Windows Prisma
  loading/seeding happens in child processes that exit before temporary cleanup.

The runner never imports retained environment files or uses retained runtime
credentials. Its Docker endpoint, exact container ID, unique label, tmpfs mount
and loopback binding are verified. Temporary client generation changes only a
separate generator output path. It performs no n8n, model or delivery action.

## Production browser checks against the real disposable API

`node scripts/qa-paged-browser.mjs --run-isolated` keeps that verified API alive
behind a same-origin loopback bridge serving the production build. CSP blocks
absolute API destinations; only existing application routes are proxied.
Synthetic sign-in values stay in a private temporary file. External fonts/images
are excluded from these data-processing checks, as in the #9 fixture.

Admin checks passed page two, reload, Back/Forward, product edit/detail return,
late-ID search, no results, clear and low-stock filtering. Inventory showed 20
rows per table while retaining all 10,000 products and 5,556 low-stock items.
Both pager keys survived reload; independently excessive pages clamped to page
500 and lowPage 278. Dashboards showed eight-row previews. Supplier counts were
5,000 each; customer lifetime totals remained 5,000 orders each even during
search, with the global customers-with-orders card still two.

An admin status update removed its order from the selected PENDING filter and
refreshed the empty list while keeping the successful modal detail. A temporary
product-only bridge outage showed ErrorState/Retry; Retry restored the page.

Supplier checks passed 20-row page two over 5,000 owned products, complete
2,778-item low-stock totals and independent stock pagers. Mixed order #1 showed
one owned line and a $4 subtotal, with status changes blocked. A wholly owned
order successfully advanced twice, retaining verified status controls after
each save. The last order page clamped correctly over 5,001 relevant orders.
A supplier account without a linked profile displayed the explicit blocked
workspace error rather than broadening catalog/stock requests.

Customer checks passed six-row dashboard previews, 12 catalog cards, page-two
detail return, and a settled 390 × 844 layout with zero document overflow. Cart
checkout validated product ID 9,997 directly and created synthetic order #10001;
no full catalog read occurred. Its order history/detail returned to page two.
Foreign customer order detail returned Forbidden, and Back recovered the owning
list. Current real local and disposable production sessions had no warning/error
console entries. Loading skeletons were observed during requests.

The retained local runtime was restarted to load the approved API changes.
Before/after fingerprints matched all seven collections, database/container
identities, n8n start/config, nine workflows, six encrypted credentials, database
URL and JWT secret. Only application PIDs changed. Browser writes above affected
only the disposable database.

## Repeated #9 production fixture

The original procedure was repeated with 40 suppliers, three lines per order,
fresh document navigation per sample, no throttling and uncompressed loopback
responses. Each product/order sample rendered 20 rows with zero document
overflow and no console errors. API transfer includes browser header overhead.

- 44 records: products 14,481 API transfer bytes, readiness 299.5 ms; orders
  7,499 bytes, readiness 235.3 ms.
- 1,000 records: products 14,495 bytes, readiness 224.2 ms; orders 7,519 bytes,
  readiness 233.5 ms.
- 10,000 records: products 14,503 bytes, readiness 226.1 ms; orders 7,530 bytes,
  readiness 239.9 ms. Original #9 values were 3,034,593 and 13,772,034 bytes:
  approximately 99.52% and 99.95% less transfer in these fixture samples.
- Supplier page two rendered 20 of 40 suppliers and correctly showed 250 SKUs
  each at 10,000 products, without downloading those products.

These are individual laboratory observations, not field latency or percentile
guarantees. Discovery dropdown arrays remain complete; database aggregate work
and very deep offset traversal can still warrant future optimization.

## Regression checks and local evidence

Client tests 43/43, all server service read tests 16/16, automation/script tests
274/274, TypeScript, frontend lint/build and the strict UI audit pass.

Ignored local evidence includes six `.local/qa14-{size}-{products|orders}.json`
captures, `artifacts/qa/paged-api-aligned.json`, preservation fingerprints and
screenshots `paged-order-filter-refresh.jpg`, `paged-products-outage.jpg`,
`paged-catalog-phone.jpg`, `paged-cart-late-id-order.jpg` and
`paged-supplier-directory.jpg`. No credentials or screenshot binaries are
committed. An earlier generated-client temp folder was preserved after automatic
approval review blocked recursive removal; subsequent runner cleanup succeeded.

