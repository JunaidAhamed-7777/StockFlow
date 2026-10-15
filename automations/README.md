# Local n8n automations

StockFlow uses its existing API and local Docker n8n to post inventory notifications to **one chosen Discord channel**. Gmail setup was canceled. These deterministic workflows make **zero OpenAI calls**; no OpenAI key, Google OAuth, bot application, or n8n Cloud subscription is needed.

Three additional [native role agents](ROLE-AGENTS.md) use GPT-5 mini for scheduled account reviews and grounded drafts. Their OpenAI credential and costs are separate from these free notification rules. The existing administrator agent is repaired, and supplier/customer agents are published with fixed account scopes and budget guardrails.

**Local status verified on 15 October 2026: one labeled Discord connection test succeeded, and critical-stock alerts are enabled.** The other four workflows remain previews. The webhook is stored in n8n's encrypted credentials; the temporary URL file was deleted. All five installed graphs, credential bindings, published states, and disabled/enabled settings were checked after the activation restart. Private results are in `.local/discord-live-verification.json`. See [DISCORD.md](./DISCORD.md) for setup and activation. [MAIL-ROUTING.md](./MAIL-ROUTING.md) retains its filename for existing links and documents notification routing.

## Workflows

All five templates use existing endpoints. Schedules use **Asia/Kolkata**:

- **StockFlow · Critical stock owner alerts** (`StockFlowCritical01`): every 15 minutes. Critical means zero stock or quantity at most `floor(lowStockThreshold × 0.5)`, using the product's own threshold.
- **StockFlow · Daily inventory owner digest** (`StockFlowDigest01`): daily at 09:00. Groups each owner's inventory totals and products at or below their reorder threshold.
- **StockFlow · Open order follow-up** (`StockFlowOrders01`): daily at 10:00. Flags pending or processing orders at least 48 hours old, including only the intended supplier's own lines in each post.
- **StockFlow · Weekly inventory data audit** (`StockFlowAudit01`): Mondays at 09:30. Reports missing names/SKUs, normalized SKU collisions, invalid stock/price values, and unresolved supplier/category references. It is intended for the StockFlow administrator and never modifies records.
- **StockFlow · New and changed order alerts** (`StockFlowUpdates01`): every 15 minutes. Establishes an initial baseline without posting historical orders, then reports new orders and observed status changes using each intended supplier's own lines. Polling can miss intermediate changes between checks.

Tracked templates use `deliveryMode: 'discord'` and `notificationsEnabled: false`. Publishing a schedule alone does not enable delivery. Initial activation enables **critical stock alerts only**; the other four remain previews.

`npm run dev` starts the existing n8n container when stopped, alongside the API and frontend. Docker Desktop, the app, and n8n must remain running; sleeping or powered-off computers cannot run checks.

## Install, migrate, and verify previews

From the repository root after starting the app:

```powershell
node automations/build-workflows.mjs
node automations/install-local.mjs
node automations/update-local.mjs
```

The installer provisions missing workflows and the encrypted local API login. Reruns preserve existing workflow definitions and delivery state. **Use the updater to migrate existing Gmail definitions or apply changed templates.** The updater defaults to a dry run and reports proposed changes without importing or publishing them.

Apply all five Discord templates with delivery disabled, then verify previews:

```powershell
node automations/update-local.mjs --apply
node automations/verify-local.mjs
node --test "automations/*.test.mjs"
```

An ordinary `--apply` restores **every workflow to `notificationsEnabled: false`**, preserving successful-delivery cooldowns and the initial order baseline. It retains the API credential binding, binds the selected Discord credential when available, saves a private backup in ignored `.local/n8n-backups/`, publishes the definitions, restarts n8n, and checks its health. A Discord credential is not required to install previews.

`--apply --defer-restart` stores preview definitions without restarting immediately and records `restartPending`. Running schedules may still use their previous definitions until the restart. It cannot be combined with live activation.

The preview verifier checks all five installed graphs before executing any and rechecks each immediately before its run. It refuses any enabled or changed executable workflow, including changes to the planner, sanitization, transport, delivery guard, pinned data, or routing. It allows the encrypted Discord credential reference and harmless UI changes. **Do not use it to test live delivery.** Return to previews with an ordinary `--apply` first.

The verifier keeps raw JWT-bearing CLI output in memory and writes only whitelisted results to ignored `.local/automation-verification.json`. A successful preview finishes at **Preview only**, with `notificationCalls: 0`, `gmailCalls: 0`, and `openAiCalls: 0`. Offline tests use synthetic fixtures and do not contact recipients.

## Test and enable Discord

The complete sequential setup is in [DISCORD.md](./DISCORD.md). After the webhook has been imported:

