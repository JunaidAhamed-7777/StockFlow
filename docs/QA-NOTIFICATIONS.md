# Notification rules and delivery-state QA · issue #12

Verified on 15–16 October 2026 (Asia/Kolkata) using in-memory/temp-directory fixtures,
read-only inspection of local n8n and browser review. QA initiated zero recipient
contacts and zero model calls. Current live critical alerts were not disabled,
manually executed, reconfigured or restarted to run a preview verifier.

## Defects reproduced and fixed

- Duplicate supplier IDs with different addresses produced two posts for one
  stock event; duplicate product IDs shared event keys. Stock/digest/stale
  planners now require strict unique numeric identities and resolved ownership.
- Stale-order planning accepted missing IDs and negative line quantities and
  trusted nested SKU labels. It now validates order IDs/dates/status text and
  lines, derives ownership/labels from the catalog and preserves both existing
  order/line identifier aliases. Customer details and other owners' lines stay
  outside the post. Order updates reject unresolved ownership before baseline.
- Generated acknowledgement code accepted all-zero or out-of-range message IDs.
  Every template now uses the same positive unsigned-64-bit snowflake constraint
  as connection confirmation. Invalid responses leave each owner's events due.
- Preview verification could report success for an unfinished/error envelope,
  incorrect final node or nonliteral disabled flag. It now requires a completed
  safe preview, refuses delivery-path/unknown run artifacts, stops on failure and
  emits a generic redacted failure for thrown subprocess errors.
- The updater is import-safe and injectable for isolated migration tests. It
  validates exactly five known disabled source templates and credential IDs,
  preserves delivery markers/baselines, and verifies stored executable behavior,
  pinned data, publication and static data before reporting success. Private
  source/transport failures are redacted.

The first three new routing/input regression tests failed against the original
planner and passed after the fix. Regenerated tracked JSON contains the reviewed
source code and still defaults to disabled delivery. The live installation has
not received these source changes; controlled deployment is tracked in #16.

## Reproducible fixture coverage

`node --test "automations/*.test.mjs"` passes all 169 tests at this issue's
completion, including 13 updater and 17 preview-verifier cases. Relevant suites cover:

- `notification-rules` and `notification-validation`: individual critical/odd/zero
  thresholds; exact 24-hour successful-delivery cooldown; one zero escalation;
  rearming above the cutoff versus partial refill; independent owners; UTC digest
  day boundary; exact 48-hour stale-order boundary, valid statuses and aliases;
  malformed/ambiguous inputs and non-mutating planning.
- `maintenance-rules`: quiet healthy audit, malformed inventory findings, Monday
  boundary in Asia/Kolkata, initial/empty order baselines without historical
  posts, retries and status reversions, 50-change batches with deferred events,
  supplier-only labels/lines and isolated successful-owner acknowledgement.
- `discord-message`, `discord-config` and `configure-discord`: strict destination
  and attribution, mention/Markdown/angle/control neutralization, capped 2,000
  characters with explicit omission notice, no TTS/link previews, exact-webhook
  confirmation markers and changed-destination guards. Fixtures contact no one.
- `workflow-structure`: all five exact schedules/timezones, compiled embedded
  code, validation before incident cleanup, owner item linkage and valid message
  acknowledgement. Failed or impossible responses acknowledge no events.
- `verify-local`: all-five preflight before any execution and immediate recheck,
  enabled/altered/pinned graphs rejected, only safe UI/credential-reference
  differences accepted, strict preview envelopes and redacted reports.
- `update-local`: isolated ordinary apply returns every workflow to disabled
  delivery while retaining existing cooldowns/baselines and API bindings;
  guarded critical-only activation requires exact confirmed credentials;
  deferred restart, failure and stored-definition verification are exercised
  with injected Docker/HTTP fixtures. No actual import/restart is performed.

## Actual local inspection and browser evidence

Before changing source templates, a read-only installed export matched all five
reviewed executable graphs after accounting for the one expected live flag:
critical stock enabled, other four disabled. All five were published, bound to
the encrypted Discord credential and set to Asia/Kolkata. The comparison cloned
and normalized data in memory only; it imported/executed nothing. Private results
are in `.local/qa12-installed.json`.

The browser opened the published critical-stock graph and showed the planner →
delivery guard → message preparation → transport → acknowledgement path, with a
separate Preview only branch. Its execution-history view was empty under the
existing execution-retention policy; that is not evidence that no scheduled run
ever occurred. Local screenshot: `artifacts/qa/notification-installed-graph.jpg`.

The revised pure planners also accepted the actual existing public API catalog:
44 products across five suppliers. Disabled stock planning produced one owner
group; disabled digest planning produced five; the inventory audit found zero
issues and stayed silent. This read-only compatibility sample did not execute
n8n or deliver those planned posts. Order boundaries use controlled fixtures.

## Practical limits

The daily digest intentionally deduplicates by UTC date while its schedule runs
at 09:00 Asia/Kolkata. Weekly audit boundaries use Monday in Asia/Kolkata.
Published successful n8n executions persist static state; manual editor runs do
not establish durable cooldowns. The QA tests simulate those state transitions
without invoking the installed live workflow.

Delivery is not exactly once. An uncertain network result after acceptance,
overlapping executions or an update racing an active run can still duplicate a
post or lose a state update. A failed multi-workflow update can leave a partial
import; retain its private backup and inspect stored/published state before
retrying. Polling can miss intermediate order statuses. A
transactional outbox would require separately authorized backend work. No API,
schema, authentication, destination or live activation change was made here.
