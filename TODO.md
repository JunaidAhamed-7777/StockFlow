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
- [x] Install and publish all three workflows in scheduled preview mode in the running local n8n instance.
- [x] Verify all three actual n8n HTTP/Code pipelines reach Preview only against 44 products, with zero Gmail/OpenAI node calls.
- [x] Test automation edge cases without sending test mail to stock owners or spending on OpenAI.
- [x] Run TypeScript checks and production build; verify routes, responsive layout, states, and console output.
- [x] Document completed work, exact local startup steps, and remaining backend/credential limitations.
- [x] Document every app login and the n8n owner login in ignored `.local/LOGIN-ACCOUNTS.md`.
- [x] Commit changes in frequent, focused batches.

## External setup still required

- [ ] Connect a Gmail OAuth credential in n8n, select it on each Gmail node, review real stock-owner emails, and enable delivery. The instance has no Gmail authorization/client credentials, so live mail delivery is deliberately disabled. The supplied n8n password does not authorize Google access. Exact instructions are in `automations/README.md`; no mail or paid AI tests were performed.

## Gmail redirection and additional workflows

- [x] Add explicit redirected delivery to `junuhammad2@gmail.com`, with intended owner name, address, and supplier ID in each message.
- [x] Lock every Gmail node to the same destination; prohibit CC/BCC and gate delivery on the redirect and recipient metadata.
- [x] Add a weekly inventory data-quality audit using existing product/category/supplier APIs.
- [x] Add new/order-status notifications with a first-run history baseline and supplier-specific order lines.
- [x] Prepare the Gmail OAuth credential form with only `https://www.googleapis.com/auth/gmail.send`.
- [x] Add strict credential validation and updates that preserve delivery markers and order baselines.
- [ ] Complete Google OAuth in n8n. Google Cloud's project/client setup pages failed to render in the in-app browser; the user has been asked to complete those Google steps in a regular browser and enter the client credentials directly in the prepared n8n form.
- [ ] Send one explicitly labeled connection test to the redirect mailbox and enable low-stock delivery after OAuth succeeds.

## Verification

Frontend TypeScript, production build, and lint pass; the frontend dependency audit reports zero vulnerabilities. Seventeen frontend regression cases, 22 notification-rule cases, and four runtime ownership cases pass (43 total). Customer desktop/mobile browser checks cover catalog, photos, search, empty states, pagination, quantity validation, cart, profile, and order details. Admin checks cover sign-in, role redirects, supplier directory, inventory, stock modal keyboard focus/restore, product editing, order details, and the automation UI. Supplier checks cover dashboard, own-product catalog, inventory, orders/subtotals, and rejection of another supplier's edit URL. All three n8n previews use the real local API and leave delivery disabled.

Actual app restart and stopped-n8n autostart both pass. Database counts, JWT secret, n8n encryption configuration, encrypted API credential, owner login, and three published workflow IDs are preserved. The pre-existing disposable (`--rm`) n8n container was replaced with a persistent local container using the same preserved data volume. All three workflows reached Preview only again after recovery, with zero email/OpenAI calls. Every one of the 12 app accounts and the n8n owner login appears in the private login document. Final checkout submission and live Gmail delivery were not performed; the current database retains the original single sample order.

## Known constraints found during inspection

- The current repository frontend is JavaScript/JSX despite the original TypeScript brief; checked TypeScript boundaries will be introduced incrementally.
- Product records have no image field. A frontend SKU-to-image manifest can provide demo imagery without changing the database.
- Public registration currently accepts `ADMIN`, and registration does not create a supplier profile. Frontend changes cannot close backend authorization gaps or invent supplier-write APIs.
- AI endpoints return HTTP 501. No predictions or recommendations will be fabricated.
- n8n runs in Docker; its existing owner login and encrypted volume are preserved. The supported CLI imports and publishes the local preview workflows without resetting the account.
