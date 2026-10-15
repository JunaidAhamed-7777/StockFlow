# Discord notifications with local n8n

The local Discord webhook is stored encrypted in n8n, **one labeled connection test was confirmed on 15 October 2026, and critical-stock alerts are enabled**. The other four workflows remain previews. The temporary URL file was removed. All five graphs, published states, credential bindings, and delivery settings were verified after restarting n8n; private evidence is in `.local/discord-live-verification.json`. Tracked templates still start with `notificationsEnabled: false`; publishing a schedule alone does not enable posting.

This setup uses local n8n and an ordinary Discord incoming webhook, with no paid integration, Google OAuth, or OpenAI calls. A Discord bot application is not required. n8n sends outbound requests to Discord; the local editor does not need a public URL or tunnel. The app, API, Docker, and n8n must stay running for scheduled checks.

## Create a webhook for a private channel

1. Choose a Discord server you manage and create a private text channel for StockFlow operations, such as `stockflow-alerts`. Limit channel access to people who should see inventory and owner details.
2. In **Server Settings → Integrations**, create a webhook, name it **StockFlow**, and select that channel.
3. Select **Copy Webhook URL**. Use the ordinary URL exactly as copied.
4. In a local text editor, create `.local/discord-webhook.url` under this repository. Paste the URL as its only line and save it. The `.local/` directory is ignored by Git.

The webhook URL is a credential: anyone holding it can post through that webhook. Keep it out of source files, screenshots, chat messages, terminal commands, and documentation. The setup helper imports it into n8n's encrypted credential store and deletes the local input file after a successful import. Temporary credential import files are removed as well. Workflow exports refer to the credential by ID and do not contain the URL.

Official setup references: [n8n Discord webhook credentials](https://docs.n8n.io/integrations/builtin/credentials/discord/) and [Discord's webhook guide](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks).

## Migrate, connect, test, then enable

Run commands from the repository root with the local app and n8n running.

If this installation still has the previous Gmail workflows, migrate all five to the Discord preview templates first. This does not require a Discord credential and leaves notification delivery disabled:

```powershell
node automations/update-local.mjs --apply
```

Review the setup helper's dry run:

```powershell
node automations/configure-discord.mjs
```

Import the webhook from `.local/discord-webhook.url`. This step stores the credential and consumes the input file; it does not send a message or enable a schedule:

```powershell
node automations/configure-discord.mjs --apply
```

Send one explicitly labeled connection-test post to the webhook's channel:

```powershell
node automations/configure-discord.mjs --test
```

Check that the test appears in the intended private channel. It is a connection test, not an inventory alert. Only after a confirmed successful test, enable critical stock alerts:

```powershell
node automations/configure-discord.mjs --enable-low-stock
```

Run these commands sequentially rather than combining their flags. The activation helper requires the prior confirmed test, uses the stored credential ID, and applies the guarded updater with only critical stock delivery enabled. The other four workflows remain previews. Check connection and execution status in [local n8n](http://localhost:5678/home/workflows); the StockFlow page shows definitions, not live connection status.

To return every workflow to preview mode while preserving delivery state:

```powershell
node automations/update-local.mjs --apply
```

The preview verifier refuses workflows with live delivery enabled. Disable delivery first when using it:

```powershell
node automations/verify-local.mjs
```

## Message routing and privacy

All five workflows route their posts to **one chosen Discord channel**. Each post includes the intended stock owner's or administrator's name, recorded email, and supplier ID. Address at-signs display as `[at]`, so an intended address appears as `owner [at] supplier.test`; the exact recorded address remains in the n8n notification metadata. Administrator audits use supplier ID `0` and explicitly identify the administrator as the intended recipient.

Owner emails are attribution only. These workflows do not send owner DMs or email. A post groups the intended supplier's own inventory or order lines; the administrator audit can include issues from multiple owners. **Everyone who can read the channel can see every posted detail**, regardless of which owner a post names. StockFlow's role-based access does not control Discord channel membership.

Mention syntax is neutralized: all ASCII `@` characters in sent content become ` [at] `, and Markdown and angle brackets are escaped. Catalog text therefore cannot form Discord user, role, `@everyone`, or `@here` mentions. This is content sanitization; it does not rely on a Discord `allowed_mentions` option. Long details are capped with an explicit notice; use StockFlow to inspect complete records. No generated demand predictions or recommendations are included.

## Available workflows

All schedules use **Asia/Kolkata**:

- **Critical stock owner alerts:** every 15 minutes. Checks zero stock or quantity at most half the product's own reorder threshold. Successful posts have a 24-hour cooldown, with immediate out-of-stock escalation.
- **Daily inventory owner digest:** 09:00 daily. Groups owner-specific totals and low-stock products.
- **Open order follow-up:** 10:00 daily. Checks pending or processing orders at least 48 hours old and includes the intended supplier's own lines.
- **Weekly inventory data audit:** Mondays at 09:30. Posts an administrator report only when recorded data has issues; it never changes stock or other records.
- **New and changed order alerts:** every 15 minutes. Establishes an initial baseline without posting historical orders, then reports new orders and observed status changes. Polling can miss intermediate changes between checks.

Delivery state is recorded only after a confirmed successful Discord post. Failed attempts remain due for retry. Network failures with an uncertain outcome or overlapping executions can still produce duplicates; keep one local n8n instance and avoid simultaneous manual and scheduled delivery runs.
