# Local n8n automations

StockFlow uses its existing API and a local Docker n8n instance. These workflows use deterministic rules and make **zero OpenAI calls**. The root OpenAI key is not copied into the browser, n8n, or workflow exports. No n8n Cloud account is required.

## Workflows and current delivery status

Five workflow templates are implemented. All schedules use **Asia/Kolkata**:

- **StockFlow · Critical stock owner alerts** (`StockFlowCritical01`): every 15 minutes. A product is critical at zero stock or when quantity is at most `floor(lowStockThreshold × 0.5)`, using each product's own threshold.
- **StockFlow · Daily inventory owner digest** (`StockFlowDigest01`): daily at 09:00. Includes owner-specific totals and products at or below their reorder threshold.
- **StockFlow · Open order follow-up** (`StockFlowOrders01`): daily at 10:00. Includes pending/processing orders at least 48 hours old, showing only that supplier's own lines.
- **StockFlow · Weekly inventory data audit** (`StockFlowAudit01`): Mondays at 09:30. Flags missing names/SKUs, normalized SKU collisions, invalid stock/price values, and unresolved supplier/category references. Its intended recipient is the StockFlow administrator. It never modifies records.
- **StockFlow · New and changed order alerts** (`StockFlowUpdates01`): every 15 minutes. Establishes a first-run baseline without mailing historical orders, then reports new orders/status changes using only each supplier's own lines. Polling can miss intermediate changes between checks.

**Gmail OAuth is not connected yet, and actual email delivery has not been enabled.** All five tracked templates use `mailEnabled: false`, `deliveryMode: 'redirect'`, and `redirectTo: 'junuhammad2@gmail.com'`. Installing or publishing a schedule does not grant Gmail authorization.

All five Gmail nodes also have their transport destination fixed to **junuhammad2@gmail.com**. Once enabled locally, mail is redirected there with its intended recipient clearly identified. No stock owner is emailed. See [MAIL-ROUTING.md](./MAIL-ROUTING.md) for the exact routing contract and examples.

`npm run dev` starts the existing n8n container whenever it is stopped, along with the API and frontend. Docker Desktop must be running. The app and n8n must stay running for schedules to execute; a sleeping or powered-off computer cannot run checks.

## Connect send-only Gmail OAuth

The n8n owner login authorizes the local editor; it does not authorize Gmail. Google Cloud client configuration and Google account consent are still required. Google Cloud setup is unreliable in this embedded browser: the project form eventually rendered, but project lists report **Error while loading resources**, recent projects fail to load, and notifications report **Error loading**. Complete these Google Cloud steps in a regular browser, then return to the local n8n credential form. A project named **StockFlow Local** (proposed ID `stockflow-local`) was submitted, but Google did not confirm its creation; check whether it exists before creating another project.

1. In a Google Cloud project, enable the **Gmail API** and configure the OAuth consent screen. Use appropriate app/contact details. For an External app in Testing, add the intended sending Google account as a test user.
2. Create an OAuth client with application type **Web application**. Register the exact redirect URI displayed by n8n: `http://localhost:5678/rest/oauth2-credential/callback` for this installation. Google permits this localhost callback; no tunnel or public n8n host is needed.
3. In local n8n, create a **Gmail OAuth2 API** credential and enter its client ID and client secret. Turn **Custom Scopes** on. Set **Enabled Scopes** to exactly `https://www.googleapis.com/auth/gmail.send`. Complete **Sign in with Google** using the intended sender, grant send permission, and save the connected credential.
4. Leave the Gmail node's **Sender Name** option unset: it triggers an extra profile request requiring broader access. Sending does not require permission to read, change, or delete mailbox messages.
5. Keep client secrets and OAuth tokens in n8n's encrypted credential store. Do not commit them, put them in documentation, or embed them in Code nodes. Saved client details without completed Google consent do not authorize sending.
6. Review redirected previews, run the one-message connection test below, then use the activation command with the connected credential's ID. It enables only critical stock alerts; the other four remain previews.

