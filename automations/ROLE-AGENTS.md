# Local StockFlow agents

Three native n8n agents are published in the existing Personal project. The existing **Admin Notification** agent was repaired; **Supplier Assistant** and **Customer Assistant** were added. They use **GPT-5 mini** (`openai/gpt-5-mini` in n8n), one role-specific workflow tool each, and the OpenAI key from the root `.env` stored in an encrypted n8n credential. No key is bundled into the frontend or included in workflow exports.

## Access and schedules

Open [local n8n](http://localhost:5678/home/agents), then the Personal project's Agents tab. Select an agent to start a chat or inspect its Sessions and scheduled tasks. The n8n owner login and every StockFlow account login are recorded privately in `.local/LOGIN-ACCOUNTS.md`, which Git ignores.

- **Admin Notification** uses **StockFlow Local Automation**, an ADMIN API account. It reviews inventory exceptions and all-order summaries every day at **09:15 IST**.
- **Supplier Assistant** uses **Supplier Test**. It reviews that supplier's products, stock, and own order lines on weekdays at **09:30 IST**.
- **Customer Assistant** uses **Customer Test**. It reviews that customer's orders and the public catalog on Mondays at **10:00 IST**.

These are operator assistants bound to fixed StockFlow accounts. Signing into StockFlow as another customer or supplier does not change an agent's identity. Native n8n access does not provide StockFlow end-user authentication. The frontend's administrator Automations page explains the scope and links to n8n; it does not expose an unrestricted chat to customers or suppliers.

Scheduled results remain in the relevant agent's n8n Sessions. They do not send Discord messages or emails. The separate [Discord stock rules](DISCORD.md) continue to handle critical-stock notifications.

## What they automate

Agents can search and compare recorded products, summarize stock and orders, identify exceptions, and prepare replenishment or reorder drafts. Every factual answer must first read its context tool. Replenishment quantities use recorded thresholds; they are not demand forecasts.

Tools authenticate through encrypted API credentials, verify `/auth/me`, and enforce account ownership in code. Supplier identity is resolved through the recorded supplier/user relationship before filtering products and order lines. Customer orders are restricted to the verified customer ID. Supplier order totals are recomputed from its own lines. Product text is untrusted data; it cannot change the tool's account, role, target URL, or permissions.

The model receives a bounded field projection, not JWTs, login passwords, password hashes, raw API responses, unrelated customer data, or arbitrary supplier order totals. Returned and truncated counts identify partial lists. Tools have no product, stock, order, account, email, or Discord mutation nodes. No agent can place an order or claim that a proposed change was applied.

Existing backend concurrency and authorization limitations are documented in [FRONTEND-LIMITATIONS.md](../docs/FRONTEND-LIMITATIONS.md). Automated writes would need a separate backend design with safe authorization and idempotency. This setup does not modify backend source, routes, schema, or authentication.

## Cost controls

Each agent has a **$3 monthly budget**, an **80% warning threshold**, and a **$0.10 session guardrail**. All three together are configured for $9 per month. These n8n guardrails are checked between calls, so a final in-flight call can exceed a threshold; they are not an OpenAI billing cap.

Reasoning is low, iterations are limited to six, tools run sequentially, and memory and web search are disabled. Do not run repeated chat tests to check configuration; the read-only verifier below makes no model calls. A local instance avoids n8n Cloud charges, but OpenAI usage still costs money. Sleeping or stopped computers do not execute schedules. `npm run dev` starts the preserved n8n container alongside StockFlow.

## Install and verify

The reviewed source is `role-agent-definitions.mjs`; the role tool builder is `build-agent-workflows.mjs`. Tracked tool JSON contains only credential references. The installer defaults to a dry run:

```powershell
node automations/configure-role-agents.mjs
```

Apply to the existing project and existing administrator agent with their IDs from n8n:

```powershell
node automations/configure-role-agents.mjs --apply --project-id=PROJECT_ID --admin-agent-id=ADMIN_AGENT_ID
```

The installer requires the root `OPENAI_API_KEY`, private account documentation, and this project's verified local n8n container. It backs up the administrator config and existing workflows under ignored `.local/n8n-agent-backups/`, imports encrypted credentials and three read-only tool workflows, restarts n8n, configures the agents, validates them, and publishes their managed schedules. It waits for the existing agent route after restart rather than relying on early HTTP health alone. Reruns update the managed task rather than creating duplicates and preserve other task references. Review additional user-created tasks separately. Configuration apply makes no model calls.

After a successful install, local IDs are recorded privately in `.local/role-agents.json`. Verify configuration and role tools without calling OpenAI:

```powershell
node automations/verify-role-agents.mjs
node automations/verify-agent-tools.mjs
node --test "automations/*.test.mjs"
```

The configuration verifier checks the published/current version, exact reviewed model, instructions, credential binding, tool permissions, budget settings, enabled task reference, objective, and schedule. The tool verifier refuses graphs that differ from the read-only builder before executing existing API reads. Raw credential-bearing CLI output stays in memory; reports contain only whitelisted metadata and counts.

## Verified on 15 October 2026

All three native configurations passed validation, were published, and were runnable. Actual read-only tool executions passed for ADMIN (44 products, two orders), SUPPLIER (four owned products, one related order), and CUSTOMER (44 catalog products, two own orders). These are observations of the local data at verification time.

One short live model session per agent succeeded, each with exactly one successful assigned tool call. n8n recorded **$0.00243550** for ADMIN, **$0.00131280** for SUPPLIER, and **$0.00264525** for CUSTOMER: **$0.00639355 total**, below the user's $10–$15 testing ceiling. No business records or external messages were created by these checks. Actual scheduled recurrence has not been observed through the next due time; enabled task references, schedules, published versions, and manual execution paths were verified.

Private evidence is in `.local/role-agent-verification.json`, `.local/role-agent-tool-verification.json`, and `.local/role-agent-smoke-verification.json`. Session and execution IDs are retained there for inspection in n8n. Configuration verification can be repeated without spending on model calls.

See [the native agent QA report](../docs/QA-ROLE-AGENTS.md) for the 16 October
scope, installer-repeatability and zero-model-call checks. Prefer the read-only
configuration verifier for inspection. The [editor investigation](../docs/QA-AGENT-EDITOR.md)
confirmed that n8n 2.43.6 can autosave model defaults on opening an existing
empty-model draft, and a non-memory field edit forces `memory.enabled: true`.
That outer flag enables session persistence; cross-session episodic recall is
controlled separately. Opening Build/Settings with a selected model did not
change the disposable control, so the original configured-agent inspection
trigger remains unproven.

Repeat the strict verifier after editor inspection or edits. Back up an
unexpected draft before using **Revert changes**, then verify the restored
published configuration, tools and scheduled tasks. Do not publish an unexpected
draft just to make current/published versions match. No reviewed stable upgrade
has yet been verified to fix this normalization behavior.
