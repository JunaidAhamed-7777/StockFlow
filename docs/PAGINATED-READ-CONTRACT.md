# Bounded product and order reads · issue #14

Status: concrete implementation proposal, 16 October 2026 (Asia/Kolkata).
The existing server remains unchanged pending explicit authorization for the
read-code changes below. This contract requires no schema migration, new route,
login change, business write or permission expansion.

## Compatibility and common page envelope

Existing callers that omit `page` keep the current complete-array response.
Seeders, notifications and native role tools must not silently receive page one.
New frontend services `listProductPage` and `listOrderPage` explicitly request a
page and reject missing/invalid metadata instead of treating it as an empty list.

An opted-in request uses `page=1&pageSize=20`. `page` is a positive safe integer;
`pageSize` is 1–100, defaults to 20, and requires `page`. Repeated, array/object,
non-finite and malformed query values return 400. IDs are positive PostgreSQL
32-bit integers. Searches are trimmed literal text of at most 200 characters.
Only declared filter/sort values are accepted. User input never selects SQL
identifiers, network destinations or account scope.

The response keeps the existing `{success: true, data: [...]}` shape and adds
`pagination` with `page`, `pageSize`, `total`, `pageCount`, `hasNext`, and
`hasPrevious`. `total` counts all authorized matching records, not returned rows.
An empty result has page 1, pageCount 1, total 0 and an empty array. Requests beyond
the last page return the last valid page. The URL is replaced with that returned
page only after the matching request succeeds.

Scope, filters, exact count, summary and page selection use the same database
snapshot and predicates. Sorts always include an ID tie-breaker. Offset paging
bounds response cost; very deep traversal can still warrant a later cursor API.

## Product pages

`GET /api/products?page=...` retains the public catalog boundary. A supplier
catalog filter is not authentication: products are already public. Supplier
workspace callers must resolve their own supplier profile and fail closed when
it is missing, rather than omitting the filter and broadening the workspace.

Filters: existing `search`, `category`, and `supplier`, plus explicit `stock`
values `low`, `critical`, `out`, or `in`. Low uses each product's own recorded
threshold, critical uses zero or `floor(threshold * 0.5)`, out means zero, and
in means quantity above its own threshold, matching the current In Stock badge.
The old unpaged `lowStock`/`lowStockThreshold` behavior remains compatible.
Paged calls reject mixing these legacy stock parameters with `stock`.

Sorts use `sortBy` (`id`, `name`, `sku`, `price`, or `quantity`) and `sortOrder`
(`asc` or `desc`); default ID ascending. Page rows contain numeric identity, name, SKU, price, quantity,
lowStockThreshold, categoryId and supplierId. Descriptions and owner contact
objects are omitted. Display text is bounded (name 256, SKU 128 characters), with
explicit `truncatedFields`; full values remain available through product detail.

The page `summary` describes all matching products: productCount, totalQuantity,
lowStockCount, criticalStockCount, outOfStockCount and inventoryValue. Aggregates
must be computed in the database, without fetching every product into Node.
Inventory cards use this summary, never the current page. A separate low-stock
pager retains its existing `lowPage` URL key.

## Order pages and detail ownership

`GET /api/orders?page=...` retains authentication and the current role boundary:
ADMIN sees all orders, CUSTOMER only its verified customer ID, and SUPPLIER only
orders containing its verified supplier's products. Missing supplier identity
fails closed. Caller query parameters cannot replace these predicates.

