# Local development

Use Node.js **22.18 or newer**, npm, and a running Docker Desktop installation. The current frontend uses Vite 7 and Tailwind CSS 4. Its browser baseline is Chrome 111+, Safari 16.4+, or Firefox 128+. Docker must be available to the account running the commands.

From the repository root:

```powershell
npm install
npm run dev
```

The launcher starts or verifies these local services:

- StockFlow frontend: [http://localhost:5173](http://localhost:5173).
- Existing StockFlow API: `http://localhost:3001/api`.
- Local n8n: [http://localhost:5678](http://localhost:5678).
- Isolated demonstration PostgreSQL: loopback port `55432`, forwarded to port `5432` inside `stockflow-db`.

The API and frontend launch as detached background processes. The command exits when all three HTTP services are healthy. Closing the terminal does not stop them. Repeating `npm run dev` verifies and reuses the recorded processes without launching duplicates.

## Status, stop, and restart

```powershell
npm run dev -- status
npm run dev -- stop
npm run dev -- restart
```

The equivalent direct commands are `node scripts/local-runtime.mjs status`, `stop`, and `restart`. The default action is `start`.

`status` reports service health and whether the API/frontend process identities match this checkout. It does not create a database or start services.

`stop` stops only the recorded API and frontend processes after checking their PID, process creation time, Node executable, and exact script argument. The database and existing n8n container remain available. No container, volume, account, or catalog record is deleted.

`restart` restarts those verified application processes, ensures that the existing database and n8n containers are running, and waits for readiness again. It preserves their data and credentials. The launcher does not restart n8n while it is already running, because the existing n8n instance may also contain the user's other workflows.

The runtime serializes start/stop/restart commands with `.local/runtime.lock`. If another command is still running, wait for it to finish. A lock whose recorded process no longer exists is removed automatically on the next attempt.

## Database and n8n data

First setup creates a new `stockflow-db` container and `stockflow_demo_pgdata` volume with a generated database password and JWT signing secret. It uses the existing, unchanged Prisma schema and original development seed. Schema creation and seeding run only when the local marker is uninitialized and the isolated database's public schema is empty. Subsequent starts do not push the schema or reseed the data.

The launcher refuses to attach a pre-existing demo database or volume when this checkout has no ownership marker. It also refuses remote database hosts, mismatched credentials, unexpected port bindings or volumes, and a replacement container ID. It does not read the root `.env` to select a database. A production database configured elsewhere is not used by this launcher.

If setup was interrupted after creating tables but before completing the seed, the next start refuses to overwrite the non-empty schema. Inspect the isolated database and setup logs before choosing a recovery; the launcher does not automatically drop or reset it.

The existing Docker container named `n8n` is reused after verifying its official image, port, persistent credential mount, and saved container identity. A stopped n8n container is started. Its `n8n_data` storage, local login, encryption configuration, credentials, and workflows are preserved. If no n8n container exists on first setup, the launcher creates one with local persistent storage and loopback-only port publishing. It never connects to n8n Cloud.

If a recorded database or n8n container is later missing, the launcher reports that condition instead of silently replacing it or initializing over an unknown volume. Restore or inspect the intended Docker resources before retrying.

## Private files and logs

Runtime state is under the Git-ignored `.local/` directory:

- `runtime.json`: generated local database/JWT secrets, verified container IDs, application PIDs, and process creation times.
- `server.log` and `client.log`: appended application startup/output logs.
- `runtime.lock`: short-lived command ownership marker.
- `LOGIN-ACCOUNTS.md`: private local account sign-in information, including n8n.
- Generated account records and verification reports created by the demo/automation tools.

Keep these files private. Do not paste `runtime.json`, account files, or unredacted logs into issues or commits. The launcher does not print database passwords or JWT secrets. This guide deliberately contains no login passwords.

To generate the current private account document after setting up demo accounts:

```powershell
node scripts/write-login-doc.mjs
```

See [demo catalog setup](DEMO-DATA.md) for the additional profiles/products and [local automation setup](../automations/README.md) for n8n and Gmail delivery settings. Running the development launcher does not enable Gmail delivery or call OpenAI.

## Troubleshooting

If Docker is unavailable, start Docker Desktop and retry. If a service fails to become ready, inspect `.local/server.log` and `.local/client.log`, then use the verified restart command.

An occupied port is not proof of ownership. If port `3001` or `5173` belongs to a process absent from this checkout's runtime marker, the launcher refuses to reuse or terminate it. Stop that service through the terminal or application that started it, or resolve the conflict before retrying. The same conservative check applies to unverified services on the database/n8n ports. The frontend uses a strict port and will not quietly move to another one.

For an independently configured backend, `npm run dev:client` and `npm run dev:server` remain available. Those independently started processes are not adopted automatically by the combined launcher. Stop them through their original terminal before switching back to `npm run dev`.

On macOS/Linux, process/port ownership verification additionally requires `ps` and `lsof`. Windows uses PowerShell process metadata and TCP listener inspection. Only Windows has been exercised in this workspace.

## Checks

```powershell
npm run typecheck
npm run build
npm run lint --workspace client
npm test --workspace client
node --test scripts/local-runtime.test.mjs
```

Strict TypeScript checks cover the new shared foundations and typed API/storage boundaries. Existing JSX pages remain part of an incremental migration with `allowJs: true` and `checkJs: false`; the checks do not claim complete TypeScript coverage of every legacy page. The regression tests exercise cart/storage validation and runtime ownership checks without sending email or calling OpenAI.

This launcher is for local development. Review [backend limitations](FRONTEND-LIMITATIONS.md) before exposing the application outside the local machine.