An External app with publishing status **Testing** receives refresh tokens that expire after **seven days**, including for `gmail.send`; reconnect when they expire. For ongoing personal use, Google documents a verification exemption for apps with fewer than 100 users. An appropriate **In production** personal-use configuration avoids the Testing-specific limit, but may still show an unverified-app warning and remains subject to Google's policies/user limits. Reconnect after changing publishing status. Publishing status is not OAuth verification and does not make tokens permanent: revocation, password changes involving Gmail scopes, inactivity, and token limits can still invalidate them.

References: [n8n Google OAuth and localhost setup](https://docs.n8n.io/integrations/builtin/credentials/google/oauth-single-service/), [Gmail node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2), and [personal-use verification exemption](https://support.google.com/cloud/answer/13464323?hl=en).

## Install, update, and verify

From the repository root, after starting the local app:

```powershell
node automations/build-workflows.mjs
node automations/install-local.mjs
node automations/update-local.mjs
```

The installer verifies this API's JWT against the isolated runtime, creates a dedicated local automation account if missing, imports its password into an encrypted **StockFlow API login (local demo)** credential, and publishes missing workflows. Reruns preserve existing definitions and delivery state; an imported-but-unpublished workflow is published without reimporting. **The installer does not upgrade existing definitions.** Use the updater to apply changed templates.

`update-local.mjs` defaults to a **dry run**: it rebuilds local templates and reports proposed changes without importing/publishing them. Apply all five templates in disabled-delivery preview mode with:

```powershell
node automations/update-local.mjs --apply
node automations/verify-local.mjs
node --test automations/notification-rules.test.mjs automations/maintenance-rules.test.mjs automations/workflow-structure.test.mjs automations/gmail-config.test.mjs automations/verify-local.test.mjs
```

`--apply` intentionally restores **all five workflows to `mailEnabled: false`**. It preserves static data, including successful-delivery cooldowns and the initial order baseline, and retains existing credential bindings. It saves a private backup under ignored `.local/n8n-backups/`, publishes the definitions, restarts n8n, and checks n8n health. Backups can contain operational state; keep them private.

While a Google OAuth form is open, prepare preview definitions without interrupting it:

```powershell
node automations/update-local.mjs --apply --defer-restart
```

This records `restartPending`. Runtime schedules may use previous definitions until n8n restarts. Complete the OAuth form first, then restart n8n and verify previews. Deferred restart cannot be combined with live activation.

After completing OAuth, review and send one explicitly labeled connection test:

```powershell
node automations/test-gmail-local.mjs
node automations/test-gmail-local.mjs --send --gmail-credential-id=CONNECTED_CREDENTIAL_ID
```

The first command only prints the message for review and makes no credential reads or n8n changes. The second validates the connected send-only credential and sends one **CONNECTION TEST** to the fixed redirect mailbox. It includes fictional Supplier Test attribution and makes no inventory claim. It imports and retains the inactive, manual-only draft `StockFlowGmailTest01`; it never publishes a schedule, changes stock, or calls OpenAI. Before execution it rechecks the exact draft graph, including the Gmail destination and absence of CC/BCC, Sender Name, or retries. The CLI's deprecated `--file` option is no longer supported in the installed n8n version, so this uses import plus `execute --id`.

Only confirmed success and the Gmail message ID are printed. Per-credential attempt markers are stored in ignored `.local/gmail-connection-tests/`. Confirmed or ambiguous attempts block another send unless `--repeat` is deliberately supplied; inspect the mailbox/marker first to avoid duplicate tests. An interrupted-process lock also blocks sends until inspected. If the retained draft was changed or points to a different credential, the helper refuses to overwrite it; review/remove that inactive test draft in n8n before using a different credential.

After a confirmed test and reviewing previews, enable **only critical stock alerts**:

```powershell
node automations/update-local.mjs --apply --enable-low-stock --gmail-credential-id=CONNECTED_CREDENTIAL_ID
```

Replace `CONNECTED_CREDENTIAL_ID` with the local n8n credential ID, not a secret/token. The updater checks a Gmail OAuth2 credential, exactly the configured `gmail.send` scope, and nonempty OAuth access/refresh tokens. Returned scopes, when present, may contain `gmail.send` and basic Google identity scopes only. This checks stored authorization data; a successful Gmail call is the end-to-end proof Google accepts the grant. The other four workflows remain previews. Activation includes a restart; `--defer-restart` is rejected with `--enable-low-stock`.

The verifier **refuses to run if any installed executable workflow differs from its disabled-delivery source**, including enabled low-stock mail. Do not use it for live-mail testing. To return to previews, run `update-local.mjs --apply` first; that disables low-stock mail while retaining cooldown state.

`verify-local.mjs` uses the supported n8n CLI with a separate task-runner broker port. It checks all installed definitions before executing any, keeps raw JWT-bearing output in memory, and saves only a redacted result in ignored `.local/automation-verification.json`. A successful preview finishes at **Preview only**, with zero Gmail calls and zero OpenAI calls. Offline tests use synthetic fixtures and never contact recipients.

Generated JSON contains no passwords, OAuth tokens/client secrets, or OpenAI keys. The existing API has coarse roles, so the automation account needs `ADMIN` to read all orders; it is intended for the isolated local demo. Its password remains in ignored `.local/LOGIN-ACCOUNTS.md`, generated by `node scripts/write-login-doc.mjs`.

The CLI is an administrative tool. See [n8n CLI documentation](https://docs.n8n.io/hosting/cli-commands/) for import/publishing behavior.

## State, privacy, and delivery limits

- Owner alerts/digests group due events into one text email per owner. The intended address comes from `supplier.user.email` in the existing discovery API. The administrator audit intentionally reviews cross-owner data issues and identifies affected owners.
- Critical stock alerts and stale-order reminders have a 24-hour successful-delivery cooldown. A transition to zero stock bypasses it once. Replenishment above the critical cutoff rearms a new incident.
- Daily digests deduplicate by owner and UTC date; 09:00 IST produces one digest each local morning. Audits deduplicate by Monday-based week in Asia/Kolkata after confirmed delivery, and stay quiet if no issues are found.
- Order updates establish a baseline without historical mail. Later statuses are acknowledged only after Gmail returns a message ID. Up to 50 changes are grouped per owner; further due changes are considered on the next poll.
- Malformed addresses, recipient lists, header injection, and invalid redirect destinations fail closed. Reserved demo owner addresses are permitted as attribution **only in redirect mode**. Product text is reduced to safe single lines. Supplier notifications exclude other suppliers' order lines and customer personal data.
- Gmail results are remembered only when Gmail returns a message ID. Failures remain due for retry; other owners' confirmed successes are remembered. API failures and invalid notification data stop processing; the audit instead reports the invalid inventory values it was designed to inspect.
- A fresh one-hour API JWT is obtained each run from an encrypted n8n Custom Auth credential. Saved execution payloads/manual execution persistence are disabled. n8n still shows execution status; manual editor execution can display transient data to the signed-in owner.

Cooldowns/baselines use [n8n workflow static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/), which persists after successful published executions. Manual editor tests do not persist it. Keep one local instance and avoid overlapping manual/live sends. An ambiguous network failure after Gmail accepts mail, or concurrent executions, can cause duplicates. A transactional outbox and backend-scoped service identity would require future backend work.

## Further free local automation ideas

The weekly audit and new/changed-order alerts are implemented using existing endpoints with no AI provider. Further possibilities include a scheduled CSV inventory snapshot or API-health check. A slow-moving-SKU report would require the existing backend's transaction-listing endpoint first; this integration does not invent transaction history or predictions. Future Gmail workflows should retain the same fixed redirect until owner delivery is explicitly implemented and authorized.
