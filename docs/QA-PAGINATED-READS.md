# Bounded-read preparation · issue #14

Prepared on 16 October 2026 on Windows. The implementation contract is in
`PAGINATED-READ-CONTRACT.md`. Server changes and the application migration remain
pending explicit authorization under AGENTS.md. No production list service has
switched to paged reads, so the measured complete-array transfer limit remains.

The shared client primitives validate an exact page envelope, preserve page-two
rows without slicing again, include committed filters/page/size in request
identity, and guard URL clamping against stale loads and newer navigation.
Nine focused tests cover successful, empty, malformed and stale responses plus
independent pagers. All 31 client tests, TypeScript, lint and the production build
pass. These primitives remain unused by application screens until the server
contract is implemented.

Synthetic fixtures expose explicit paged product/order reads, compact rows,
complete scoped summaries and bounded directory views while retaining legacy
no-page list responses. The proposed safe order-detail helper has separate scope
tests; default browser fixtures retain the current detail response until the
mixed-supplier UI guard is migrated with it. Fixture calculations intentionally
run over in-memory synthetic arrays; they establish behavior, not database cost.

The browser displayed product page two for a 10,000-product fixture: exactly 20
rows, IDs 21–40, total 10,000 and 500 pages. This was the fixture JSON response,
not a migrated production screen. The real customer catalog still displayed
44 products and its existing page-two range of 13–24. A subsequent sign-in check
exposed a stopped Docker engine; starting Docker Desktop and the retained local
runtime restored PostgreSQL, n8n and customer sign-in without resetting data.

`node scripts/qa-paged-api.mjs --plan` describes the separate disposable
PostgreSQL/API integration runner without provisioning anything. Its explicit
`--run-isolated` mode is reserved for the authorized backend implementation.
It uses a unique container identity, private loopback ports, synthetic accounts,
and ownership checks before cleanup. Its offline tests do not establish that
the paginated backend works. No real integration result or application-level
transfer reduction is claimed here.

Remaining completion evidence: authorized server implementation, complete
frontend consumer migration, isolated PostgreSQL/API integration, and production
browser checks for all roles, filters, reload/Back, detail return, separate stock
pagers, complete metrics, cart detail IDs and recovery states. Keep #14 open
until those checks pass.
