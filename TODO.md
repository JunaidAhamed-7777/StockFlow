# StockFlow improvement checklist

This work uses the existing API and Prisma schema. `server/` remains unchanged.

- [x] Read `AGENTS.md`, `DESIGN.md`, runtime documentation, and existing API contracts.
- [ ] Restore a runnable local development environment without changing backend source.
- [ ] Standardize shared UI, typography, contrast, navigation, and responsive layouts.
- [ ] Improve keyboard navigation, accessible labels, dialogs, focus, and status messages.
- [ ] Harden frontend sessions, role routing, API errors/timeouts, and cart validation.
- [ ] Fix search/filter handlers and strengthen forms and order/stock workflows across all roles.
- [ ] Polish sign-in/registration and keep unsupported capabilities clearly identified.
- [ ] Add repeatable demo accounts and a substantial catalog through supported API operations.
- [ ] Add relevant free stock photos with source and license documentation.
- [ ] Build n8n low-stock owner alerts with grouped messages, recipient validation, and deduplication.
- [ ] Add useful free automations: daily inventory digest and stale-order follow-up.
- [ ] Install workflows into the running local n8n instance and verify what can run with available credentials.
- [ ] Test automation edge cases without sending test mail to stock owners or spending on OpenAI.
- [ ] Run TypeScript checks and production build; verify routes, responsive layout, states, and console output.
- [ ] Document completed work, exact local startup steps, and remaining backend/credential limitations.

## Known constraints found during inspection

- The current repository frontend is JavaScript/JSX despite the original TypeScript brief; checked TypeScript boundaries will be introduced incrementally.
- Product records have no image field. A frontend SKU-to-image manifest can provide demo imagery without changing the database.
- Public registration currently accepts `ADMIN`, and registration does not create a supplier profile. Frontend changes cannot close backend authorization gaps or invent supplier-write APIs.
- AI endpoints return HTTP 501. No predictions or recommendations will be fabricated.
- n8n is running in Docker and requires sign-in. Its supported CLI can import workflows without resetting the owner's account.
