# Controlled local notification migration · issue #16

Status on 16 October 2026: **PENDING live migration**. Authenticated preflight
confirmed n8n 2.43.6, regular execution mode, single-main deployment and
`useWorkflowPublicationService: true`. The guard rejected that asynchronous
publication mode before workflow writes. Support for its outbox teardown and
activation protocol has since been added and tested offline; controlled live
verification remains pending. No successful application, post-restart
verification or new delivery result is claimed in this report.

## Scope and intended policy

Migrate the five installed notification workflows to the reviewed templates on
the existing local n8n 2.43.6 instance. Keep delivery enabled only for
`StockFlowCritical01`; the other four workflows remain scheduled previews.
Retain the existing confirmed Discord webhook through the credential reference
`StockFlowDiscord01`. The command must validate the prior confirmation marker
against that exact credential's webhook fingerprint.

This migration does not include a connection-test post, manual workflow
execution, model call, new destination, credential replacement or stock/order
write. Native role agents are outside the five-workflow update scope.

The controlled pre-migration inspection recorded nine workflows, six encrypted
credentials and seven application database collections. All five notification
workflows were published, with critical delivery alone enabled. The three
native role-agent configurations were separately valid and published; their
historical cost record was captured. These are before-state observations,
not evidence of preservation after migration.

## Safety changes in source

`6300ecd`, `7da2219` and `de21f76` add the guarded migration path:

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

From the repository root, after the runtime compatibility guard is resolved:

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
failure status, redaction and concurrent updater exclusion. They do not prove
that the current local runtime accepts the maintenance API contract.

## Live evidence still required

Verify the confirmed publication-service mode in the controlled runtime, then record the
controlled command result, restart readiness and activation checks. Compare the original
and post-migration workflow/credential fingerprints, cooldowns, baselines,
application collections and native role-agent configuration/cost snapshots.
Confirm only critical delivery remains enabled for the same confirmed webhook.

Keep workflow exports, credentials, account values, webhook fingerprints and
raw execution data in ignored private evidence. This report will be updated
only after the corresponding live results are available.
