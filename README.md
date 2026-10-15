# StockFlow

Stock and inventory management with Customer, Supplier, and Admin workspaces. The production frontend lives in `client/`; `stitch_stockflow_enterprise_inventory_saas/` contains visual references only.

The frontend uses React, Vite, React Router, Tailwind CSS, and centralized Axios services. New shared foundations use strict TypeScript; existing page JSX is supported during the incremental migration. The existing Express/Prisma/PostgreSQL API remains unchanged.

## Start everything locally

Install Node.js 22.18+ (or a newer supported version), npm, and Docker Desktop. Start Docker Desktop, then run from the repository root:

```powershell
npm install
npm run dev
```

The launcher starts the frontend at [localhost:5173](http://localhost:5173), the existing API at `localhost:3001`, local n8n at [localhost:5678](http://localhost:5678), and an isolated demo PostgreSQL instance on loopback port `55432`. It reuses the existing `n8n` container and `n8n_data` volume, preserving the n8n account and encrypted credentials. It does not use n8n Cloud.

The first local setup creates only a new `stockflow-db` database container using the unchanged Prisma schema and original development seed. Later starts preserve its data. Runtime configuration, logs, generated account passwords, and verification reports are stored in ignored `.local/`. This launcher is for local development; it does not modify `server/` or configure a production deployment.

The services run in the background. See [local development](docs/LOCAL-DEVELOPMENT.md) for status, stopping, restarting, and troubleshooting. For an already configured backend, the independent workspace commands remain `npm run dev:client` and `npm run dev:server`.

## Accounts and demonstration catalog

**All local account login information, including n8n, is in `.local/LOGIN-ACCOUNTS.md`.** That private document is deliberately excluded from Git. It contains the three original app logins, eight added demo accounts, the automation service account, and the n8n owner login.

The demonstration catalog includes 40 additional products, four new supplier profiles and four new customer accounts. It contains clearly fictional `DEMO-` SKUs and illustrative free stock photographs, with credits on product details. No customer purchases or AI outputs are fabricated. See [demo data and photo sources](docs/DEMO-DATA.md).

To preview or safely repeat the catalog setup:

```powershell
node scripts/seed-demo-catalog.mjs
node scripts/seed-demo-catalog.mjs --apply --local-supplier-profiles
node scripts/write-login-doc.mjs
```

## Local n8n automation

Five rule-based workflows are available locally and default to preview mode:

- Critical stock alerts every 15 minutes, grouped by stock owner with cooldowns.
- Daily owner inventory digests at 09:00 Asia/Kolkata.
- Open-order follow-up at 10:00 Asia/Kolkata for orders at least 48 hours old.
- Weekly inventory data-quality audit on Monday at 09:30 Asia/Kolkata, only when issues exist.
- New and changed order alerts every 15 minutes, with an initial baseline that suppresses historical messages.

**StockFlow notifications use one chosen Discord channel.** Each post explicitly identifies its intended owner/administrator and recorded address; owners receive no emails or direct messages. At-signs display as `[at]` to neutralize Discord mention syntax. Reserved demo addresses are attribution only. See [notification routing](automations/MAIL-ROUTING.md).

**Gmail OAuth setup was canceled in favor of Discord incoming webhooks.** No Google client or bot OAuth is required. Follow [Discord setup](automations/DISCORD.md): import the private webhook into encrypted n8n storage, confirm one labeled test, then enable only critical stock alerts. The other workflows remain in preview. Source templates always default to disabled delivery.

The current local installation passed its Discord connection test and has critical-stock alerts enabled as of 15 October 2026. All five installed graphs and activation settings were verified after restarting n8n. The test draft is inactive, and the webhook URL's temporary import file has been removed.

These workflows make no OpenAI calls. The root OpenAI API key stays private and is not needed for stock rules. AI forecast/recommendation endpoints remain unimplemented; the UI shows that limitation honestly.

Three native n8n agents are also published: the repaired **Admin Notification**, **Supplier Assistant**, and **Customer Assistant**. They use GPT-5 mini and separate fixed-account, read-only tools for scheduled reviews and drafts. Their encrypted OpenAI credential comes from the root `.env`. Each has $3/month and $0.10/session budget guardrails; the three live verification sessions cost $0.00639355 in total. See [role-agent access, scope, schedules, and cost controls](automations/ROLE-AGENTS.md).

## Validate

```powershell
npm run typecheck
npm run build
npm run lint --workspace client
npm test --workspace client
node --test "automations/*.test.mjs" "scripts/*.test.mjs"
node automations/verify-role-agents.mjs
npm audit --workspace client
```

The role-agent verifier reads configuration and budget metadata without calling a model. `node automations/verify-agent-tools.mjs` separately verifies and executes the three read-only API tools. The notification preview verifier, `node automations/verify-local.mjs`, intentionally refuses live-enabled settings; use it before enabling Discord delivery, as described in the automation guide.

The final refinement passed TypeScript, lint, production build, 166 tests, and a strict UI ownership audit. Desktop/phone browser coverage and its limits are recorded in [the verification report](docs/VERIFICATION-2026-10-15.md).

## Scope and known limits

[AGENTS.md](AGENTS.md) defines the implementation boundaries and [DESIGN.md](DESIGN.md) defines the visual system. [Backend follow-up](docs/FRONTEND-LIMITATIONS.md) records unresolved server authorization, data-exposure, concurrency and dependency findings. Frontend improvements do not resolve those server gaps; the local demo should not be exposed as an internet-facing production system until they are addressed.

Progress and verification are recorded in [TODO.md](TODO.md). Existing API reference material remains in `server/endpoints.md`; where older walkthroughs disagree, current source and the local development guide take precedence.
