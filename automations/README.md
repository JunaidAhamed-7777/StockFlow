# Local n8n automations

StockFlow uses the existing API and a local Docker n8n instance. These workflows use deterministic inventory rules and make **zero OpenAI calls**. The root OpenAI key is not copied into the browser, n8n, or workflow exports.

## Current installation

Three workflows are installed and published on `http://localhost:5678`:

- **StockFlow · Critical stock owner alerts** (`StockFlowCritical01`): every 15 minutes. A product is critical at zero stock or when quantity is at most `floor(lowStockThreshold × 0.5)`. This uses each product's threshold, rather than the products endpoint's fixed low-stock filter.
- **StockFlow · Daily inventory owner digest** (`StockFlowDigest01`): daily at 09:00 Asia/Kolkata. Includes totals and items at or below their reorder threshold.
- **StockFlow · Open order follow-up** (`StockFlowOrders01`): daily at 10:00 Asia/Kolkata. Includes pending/processing orders at least 48 hours old, showing only that supplier's own lines.

**Delivery is disabled in the Settings node (`mailEnabled: false`).** All three published workflows currently run previews. No Gmail credential exists in this n8n instance. The n8n owner password authorizes the local n8n editor; it does not authorize Gmail. Real mail delivery cannot be completed without a Gmail OAuth connection.

`npm run dev` starts the existing n8n container whenever it is stopped, along with the app. Docker Desktop must be running. No n8n Cloud account is required. The app and n8n must stay running for scheduled work to execute; a sleeping or powered-off computer cannot run checks.

## Connect Gmail when the Google account is available

1. In your Google Cloud project, enable the Gmail API and configure an OAuth consent screen. For an app in Testing, add the intended sender as a test user.
2. Create a Web application OAuth client using the exact callback URL displayed in the n8n credential editor, normally `http://localhost:5678/rest/oauth2-credential/callback` for this setup.
3. In n8n, create a **Gmail OAuth2** credential, enter the client ID/secret, and sign in with the intended sending Google account. Secrets stay in n8n's encrypted credential store.
4. Select that credential in **Send owner Gmail** in each workflow. Review an execution in preview mode first. Verify stock-owner emails in supplier profiles; `.test`, `.local`, `.example`, `.invalid`, and example.com/org/net addresses are deliberately rejected.
5. Change `mailEnabled` to `true` in the relevant workflow's **Settings** Code node and publish. Start with critical alerts; the digest and follow-up workflows can be enabled independently.

Gmail setup follows [n8n's single-service Google OAuth instructions](https://docs.n8n.io/integrations/builtin/credentials/google/oauth-single-service/) and [Gmail node documentation](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/). No Google password or app password is included in these files.

## Delivery safeguards

- One text email per owner groups all newly due events. The source is `supplier.user.email` from the existing discovery API.
- Critical alerts and order reminders have a 24-hour successful-delivery cooldown. A transition to zero stock bypasses that cooldown once. Replenishment above the critical cutoff rearms a new incident.
- Daily digests are deduplicated by owner and UTC date; at the configured 09:00 IST schedule, this is one digest each local morning.
- Single-recipient validation rejects malformed addresses, header injection, reserved demo domains, and recipient lists. Product text is reduced to safe single lines. Other suppliers' quantities/order lines and customer personal data are not included.
- Gmail results are recorded only when Gmail returns a message ID. A failed owner remains due for the next scheduled run; confirmed successes for other owners are remembered.
- API failures and malformed inventory stop processing. A fresh one-hour JWT is obtained each run from an encrypted n8n Custom Auth credential; no bearer token is embedded in tracked files.
- Saved execution payloads and manual execution persistence are disabled to avoid storing the API login response/JWT. n8n still shows execution status. Manual editor execution can display transient data to the signed-in owner.

Cooldowns use [n8n workflow static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/), which persists after successful published executions. Manual editor tests do not persist it. Keep a single local n8n instance and avoid overlapping manual/live sends. This is not an exactly-once mail queue: an ambiguous network failure after Gmail accepts mail, or concurrent executions, can cause a duplicate. A transactional outbox and backend-scoped service identity would require future backend work.

## Rebuild, install, and verify

From the repository root, after starting the local app:

```powershell
node automations/build-workflows.mjs
node automations/install-local.mjs
node automations/verify-local.mjs
node --test automations/notification-rules.test.mjs
```

The installer verifies this API's JWT against the isolated runtime, creates a dedicated local automation account if missing, imports its password into an encrypted **StockFlow API login (local demo)** credential, and publishes missing workflows. It preserves existing workflow definitions and cooldown state on reruns; an imported-but-unpublished workflow is published without reimporting. Generated source JSON does not contain passwords or the OpenAI key.

The existing API only offers coarse roles. The automation account therefore needs `ADMIN` to read all orders; it is intended for the isolated demo, not an internet-facing production service. Its password is recorded in ignored `.local/LOGIN-ACCOUNTS.md` after `node scripts/write-login-doc.mjs`.

`verify-local.mjs` uses the supported n8n CLI with a separate task-runner broker port and keeps raw JWT-bearing output in memory. Its redacted result is saved in `.local/automation-verification.json`. It must finish at **Preview only**, with zero Gmail node calls and zero OpenAI calls. Rule tests also cover real-address synthetic fixtures so delivery logic is tested without contacting anyone.

The CLI process is an administrative tool for this local instance. See [n8n CLI documentation](https://docs.n8n.io/hosting/cli-commands/) for import/publish behavior.

## Other useful local workflows

The two additional workflows above are already implemented without an AI provider. Further optional uses include a scheduled CSV inventory snapshot, a weekly slow-moving SKU report from real transaction data, or a local API-health alert. Transaction-based reports need the existing backend's transaction-listing endpoint to be implemented first; no synthetic ledger or predictions are provided.
