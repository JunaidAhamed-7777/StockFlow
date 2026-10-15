# StockFlow email routing

## Current policy

**Every StockFlow Gmail workflow targets only `junuhammad2@gmail.com`.** This covers critical stock alerts, daily digests, stale-order follow-ups, weekly inventory audits, and new/changed-order alerts. There are no CC or BCC recipients.

Gmail OAuth is not connected yet. Tracked templates have `mailEnabled: false`, so installing or publishing them does not authorize live mail. With a connected credential, the local updater can enable only critical stock alerts; the other four remain previews. See [setup and activation instructions](./README.md).

## Who each email was intended for

Supplier messages use the owner's name/email from `supplier.user` in StockFlow's existing directory. The weekly data audit is intended for the StockFlow administrator, using Settings value `auditRecipientEmail` (the local demo default is `admin.test@stockflow.local`). Audit findings also identify affected suppliers.

Every redirected subject starts with **`[REDIRECTED]`**. These visible lines appear at the top of the plain-text body:

```text
REDIRECTED STOCKFLOW EMAIL — owner delivery is disabled.
Intended stock owner: Demo Owner
Intended owner email: owner@stockflow.test
Supplier ID: 1
Actual testing destination: junuhammad2@gmail.com
This email was redirected for testing. The intended owner was not emailed.
```

For an audit, these lines identify the administrator and supplier ID `0`, an attribution marker rather than a supplier account. The original address is explanatory content, not a recipient. Supplier messages contain only that supplier's relevant inventory/order lines; the administrator audit covers catalog-wide issues.

Reserved demo addresses such as `.test`/`.local` can appear as intended-recipient attribution in redirect mode. Invalid email syntax, recipient lists, and header-injection strings are rejected. Outside redirect mode, reserved addresses are rejected by the shared formatter. The actual redirect destination must be one valid deliverable address.

## Routing is enforced twice

1. The planner creates a notification with `deliveryMode: 'redirect'`, `to: 'junuhammad2@gmail.com'`, and `intendedRecipient` containing the original name, email, and supplier ID. Delivery requires boolean `mailEnabled: true`; strings such as `'true'` do not enable it.
2. The delivery guard requires a notification, enabled delivery, redirect mode, the exact destination, and intended-recipient metadata. The Gmail node itself uses literal `sendTo: 'junuhammad2@gmail.com'`; destinations never come from product/order/owner data or incoming item fields.

Changing only `redirectTo` or `deliveryMode` in Settings cannot enable delivery elsewhere: the guard rejects a mismatch, and Gmail's transport remains fixed. Gmail nodes have no CC, BCC, or Sender Name. Sender Name is unset because it would require a Gmail profile lookup beyond the send-only scope.

## Authorization and delivery state

The Gmail sender is the Google account that completes OAuth in n8n. Receiving at the fixed mailbox and authorizing a sender are separate steps. Use a **Gmail OAuth2 API** credential with **Custom Scopes** enabled and only `https://www.googleapis.com/auth/gmail.send`. Client details without completed Google consent do not authorize sending.

Credentials/tokens belong in n8n's encrypted credential store and are excluded from tracked workflows and this documentation. Workflows do not use OpenAI.

`node automations/update-local.mjs` previews proposed changes. `--apply` publishes all five templates with delivery disabled, preserving cooldowns/baselines. `--apply --enable-low-stock --gmail-credential-id=CONNECTED_CREDENTIAL_ID` validates the connected send-only credential and enables only critical alerts. A later ordinary `--apply` disables them again. `--defer-restart` prepares previews during OAuth setup but cannot accompany live activation.

Successful delivery is remembered only when Gmail returns a message ID. Failures remain eligible for retry. Redirection changes the delivery destination; each intended owner's cooldown remains separate. Audit/order-change deduplication likewise retains its original event keys. Manual editor runs do not persist static data; published schedules retain delivery markers.

Offline routing/workflow tests verify the fixed transport, rejected destination changes, intended-recipient attribution, preview defaults, and failure retries without sending mail.