Filters: status from PENDING/PROCESSING/SHIPPED/DELIVERED/CANCELLED and literal
order-number substring (optional leading #), preserving the existing list search.
Admin/supplier search may additionally match
the existing permitted customer name/email. Scope precedes search/count/paging.
`sortBy` initially covers `createdAt`, `id` and `status`, with `sortOrder` of
`asc` or `desc`; default createdAt descending then ID descending. Supplier lists
cannot sort by another supplier's/global amount. ID text matching and literal
search escaping run in the database, without loading all IDs into Node.

Summary rows contain ID, customerId, status, createdAt, updatedAt,
visibleLineCount, visibleUnits, visibleAmount and amountScope. `amountScope` is
ORDER for admin/customer and SUPPLIER_ITEMS for suppliers. Supplier aggregates
include only its own lines; no global total is returned. Supplier rows also
include `hasOtherSuppliers`. No `orderItems` array or nested product is projected.
Existing permitted customer labels use only id/name/email with bounded text and
explicit truncation. No password/hash, address or arbitrary nested user object
may enter a read projection.

Line COUNT, units and supplier subtotal use one parameterized database aggregate
over authorized page order IDs. They must not transfer complete line arrays to
Node. The page summary provides `orderCount`, `statusCounts` (all five statuses),
`visibleLineCount`, `visibleUnits` and `visibleAmount` for the entire filtered
scope. Money calculations retain existing stored-price
semantics; this is not a financial-model/schema migration.

Full lines are fetched only when opening the existing `/api/orders/:id` detail.
That detail must use a public customer projection, supplier-only lines/subtotal,
and an independently computed `hasOtherSuppliers` flag. The UI cannot infer whole
order ownership from an already filtered/truncated line array. Its current guard
against a supplier updating mixed-supplier fulfillment remains in force. No
status transition, write authorization or stock-restoration behavior changes.

## Frontend migration and complete aggregates

Keep the existing Pagination component and visual design. Add remote metadata
paging that never slices a returned page again. Request identity includes filters,
requested page and page size; cancellation/stale-response guards prevent an old
response from erasing a newer page or filter. Committed filters reset page one;
refresh, Back and detail/form return preserve valid list state. Retry retains the
same request. Status changes refetch the filtered page and totals before clamping.

Migrate all current complete-array consumers deliberately:

- Admin/supplier/customer product and order lists use page services. Customer
  catalog retains 12 cards; management tables retain 20 rows.
- Inventory/stock use product summaries for complete totals and independently
  requested main/low-stock pages. Owned IDs from page one cannot scope another
  list or metric.
- Dashboards request only their existing 6/8-row previews and complete scoped
  metrics. They must not fetch all orders/catalog merely to slice a preview.
- Supplier-directory product counts use the paged existing discovery read with
  `includeProductCounts=true`, rather than loading every product in the browser.
  Discovery without page parameters retains its complete-array shape.
- The existing admin customer directory is derived from customers with orders.
  `GET /api/orders?view=customers&page=...` is a bounded ADMIN-only grouped view
  with `id`, `name`, `email`, `orderCount`, `totalSpending` and `lastOrderAt`.
  It groups all lifetime orders before applying customer name/email search,
  defaults to name ascending with ID as a tie-breaker, and rejects status filters,
  unpaged calls and other roles. Its page summary includes `customerCount` and
  `totalSpending`; the global dashboard customer metric stays distinct.
  This does not invent access to customers without orders or a new user route.
- Cart validation requests only its existing product detail IDs with bounded
  concurrency. Absence from page one must never mean a cart product is missing.
- Existing automation/native-tool complete reads retain their legacy shape and
  semantics until a separate controlled consumer migration.

## Reviewable implementation scope

The requested exception covers existing product/order controller/service reads,
small shared read-query/projection helpers, opt-in supplier discovery counts and
associated read tests. Existing detail projection changes only remove unrelated
data and retain explicit mixed-owner metadata. It does not cover Prisma schema,
authentication middleware, route rewrites, business mutations or new endpoints.

Frontend work covers centralized page adapters, shared remote list state,
existing list/inventory/dashboard/directory/cart consumers, and matching browser
fixtures. No new design system or screen-specific pagination is introduced.

## Verification required before completion

- Contract tests: strict queries/size limit, same-snapshot totals, deterministic
  ties, filter-before-page, empty/clamped pages, bounded labels, scoped line
  aggregates, public projections and exact legacy no-page compatibility.
- Real isolated PostgreSQL/API integration: mixed supplier/customer ownership,
  denied/unresolved identities, summaries without complete line transfer, count
  and payload invariance as total history grows. Existing retained data is not
  used for destructive setup.
- Production browser fixture at 44/1,000/10,000 records using the #9 procedure:
  page two/final/refresh/Back/detail return, committed filters/no matches/clear,
  both inventory pagers, global metrics, cart IDs beyond page one, order detail
  recovery, status-filter refresh and phone catalog. Test error/loading/empty
  states and console output.
- Compare product/order page bytes with the old 10,000-record observations
  (3,034,593 and 13,772,034 API bytes). New page response sizes must depend on
  requested page size and compact fields, not complete catalog/history volume.

Fixture browser results establish frontend behavior; they do not substitute for
the explicitly authorized real backend integration test.
