# Controlled local notification migration · issue #16

Verified on 16 October 2026 (Asia/Kolkata) against the existing local n8n 2.43.6
instance, using regular execution mode, single-main deployment and
`useWorkflowPublicationService: true`. The controlled apply exited **0** and
completed post-restart graph, state, publication and activation checks.

## Applied scope and policy

The five installed notification workflows now use the reviewed templates.
Delivery remains enabled only for `StockFlowCritical01`; the other four remain
scheduled previews. The existing confirmed Discord webhook and credential
reference `StockFlowDiscord01` were retained. Activation validated the prior
confirmation marker against that exact credential's webhook fingerprint.

The migration initiated zero workflow executions, recipient calls or model
calls. No connection-test post, new destination, credential replacement or
stock/order write was performed. Native role agents were outside the
five-workflow update scope.

Before/after preservation results are recorded below; scheduled production
activity continued during the elapsed migration period.

## Safety changes in source

The updater and maintenance helper provide the guarded migration path, including
the publication-service checks and staging changes in `a43828f`, `c4ef7d0` and
`1cae5d0`:

- An exclusive, token-owned apply lock prevents two updater runs interleaving
  exports, publication, restart or status writes. Unresolved locks remain for
  inspection. Dry runs do not construct owner-authenticated maintenance.
- Before quiescing, save the original complete workflow export to a private
  backup. Require all five known installed notification IDs, reviewed execution
  settings, unambiguous existing API/Discord bindings and empty pinned inputs.
- Validate all five stored versions before removing any schedule, then recheck
  each version immediately before deactivation. Remove only those five schedules
  and wait for their existing nonterminal executions to finish naturally.
- Export again after draining. This fresh state supplies cooldowns, order
  baselines, credential bindings and preserved settings, including the benign
  n8n `availableInMCP: false` default. Unexpected changes stop before import.
- Import all five reviewed definitions and verify their graphs and preserved
  state while unpublished, before publishing any. Publication reconciliation may
  resume schedules before restart; no further imports follow the first publish.
  Record that phase as unverified, publish reviewed definitions, then
  restart n8n and wait for `/healthz/readiness`. Re-export and verify the five
  graphs, settings, pinned data, static data and published versions after restart;
  check published active IDs and activation errors without executing workflows.
- In publication-service mode, require exactly three activated trigger node IDs
  per workflow: `schedule`, `manual-check` and `send-discord-notification`.
  The third entry comes from the native Discord v2 webhook definition. Trigger
  registration is activation metadata; it does not establish a sent message or
  a manual workflow execution. This exact set is checked in `1cae5d0`.
- Persist an unverified status before restart. Only completed verification can
  produce an enabled status. Failures after workflow writes attempt to unpublish
  and drain the five schedules again, leaving a paused or explicitly unverified
  status. No old definitions or state are restored automatically.

The exact static-data comparisons after publication are deliberately
conservative. If a resumed scheduled execution changes cooldowns or baselines,
verification fails closed and leaves the fresh state for inspection; it does
not overwrite that state with the pre-publication snapshot. Deferred restart
records a published, unverified state and does not promise schedules stay paused.

The restart is necessary because n8n CLI publication changes database state;
running single-main cron listeners can outlive an import. The separate readiness
endpoint checks database/startup readiness rather than liveness alone.
See [n8n CLI behavior](https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line.md)
and the [2.43.6 health implementation](https://raw.githubusercontent.com/n8n-io/n8n/n8n@2.43.6/packages/cli/src/abstract-server.ts).

## Controlled command

Executed from the repository root:

```powershell
node automations/update-local.mjs --apply --enable-low-stock --discord-credential-id=StockFlowDiscord01
```

The historical `--enable-low-stock` flag enables the critical-stock workflow
only. An ordinary `--apply` disables delivery in all five templates. Do not use
`--defer-restart` for live activation.

Do not run `verify-local.mjs` against this live policy: that verifier deliberately
requires all five installed graphs to have delivery disabled before it executes
any previews. Post-migration evidence here must use read-only inspection.

## Offline verification completed

```powershell
node --test automations/update-local.test.mjs automations/verify-local.test.mjs automations/notification-maintenance.test.mjs
```

**50/50 tests passed**: updater 21, preview verifier 17 and maintenance helper 12.
These use injected runtime, authentication and transport boundaries. They cover
version checks, exact five-workflow scope, drain completion/timeout, partial
deactivation, fresh-state preservation, unrelated workflow preservation,
critical-only activation, exact-webhook confirmation, restart verification,
failure status, redaction and concurrent updater exclusion. These fixtures
complement the actual runtime evidence below.

## Controlled live results

The final status is `complete`, with `schedulesPaused: false`,
`deliveryVerified: true`, `restartPending: false`, only `StockFlowCritical01`
enabled and `openAiCalls: 0`. Read-only activation verification at
`2026-10-15T20:39:36.209Z` reported all five active and zero activation errors.
Each workflow had the exact three activated trigger IDs above, no pending
version and a live version matching its current published version. The preview
verifier correctly refused the live critical graph before any execution.

- All five managed workflows matched their reviewed graphs and expected enabled
  flags. Static data, cooldowns, order baselines, settings, pinned data and API/
  Discord bindings were preserved. Published graphs matched current versions;
  all schedules retained `Asia/Kolkata`.
- All nine workflows remained present: the five managed definitions changed,
  while the four unrelated workflows were identical. All six encrypted
  credential hashes were identical.
- Hashes and counts of all seven application tables were unchanged: 12 users,
  five suppliers, two categories, 44 products, two orders, two order items and
  five stock transactions. Configuration, secrets and container identities were
  unchanged. The n8n process changed as expected for the required restart.
- All three native role-agent configurations remained valid, runnable and
  published at their current versions, with one managed task each. Recorded
  historical spend remained unchanged at $0.0024355 / $0.0013128 / $0.00264525.
- Browser review after reload showed all five updated notifications published,
  nine total workflows, three unchanged context tools and the inactive manual
  connection-test workflow. Screenshot:
  `artifacts/qa/notification-migration-published.jpg`.

Historical scheduled production execution count increased from 59 to 71 during
the elapsed period. Those executions are not QA-triggered manual runs. This
migration verifies installation, activation and preservation; it does not claim
a new connection test or recipient-delivery test.

Ignored private evidence: `.local/qa16-after.json`,
`.local/qa16-activation.json`, `.local/qa12-installed.json`, the publication
checks and native role-agent configuration diagnostics. Workflow exports,
credentials, account values, webhook fingerprints and raw execution data remain
outside this committed report.
