# StockFlow improvement checklist

This work uses the existing API and Prisma schema. `server/` remains unchanged.

- [x] Read `AGENTS.md`, `DESIGN.md`, runtime documentation, and existing API contracts.
- [x] Restore a runnable local development environment without changing backend source.
- [x] Standardize shared UI, typography, contrast, navigation, and responsive layouts.
- [x] Improve keyboard navigation, accessible labels, dialogs, focus, and status messages.
- [x] Harden frontend sessions, role routing, API errors/timeouts, and cart validation.
- [x] Fix search/filter handlers and strengthen forms and order/stock workflows across all roles.
- [x] Polish sign-in/registration and keep unsupported capabilities clearly identified.
- [x] Add repeatable demo accounts and a substantial catalog through supported API operations. Supplier records use a guarded data-only bootstrap against the isolated demo DB because the API has no creation endpoint.
- [x] Add relevant free stock photos with source and license documentation.
- [x] Build n8n low-stock owner alerts with grouped messages, recipient validation, and deduplication.
- [x] Add useful free automations: daily inventory digest and stale-order follow-up.
- [x] Install and publish all five workflows in scheduled preview mode in the running local n8n instance.
- [x] Verify all five actual n8n HTTP/Code pipelines against 44 products without contacting stock owners or calling OpenAI.
- [x] Test automation edge cases without sending test mail to stock owners or spending on OpenAI.
- [x] Run TypeScript checks and production build; verify routes, responsive layout, states, and console output.
- [x] Document completed work, exact local startup steps, and remaining backend/credential limitations.
- [x] Document every app login and the n8n owner login in ignored `.local/LOGIN-ACCOUNTS.md`.
- [x] Commit changes in frequent, focused batches.

## Discord delivery and additional workflows

Gmail OAuth setup was canceled by the user in favor of a Discord channel webhook. The unused Gmail form was closed and the Gmail configuration/test tooling was removed. A previously submitted Google Cloud project was never confirmed; this setup no longer depends on that project or any Google client.

- [x] Replace every Gmail workflow node with native Discord webhook delivery to one encrypted credential.
- [x] Include intended owner name, recorded address, and supplier ID in each post; owners receive no direct messages or emails.
- [x] Neutralize every ASCII at-sign and Markdown mention syntax; display addresses with `[at]`, suppress embeds/TTS, and cap messages with explicit omission notices.
- [x] Add a weekly inventory data-quality audit using existing product/category/supplier APIs.
- [x] Add new/order-status notifications with a first-run history baseline and supplier-specific order lines.
- [x] Validate canonical Discord webhook URLs and keep secrets out of exports and diagnostics.
- [x] Import the user-provided webhook into encrypted n8n storage, verify its fingerprint, and remove the temporary input file.
- [x] Send one labeled fictional connection test and confirm the returned Discord message/channel IDs.
- [x] Require a matching successful-test fingerprint before activation; block repeated or ambiguous connection tests.
- [x] Import and publish all five Discord preview definitions without resetting existing state; restart n8n successfully.
- [x] Complete all five installed Discord preview executions against 44 products, then activate critical-stock alerts only.
- [x] Verify all published graphs, credential bindings, intended activation flags, inactive test draft, and local health after the activation restart.

## Verification

### Native agents and final frontend refinement

- [x] Repair and publish the existing Admin Notification agent with GPT-5 mini.
- [x] Add published supplier and customer agents with fixed account scopes, scheduled reviews, and budget guardrails.
- [x] Store the root OpenAI key only in encrypted n8n credentials; keep every account login in ignored private documentation.
- [x] Verify all three read-only role tools against real API data and one short successful model session per role ($0.00639355 recorded total).
- [x] Remove login role chips, decorative marketing copy, misleading labels, and the disconnected forecasting probe.
- [x] Consolidate form validation, search clearing, table contrast, navigation, and unsaved form protection.
- [x] Complete operational list pagination, integrated frontend checks, and the final desktop/mobile browser review.
- [ ] Push the verified commits to `origin/main`.

The verification notes below describe the earlier Discord setup. Current role-agent scope, costs, and evidence are documented in `automations/ROLE-AGENTS.md`.

The final refinement passes 22 client cases and 144 automation/runtime cases (166 total), TypeScript, lint, production build, and the strict UI ownership audit with zero findings. Desktop/phone browser checks and remaining backend limits are recorded in `docs/VERIFICATION-2026-10-15.md`. No business records were changed by these final checks.

Frontend TypeScript, production build, and lint pass; the frontend dependency audit reports zero vulnerabilities. Seventeen frontend regression cases, 83 automation/routing/credential cases, and four runtime ownership cases pass (104 total). Customer desktop/mobile browser checks cover catalog, photos, search, empty states, pagination, quantity validation, cart, profile, and order details. Admin checks cover sign-in, role redirects, supplier directory, inventory, stock modal keyboard focus/restore, product editing, order details, and the automation UI. Supplier checks cover dashboard, own-product catalog, inventory, orders/subtotals, and rejection of another supplier's edit URL. Discord offline tests additionally cover routing, hostile content, truncation, native-node settings, unchanged execution graphs, private credential validation, connection-test confirmation, and repeat protection.

Actual app restart and stopped-n8n autostart both pass. Database counts, JWT secret, n8n encryption configuration, encrypted API credential, owner login, and existing workflow IDs are preserved. The pre-existing disposable (`--rm`) n8n container was replaced with a persistent local container using the same preserved data volume. n8n is healthy after restarting to load the Discord schedules. One clearly labeled Discord connection test was confirmed; critical-stock posting is enabled every 15 minutes, with the other four workflows in preview. No products currently meet the critical condition, so verification did not produce a real stock alarm. No stock-owner emails, direct messages, or OpenAI calls were made. The webhook URL and token were checked against all 218 tracked files with zero matches. Every one of the 12 app accounts and the n8n owner login appears in the private login document. No final checkout was submitted; the database retains its original single sample order.

## Known constraints found during inspection

- The current repository frontend is JavaScript/JSX despite the original TypeScript brief; checked TypeScript boundaries will be introduced incrementally.
- Product records have no image field. A frontend SKU-to-image manifest can provide demo imagery without changing the database.
- Public registration currently accepts `ADMIN`, and registration does not create a supplier profile. Frontend changes cannot close backend authorization gaps or invent supplier-write APIs.
- AI endpoints return HTTP 501. No predictions or recommendations will be fabricated.
- n8n runs in Docker; its existing owner login and encrypted volume are preserved. The supported CLI imports and publishes the local preview workflows without resetting the account.
