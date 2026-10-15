# Local lifecycle and recovery QA · issue #11

Verified on 15 October 2026 on the existing Windows/PowerShell workspace with
Node 26.8.1, npm 12.2.0 and Docker 29.8.2. No backend, schema or authentication
source changed. A genuinely clean-host installation remains tracked in #15;
fixture initialization is not presented as a fresh real PostgreSQL installation.
No macOS/Linux or first-install timing result is claimed.

## Fixes

- Require persistent volume or bind storage for n8n credentials; reject tmpfs or
  an unspecified mount type.
- Extract the unchanged CLI interface into an injectable lifecycle core.
- Acquire ownership before loading mutable runtime state; publish private
  runtime markers atomically. A failed marker replacement retains original bytes.
- Serialize stale-lock recovery with an exclusive guard; use process birth time
  to distinguish a reused PID and unique tokens to release only owned locks.
  Partial/legacy locks and orphaned guards require documented local inspection.
- Preflight both recorded application identities before stopping either. Clean
  up a newly launched child if inspection or publishing its marker fails.

## Real workspace and browser checks

The original launcher passed repeated start, status, stop and start. Repeated
start retained the same app PIDs. Stop left n8n healthy. A customer catalog search
while the API was stopped displayed **Service unavailable**, **Unable to load
this view** and a **Retry** button. After startup, Vite reloaded the page and the
existing signed-in session recovered; clearing the search restored the catalog.
The Retry button was not clicked because it disappeared on that automatic reload.

The new CLI then passed `npm run dev`, `npm run dev -- restart` and direct
`status` against the same actual process/container boundaries. The measured
restart command completed in 9.9 seconds; the earlier stopped-to-ready start
completed in 14.6 seconds. These are existing-workspace samples, not first-install
or sign-in timing guarantees.

After the final restart, status reported healthy, owned API/frontend processes
and healthy n8n. Exactly one listener PID served each app port (3001 and 5173).
Browser reload retained Customer Test's session, **Service connected**, 44
products, 12 visible loaded photographs and no horizontal overflow. No new
warning/error console entries appeared after that reload. The n8n browser
overview still listed all nine workflows. No workflow was executed through the UI.

Before/after ordered-row fingerprints matched for all seven collections:
12 users, 5 suppliers, 2 categories, 44 products, 2 orders, 2 order items and 5
stock transactions. Database/n8n container IDs, n8n start time, encryption config,
nine workflow definitions/activation values, six encrypted credential records,
database URL and JWT secret fingerprints also matched. n8n was not restarted.
Only application PIDs changed during restart. Raw values, credentials and account
files remain private under `.local/`; public evidence contains counts and results.

## Isolated regression matrix

`node --test scripts/local-runtime.test.mjs scripts/local-runtime-flow.test.mjs scripts/runtime-lock.test.mjs`
passes 33 cases. Temporary directories and injected process/Docker boundaries
exercise these paths without altering the real services:

- Empty first initialization pushes/seeds once; repeated start changes no IDs,
  secrets or files. Read-only status creates no fresh marker and ignores locks.
- Stop/restart touches only verified app processes; stopped verified containers
  resume by saved ID without volume replacement, schema push or reseeding.
- Unrelated app/database/n8n ports, reused app PIDs, remote/mismatched database
  targets, unknown volumes, and missing/replaced containers are refused.
  First setup can create its separate n8n container before discovering a busy
  database port; it still leaves that occupied service untouched and performs
  no database/volume/schema/application action.
- Docker unavailable, PostgreSQL unready/unknown table count, malformed/falsy
  runtime markers and a seed interruption retain data. A schema created before
  a failed seed is refused on retry instead of being reset or reseeded.
- Live/partial/legacy/unknown locks and guards are preserved; proven stale owners
  recover. Concurrent stale contenders have one winner. Release preserves foreign
  tokens; inspection failures release only the owned guard.
- Relative CLI script arguments validate at the actual entry boundary, while
  executable/PID/script mismatches remain rejected. Launch inspection and marker
  publication failures clean up only the newly verified child.

These are simulated failure contracts, not claims that real Docker was disabled,
live containers removed or a real PID recycled. Recovery guidance now matches
the lock and partial-initialization errors. Public screenshots are not committed;
local evidence includes `artifacts/qa/runtime-offline.jpg` and
`artifacts/qa/runtime-final-recovered.jpg`.
