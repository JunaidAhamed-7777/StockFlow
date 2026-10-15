# Demo setup and imagery QA · issue #10

Verified on 15 October 2026. Production frontend/backend source and the database
schema remain unchanged.

## Changes and regression checks

The seeder exports an inert, injectable operation so its write/failure paths can
run against isolated fixtures and temporary private files. Its CLI flags,
default loopback API and `.local/` paths remain the same. The implementation now:

- Refuses redirects instead of allowing a loopback request to follow another
  destination, and excludes untrusted response bodies from errors.
- Reuses the runtime/database ownership validators and checks the actual Docker
  container before optional supplier-profile bootstrap.
- Saves credentials before registration using private temporary files and
  same-directory atomic rename; retained passwords/roles are never reset.
- Serializes applies before reading credentials. A competing or stale lock is
  refused; only the owning run removes its lock, including on failure.

`node --test scripts/seed-demo-catalog.test.mjs` passes 12 cases: first creation,
zero-addition repeat, existing-record preservation, lost registration response,
partial product creation, missing metadata, concurrent apply, stale lock, runtime
and ownership boundaries, identity mismatch, missing categories and redirect
rejection. The real HTTP redirect fixture receives zero requests at its target.
Fixture first-write tests create eight users, four supplier rows and 40 products;
four suppliers each own ten products. These use in-memory API/Prisma adapters,
not a new PostgreSQL installation. Interrupted runs resume from saved credentials
and existing SKUs without resetting stock or passwords.

Two dedicated catalog tests validate fictional account roles/domains, unique
ownership/SKUs and exact agreement between all 44 image mappings and their source
metadata. Eight harness tests cover the isolated browser environment, including
a mapped-image failure fixture. Repeat with:

```powershell
node --test scripts/seed-demo-catalog.test.mjs scripts/demo-catalog.test.mjs scripts/qa-browser-server.test.mjs
node scripts/seed-demo-catalog.mjs
node scripts/sync-demo-photos.mjs --verify --check
```

The dry run performs no file writes, HTTP calls, Docker inspection or Prisma
loading. All 16 direct photograph URLs returned HTTP 200 with image content;
the 44-SKU manifest is current.

## Actual local rerun and preservation

The existing isolated runtime/container was verified before the live rerun.
Read-only inspection found 12 users, five suppliers, two categories, 44 products,
two orders, two order lines and five stock transactions. The eight demo accounts
match the intended names/roles; the four demo suppliers each own ten demo products;
there are four demo customers and no demo administrators.

Two actual `--apply --local-supplier-profiles` reruns both reported zero created
profiles and zero created products. Before/after fingerprints over complete,
ordered rows of all seven collections were identical after the first rerun,
including password hashes, roles, prices, quantities, orders and stock entries.
The second rerun exercised the added lock and left no lock file. No raw records,
passwords or tokens were put in the public evidence. Private summaries are in
`.local/qa10-before.json`, `.local/qa10-after.json` and
`.local/demo-seed-result.json`.

Fresh real PostgreSQL initialization was not repeated. First-write/interruption
coverage is explicitly fixture-based; actual PostgreSQL evidence covers the
already-populated rerun, owned-container checks and unchanged records.

## Browser verification

The live customer catalog was reloaded after seeding: 44 products, 12 cards,
12 loaded photographs, no document overflow and no new console warnings/errors.
The notebook detail loaded its actual image and displayed “Illustrative photo”
with a working photographer source link. Screenshot evidence is in ignored
`artifacts/qa/live-photo-credit.jpg` and `live-catalog-after-seed.jpg`.

An unmapped synthetic SKU showed the accessible placeholder. A mapped SKU was
then deliberately blocked by the isolated harness's external-image CSP; its
product detail recovered to “Product photograph unavailable” with the product's
accessible name. This is an intentional failure test, not a production image
outage. Screenshot: `artifacts/qa/photo-failure-fallback.jpg`.

To repeat that failure without changing the real catalog, start the production
fixture server described in [performance QA](QA-PERFORMANCE.md), POST
`{"photoFailure":true}` to `/__qa/config`, reload, sign in with the synthetic
customer and open product 1. The first fixture uses a mapped SKU while CSP blocks
external images; the remaining synthetic SKUs have no mapping. Reset the fixture
with `{"photoFailure":false}` and reload. No real API/database writes, notification
activation or paid model calls are involved in those browser checks.
