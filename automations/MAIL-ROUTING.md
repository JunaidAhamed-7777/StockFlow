# StockFlow notification routing

This file retains its historical name for existing links. **Gmail setup was canceled. All five current workflows use one chosen Discord channel.** They send no owner email or direct messages. See [DISCORD.md](./DISCORD.md) for webhook setup and [README.md](./README.md) for workflow behavior.

The webhook is stored in n8n's encrypted credential store; its private import file was deleted after verification. One labeled connection post was confirmed on 15 October 2026, and the local critical-stock workflow is enabled. The other four remain previews. Tracked templates always use `notificationsEnabled: false`; local activation is verified separately in ignored runtime reports.

## Intended recipients and actual destination

Each supplier post uses the owner's name and recorded email from `supplier.user` in the existing directory. The weekly audit is intended for the StockFlow administrator, using `auditRecipientEmail` in Settings (default `admin.test@stockflow.local`). Its findings also identify affected suppliers.

Notification metadata retains the exact intended recipient:

```json
{
  "deliveryMode": "discord",
  "to": "discord-channel",
  "intendedRecipient": {
    "supplierId": 1,
    "name": "Demo Owner",
    "email": "owner@stockflow.test"
  }
}
```

`discord-channel` is a logical marker, not an address or URL. The encrypted webhook credential alone determines the channel. At the top of each delivered post, human-readable attribution appears as:

```text
[TEST ROUTE] SINGLE DISCORD TEST CHANNEL
Intended stock owner: Demo Owner
Intended owner email: owner [at] stockflow.test
Supplier ID: 1
Actual testing destination: configured Discord channel.
The intended owner was not contacted. This post uses the single Discord test channel only.
```

Administrator audits identify the administrator and supplier ID `0`, an attribution marker rather than a supplier account. Owner addresses are explanatory content and never delivery destinations. Supplier posts contain only that intended supplier's relevant inventory/order lines; administrator audits cover catalog-wide issues.

Reserved demo addresses such as `.test` and `.local` are allowed as attribution for Discord. Invalid email syntax, multiple-recipient strings, and injection strings are rejected. At-signs become `[at]` in sent content; exact addresses remain in notification metadata.

## Routing and content safeguards

1. The planner creates a notification with `deliveryMode: 'discord'`, `to: 'discord-channel'`, and intended-recipient name, email, and supplier ID. Delivery requires the exact boolean `notificationsEnabled: true`; a string such as `'true'` does not enable it.
2. The delivery guard requires a notification, enabled delivery, Discord mode, the exact logical destination, and intended-recipient metadata.
3. **Prepare Discord message** validates attribution, neutralizes mention syntax, escapes Markdown and angle brackets, and caps content at 2,000 characters with an explicit truncation notice. Per-item links preserve the correct intended owner's delivery state.
4. The native **Send Discord notification** node uses one encrypted Discord Webhook credential. Product, order, owner, and incoming item data cannot select a URL or channel. The transport uses `wait: true`, suppresses link previews, disables TTS, and has no automatic node retries.

Every ASCII `@` in sent content becomes ` [at] `, preventing user, role, everyone, and here mention syntax. This is content sanitization, not an `allowed_mentions` API setting. Long grouped details can be omitted with a notice; inspect complete records in StockFlow.

**All channel readers can see all posted details**, including intended-owner attribution and the administrator audit. StockFlow's role-based permissions do not restrict Discord access. Keep the selected channel private to appropriate operations staff.

## Activation and delivery state

The webhook URL belongs only in n8n's encrypted credential store. The private setup file and temporary import payload are removed after verified import; tracked workflow JSON contains only a credential reference. No OpenAI call is made.

`node automations/configure-discord.mjs --test` sends one labeled fictional connection post. The private `.local/discord-connection-test.json` marker must confirm a valid message ID and channel ID for the exact webhook fingerprint before scheduled activation. A previous channel's test does not authorize a replacement webhook.

`node automations/configure-discord.mjs --enable-low-stock` uses that confirmed credential and enables **critical stock alerts only**. The other four workflows remain previews. Its guarded administrative equivalent is:

```powershell
node automations/update-local.mjs --apply --enable-low-stock --discord-credential-id=StockFlowDiscord01
```

An ordinary `node automations/update-local.mjs --apply` disables delivery for all five while preserving cooldowns and the order baseline. The preview verifier refuses live-enabled or changed executable workflows rather than testing delivery.

Successful delivery is remembered only after the native Discord response contains a valid message ID. Failures remain due for retry. Every intended owner's event keys remain separate, even though all posts share a channel. Audit/order-change deduplication retains its own keys; the first order observation establishes history without historical posts. Published schedules persist static data; manual editor runs do not.

There is no exactly-once guarantee: uncertain network outcomes or overlapping executions can cause duplicate posts. Inspect the channel before deliberately repeating a connection test. The helper blocks another attempt for the same webhook unless `--test --repeat` is explicitly supplied.

## Changing the channel

Unpublish **every workflow referencing the credential** before importing a different webhook. Published previews must also be unpublished. The helper refuses a changed destination while any user of that credential remains published. Once those workflows are unpublished, it restarts n8n before importing a changed URL to flush old schedules. A new confirmed test is required before activation.

Offline tests verify native transport parameters, false delivery defaults, intended-recipient attribution, preparation/guard routing, mention neutralization, per-item delivery state, and failure retries without contacting Discord.