```powershell
node automations/configure-discord.mjs --test
node automations/configure-discord.mjs --enable-low-stock
```

`--test` sends one labeled fictional connection post through an inactive manual-only test workflow. It does not change stock or publish a schedule. A successful result must include a valid Discord message ID and channel ID. The private marker `.local/discord-connection-test.json` records confirmation and the webhook fingerprint, not the URL.

Activation requires that confirmed test for the **exact current webhook**. The helper uses the stored credential ID and invokes the guarded updater. The equivalent administrative command is:

```powershell
node automations/update-local.mjs --apply --enable-low-stock --discord-credential-id=StockFlowDiscord01
```

The credential ID is a reference, not a webhook URL or token. Activation validates the encrypted native Discord Webhook credential and the matching confirmation marker, then enables only `StockFlowCritical01`. The other four workflows remain previews. A normal `update-local.mjs --apply` disables delivery again.

Repeated or ambiguous connection-test attempts are blocked for the same webhook unless `--test --repeat` is deliberately requested. Inspect the channel and private marker first to avoid duplicate test posts. A changed or published connection-test draft is refused rather than overwritten. Live execution and connection status are available in [n8n](http://localhost:5678/home/workflows); the frontend displays definitions rather than live status.

## State, privacy, and delivery limits

- All posts go to the webhook's one configured channel. Every post names its intended owner or administrator and includes the recorded email and supplier ID. Supplier ID `0` identifies administrator attribution. The administrator audit intentionally covers issues across owners.
- **Everyone who can read that Discord channel can see its posted inventory and owner details.** StockFlow roles do not restrict Discord membership. Owner addresses are attribution only; these workflows send no owner email or direct messages.
- All ASCII at-signs in sent content become ` [at] `, and Markdown and angle brackets are escaped. This neutralizes mention syntax; it does not depend on a native `allowed_mentions` option. Exact owner addresses remain in n8n metadata. Link previews and TTS are disabled. Content is capped at 2,000 characters with an explicit truncation notice.
- Critical alerts and stale-order reminders use a 24-hour successful-delivery cooldown. A transition to zero stock bypasses it once; replenishment above the critical cutoff rearms a new incident. Cooldowns stay separate for each intended owner despite sharing a channel.
- Daily digests deduplicate by owner and UTC date; the 09:00 IST schedule produces one digest each local morning. Audits deduplicate by Monday-based week in Asia/Kolkata after confirmed delivery and stay quiet when no issues exist.
- Order updates establish a first valid baseline without historical notifications. Later statuses advance only after confirmed delivery. Up to 50 due changes are grouped per owner; further changes remain due for the next poll.
- The native Discord transport uses `wait: true`. Delivery markers are recorded only after it returns a valid Discord message ID. Errors and invalid responses remain retryable; a success for one owner does not acknowledge another owner's events.
- Invalid attribution, malformed stock data, or API failures stop notification planning. The data audit reports malformed inventory values it is designed to inspect. Supplier order posts exclude other suppliers' lines and customer personal data.
- Each run obtains a fresh API JWT through an encrypted n8n Custom Auth credential. Saved execution payloads and manual execution persistence are disabled. Manual editor execution can still display transient data to the signed-in n8n owner.

Cooldowns and baselines use [n8n workflow static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/), which persists after successful published executions. Manual editor tests do not persist it. Keep one local instance and avoid overlapping manual and scheduled sends. A network failure after Discord accepts a post, or concurrent executions, can still produce duplicates. A transactional outbox would require future backend work.

The existing API has coarse roles, so the local automation account needs `ADMIN` to read all orders. Its password and runtime details remain in ignored `.local/`; account logins are documented privately by `node scripts/write-login-doc.mjs`. Workflow exports contain no passwords, webhook URLs, or OpenAI keys. The backend and database schema are unchanged.

## Changing the destination channel

Before replacing a stored webhook with a different one, **unpublish every workflow that uses that credential**, including any published previews. Merely setting `notificationsEnabled: false` is insufficient. The configuration helper refuses a destination change while any such workflow is published.

When the destination changes and its workflow users are unpublished, the helper restarts n8n **before importing the new credential** to flush old in-memory schedules. Save the new URL in the private input file, import it, and confirm a new connection test before re-enabling critical alerts. The previous webhook's test fingerprint cannot authorize the new destination. Review the changed test draft in n8n if the helper refuses to replace it.

See the [Discord setup guide](./DISCORD.md), [notification-routing contract](./MAIL-ROUTING.md), and [n8n CLI reference](https://docs.n8n.io/hosting/cli-commands/).

The [notification QA report](../docs/QA-NOTIFICATIONS.md) records isolated rule,
preview and update-state checks, reproduced fixes and the distinction between
reviewed source templates and the current live installation.
