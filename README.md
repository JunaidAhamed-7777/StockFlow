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

**All outbound workflow email is redirected to `junuhammad2@gmail.com`.** Each email explicitly identifies its intended owner/administrator and their recorded address; no owner is added to To, CC, or BCC. Reserved demo addresses may appear as intended-recipient metadata but never as actual destinations. See [mail routing](automations/MAIL-ROUTING.md).

**Delivery remains disabled until send-only Gmail OAuth is connected in n8n.** The n8n sign-in credentials do not authorize Gmail. Follow [automation setup](automations/README.md), then use the guarded updater to enable only low-stock delivery. The other workflows remain in preview until deliberately enabled. No email was sent during the current disconnected tests.

These workflows make no OpenAI calls. The root OpenAI API key stays private and is not needed for stock rules. AI forecast/recommendation endpoints remain unimplemented; the UI shows that limitation honestly.

## Validate

```powershell
npm run typecheck
npm run build
npm run lint --workspace client
npm test --workspace client
node --test automations/*.test.mjs
node automations/verify-local.mjs
npm audit --workspace client
```

The n8n verifier refuses to run workflows whose executable graphs differ from the disabled-delivery source, including altered recipients or live-enabled settings. It reports only redacted execution summaries, with no bearer tokens. Run it before enabling live low-stock mail.

## Scope and known limits

[AGENTS.md](AGENTS.md) defines the implementation boundaries and [DESIGN.md](DESIGN.md) defines the visual system. [Backend follow-up](docs/FRONTEND-LIMITATIONS.md) records unresolved server authorization, data-exposure, concurrency and dependency findings. Frontend improvements do not resolve those server gaps; the local demo should not be exposed as an internet-facing production system until they are addressed.

Progress and verification are recorded in [TODO.md](TODO.md). Existing API reference material remains in `server/endpoints.md`; where older walkthroughs disagree, current source and the local development guide take precedence.
