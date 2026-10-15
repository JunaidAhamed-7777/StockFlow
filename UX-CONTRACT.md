# StockFlow UX contract

Reviewed on 15 October 2026. This contract defines the frontend behavior shared by all three workspaces. Implementation owners below exist in source; the migration section distinguishes remaining rollout and verification work. Source review is not a claim that every requirement has passed browser verification.

## Product context

Administrators maintain catalog ownership and stock, suppliers manage their own products and relevant orders, and customers discover products and place orders. The primary usage scene is routine inventory work on desktop, with complete task access on a narrow screen.

The current interface is English with `en-US` formatting and USD prices. No geographic business market or additional locale is specified. `client/src/utils/format.js` currently formats timestamps in the browser's local timezone; n8n schedules use Asia/Kolkata independently. Any future timezone standardization must update the formatter and visible labels together. Dates use the Gregorian calendar. Accessibility target: WCAG 2.2 AA.

## Business-context sources

These sources provide product evidence. The frontend does not repair server authorization, schema, or lifecycle behavior as a side effect of visual work.

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Roles and implementation boundary | `AGENTS.md`; `server/src/routes/*.routes.js`; `server/src/middleware/authorize.js` | Project instruction and verified route authorization | 2026-10-15 |
| Authentication and identity | `server/src/routes/auth.routes.js`; `client/src/context/AuthContext.jsx`; `client/src/utils/storage.ts` | Existing API and maintained session behavior | 2026-10-15 |
| Product ownership, edits, deletion | `server/src/services/productService.js`; `client/src/services/product.service.js`; `client/tests/product-payload.test.mjs` | Verified service and request contract | 2026-10-15 |
| Stock changes and validation | `server/src/services/stockService.js`; `client/src/services/stock.service.js` | Verified API behavior | 2026-10-15 |
| Orders and fulfillment | `server/src/services/orderService.js`; `client/src/pages/admin/AdminOrders.jsx`; `client/src/pages/supplier/SupplierOrders.jsx` | Existing domain implementation and frontend guardrails | 2026-10-15 |
| Payment, tax, freight | `client/src/pages/customer/CustomerCart.jsx`; `server/src/services/orderService.js` | Product-price subtotal only; no payment collection service | 2026-10-15 |
| Privacy and unresolved exposure | `docs/FRONTEND-LIMITATIONS.md`; `client/src/utils/apiData.js` | Maintained security limitations and safe projection | 2026-10-15 |
| Notification side effects | `automations/README.md`; `automations/DISCORD.md`; `automations/notification-rules.mjs` | Documented workflow and delivery rules | 2026-10-15 |
| Account-review agents | `automations/role-agent-definitions.mjs`; `client/src/pages/admin/AdminAI.jsx` | Fixed-account agent definitions and operator entry point | 2026-10-15 |
| Unsupported capabilities | `server/src/controllers/ai.controller.js`; `server/src/controllers/stock.controller.js`; `docs/FRONTEND-LIMITATIONS.md` | Verified HTTP 501 and existing API limits | 2026-10-15 |

No maintained retention policy, legal terms, or billing specification is present. Do not invent those policies or add legal assurances. Product deletion has no restore endpoint; notification dispatch is an external side effect. UI convenience never establishes permission.

## Visual contract

[DESIGN.md](DESIGN.md) preserves the existing visual identity. Executable theme ownership remains `client/tailwind.config.js`, loaded by `client/src/index.css`; DESIGN.md mirrors accepted values and explains intent. Only the light theme is currently supported. Use shared semantic aliases and reconcile durable changes in the document and owning runtime file together.

## Canonical UI Map

New screens must consume these owners; they must not duplicate them locally. Runtime/browser verification remains explicit in the final section.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | `client/src/components/ui/Input.tsx` Select | DESIGN.md and this contract | Native OS/browser-owned popup; no authored popup geometry guarantee | Keyboard selection, accessible name, opened native popup at narrow width |
| Date | `client/src/utils/format.js` | Current English/USD formatter policy in this contract | Read-only formatted timestamps and dates; no date-picker capability | Valid/invalid input and timezone-visible browser review |
| Form | `client/src/components/ui/Input.tsx`; `client/src/utils/formValidation.ts` | Validation section and verified service constraints | Create, edit, auth, stock adjustment; business checks stay in the owning workflow | Field errors, first-invalid focus, retry and duplicate-submit checks |
| Scrollbar | `client/src/index.css` | DESIGN.md and the global state tokens | Shared document and overflow regions; geometry exceptions only | Computed styles, keyboard overflow, forced-colors review |
| CRUD | `client/src/main.jsx` data router; `client/src/App.jsx`; `client/src/services/`; shared ProductForm, StockAdjustModal and Modal | API source references and flow ledger | Return to owning list; profile stays inline; stock stays in inventory context | Full authorized role flow, failure recovery and list restoration |

Table selection and bulk operations are not implemented; do not add selection checkboxes that promise actions. No toast system is shipped. Current success feedback uses in-context `role="status"`/polite live regions, and failures use shared ErrorState or associated field text. Do not add a screen-local toast queue. If a global toast provider becomes necessary, select one shared owner and extend this map first.

## Component behavior

- **Button:** native action button; known emphasis and intent; hover, focus and pressed treatment; disabled/busy guard. A busy label preserves control dimensions and exposes `aria-busy`. Ordinary navigation should use a real link.
- **Fields:** Input/Select/Textarea own labels, IDs, `aria-invalid`, and existing help/error references. Preserve semantic type, length, step, bounds, and autocomplete. Native Select keeps standard keyboard behavior.
- **Secret fields:** masked by default, with a named show/hide button and correct password-manager semantics. Never block paste.
- **Search:** ToolbarSearch is the repeated owner; header catalog search reuses it. A non-empty field has an explicit accessible clear action that restores focus. Page integrations provide onClear to refresh remote results immediately. Explicit submission is not debounced; live remote search, if added, needs a 300ms debounce. Enter during IME composition does not submit prematurely. Header submission/clear preserves other committed filters on the current catalog route.
- **Textarea:** five initial rows, a 136px minimum, and resize-none. Longer content remains internally scrollable. A future long-form editor may use an explicit expansion variant instead of making adjacent controls move.
- **Table/list:** native read-oriented table; meaningful accessible name, column headers and text status. Keep comparison columns through horizontal scrolling. Navigable records expose a real link or named button; row-click enhancement cannot be the only access path.
- **Modal:** shared Modal and `useDialogFocus` own portal placement, focus containment/restoration, background isolation, Escape, and scroll lock. Keep all actions reachable at narrow/short viewports.

## Dataset navigation

The existing catalog and order endpoints return complete arrays without page/cursor parameters. Do not pretend to have server pagination or a known partial total. Bounded client-side pagination over a complete fetched result is the interim strategy for operational lists. A future server paging contract must replace that data strategy explicitly.

Customer product discovery uses 12 records per page. Keep that behavior rather than introducing infinite scrolling. `client/src/components/ui/Pagination.jsx` owns the shared controls and result range; operational lists default to 20. `client/src/hooks/useListState.js` owns committed URL filters and paging, and `client/src/utils/listState.mjs` owns safe slicing/clamping. The page migration is being completed separately; source ownership does not establish finished browser coverage. Dashboard snapshots remain deliberately bounded previews with a link to the full owning list.

Committed search, supported filters, and page belong in URL search parameters so refresh and Back restore the result set. Fixed page size is the current policy; if a page-size control or sort is added, its committed value must also be restorable. Unsubmitted search text may remain local. Sensitive account/profile fields never belong in URLs. Reset or clamp a page when filtering or deletion reduces the number of valid pages. Do not clamp a restored page before the initial dataset finishes loading. Distinguish an empty dataset from no matches, and offer a relevant creation or clear-filter action.

The browser document owns page scrolling. Individual wide tables own horizontal overflow. Do not constrain a shared shell or form to viewport height to make a table fill space. Retain a stable table frame/header and useful content during refresh where possible.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create product | Create product | Stable busy action; fields disabled | Role's product list, preserving valid list state | Product created, after API confirmation | Keep entered values; field/form error | Owning list heading or created record | ProductForm; product.service.js |
| Edit product | Save changes | Stable busy action; fields disabled | Role's product list | Changes saved, after API confirmation | Keep values and editing context | Updated record or list heading | ProductForm; product-payload.test.mjs |
| Delete product | Delete | Confirmation action busy; dialog remains open | Current valid product page | Product deleted | Keep confirmation open with retry/cancel | Next record or table heading | productService.js deleteProduct; AdminProducts |
| Stock adjustment | Apply adjustment | Dialog remains open; duplicate submit blocked | Same inventory context; refetch values | Updated stock after API confirmation | Preserve delta/reason with correction or retry | Initiating product action | StockAdjustModal; stock.service.js |
| Place order | Place order | Stable busy action; cart editing blocked | Created order detail | Show server-confirmed order identity/status | Keep cart; distinguish timeout uncertainty | Order detail heading | CustomerCart; order.service.js |
| Change order status | Save status | Owning dialog/action remains busy | Same order context | Server-confirmed status | Preserve selected order and inline error | Order status context | AdminOrders; SupplierOrders |
| Edit profile | Save profile | Fields/action busy | Same profile page | Profile updated | Preserve safe values; field/form error | Relevant field or success region | ProfilePage; user.service.js |
| Search/filter | Apply filters | Stable results region; ignore old responses | Same route with committed query | Result count | Keep query; retry/clear filters | Input or results heading | ToolbarSearch; catalog pages |
| Cancel/back | Cancel; Back to catalog | No mutation | Actual owning context | None required | Dirty form needs an app-owned discard choice | Originating context | ProductForm; role routes |

Product edits omit quantity, preserving inventory changed since the form opened. Stock changes require a nonzero whole-number delta and a reason. Customer orders are placed only after stock-aware quantity checks; the server remains authoritative. The documented server concurrency and status-transition limits still apply. Do not add automatic retries to inventory or order mutations.

## Navigation and responsive behavior

`main.jsx` creates the browser data router and renders RouterProvider, enabling router-aware navigation blocking. `App.jsx` owns the role route tree and route titles. Titles use “Page · StockFlow” and should distinguish detail/edit, loading, not-found, and access-denied contexts when applicable. The account's verified role determines its workspace; sign-in no longer presents a pseudo role selector.

Unauthenticated visits go to sign-in with an internal return context. Login accepts that return destination only under the verified role's own path prefix and rejects backslashes; otherwise it uses the role home. ProtectedRoute explains an authenticated wrong-role boundary and links to the person's allowed workspace. These frontend changes do not alter server authentication or authorization.

Use breadcrumbs only for actual hierarchy, with a labeled navigation region, linked parent, and `aria-current="page"` on the current item. Avoid decorative operational labels that imply unsupported warehouses, dispatch tracking, or security administration.

Desktop navigation retains the collapse preference. Mobile navigation is a modal drawer with focus containment, close action, inert background, Escape, and focus restoration. Selecting a route closes it. Important data wraps or remains available through an explicit detail path, rather than hover-only text. Data tables may scroll horizontally; do not silently hide actions on mobile.

AppShell focuses the main content on route navigation. Focus must remain visible below the fixed header and inside a dialog's reachable area. A responsive layout change must not steal focus or discard entered data.

## Overlays and feedback

Use Modal/ConfirmModal instead of browser alert, confirm, or prompt. Product deletion is permanent when the API allows it; name the product and consequence and offer Cancel before the destructive action. No undo may be promised without a restore API. Keep errors inside the owning confirmation or form until resolved.

For short recoverable operations, acknowledge success in the existing page context. Critical errors persist and include a recovery action; they do not auto-dismiss. Color is supplemental to text. Announce routine updates politely and reserve assertive announcements for action-blocking errors.

Existing layers are fixed header 40, navigation drawer 50, modal 80, and skip link 100. Keep modal content above navigation and do not create arbitrary feature-local z-index values. Tooltips may supplement labels but cannot hide required instructions or values.

Dirty product/profile forms use `client/src/components/UnsavedChangesGuard.jsx` with `client/src/hooks/useUnsavedChanges.ts`. The hook uses the data router's useBlocker for pathname/query changes and a narrow beforeunload handler for actual document exit. The app-owned confirmation offers staying or discarding. ProductForm/Profile compare current values with their loaded baseline; protection is inactive while loading/saving to allow confirmed save navigation. Browser verification must cover discard, keep editing, successful save, and actual exit behavior before claiming the flow verified.

## Async and resilience

Inventory, order, account, deletion, and external-notification mutations are pessimistic: success is shown only after the service confirms it. Prevent duplicate submit. Existing endpoints do not expose idempotency keys, version/ETag conflict controls, or an operation-status API. Do not invent automatic rollback, offline write queues, or certainty after an ambiguous timeout.

The API client has a 15-second timeout. On safe read failures, offer explicit Retry. Preserve form values and dialog context after mutation errors. Refetch authoritative stock/order data before a retry when the earlier request may have completed; explain uncertainty where the API cannot resolve it. No automatic payment, dispatch, or notification retry is implied.

Cancel superseded reads or check request versions before committing data or clearing a newer loading state. Treat browser online status as a hint; only actual API responses establish reachability. A health indicator describes the API response, not synchronization of every record.

AuthContext/storage own session restoration, remembered versus tab-only sessions, logout, account replacement, and invalidated-response checks. Existing tests protect cross-tab identity boundaries. Handle 401 through the established expiry flow; do not keep another account's supplier or cart context. A 403 requires an access explanation and a permitted next step.

There is no autosave or persistent form-draft service. Do not store passwords, keys, or sensitive forms in local storage. Agent API keys and n8n credentials remain outside the browser bundle. Generated advice must be labeled and grounded in authorized records; no UI may display a successful action merely because an agent proposed it.

## Validation

The field owner is `components/ui/Input.tsx`, including PasswordInput and its reveal action. Service serializers already validate inventory bounds and safe payloads. Reuse those constraints; do not fork them in a new form library.

`utils/formValidation.ts` provides shared required/format/length/numeric constraint checks, first-invalid focus, and stale field-error clearing. It leaves domain checks in the maintained service/workflow and never calls reportValidity. Login, registration, ProductForm, and Profile consume it with noValidate. The stock/filter-form migration is tracked separately; a form must not disable browser validation without implementing its application-owned checks.

Validate on submit; then clear or update errors as affected fields change. Associate each field error with its label/control through aria-invalid and aria-describedby. Keep a form-level summary for network or authentication failures. Preserve non-sensitive input, focus the first correction, and block duplicate submission. Keep correct autocomplete and constraint metadata for keyboards and password managers.

Authentication needs required email/password checks. Registration also requires name, supported self-registration role, matching passwords, and the declared 12–72 character password boundary. Profile validates name/email. Product/stock forms retain existing safe integer, price, category, supplier-ownership, and reason constraints. Do not relax server or service checks to make the UI accept a value.

## Permission and sensitive values

Show only authorized role navigation and actions. A supplier without a linked profile receives a clear limitation before owned requests are issued. Shared/supplier-order safeguards stay in place; frontend hiding is not a substitute for server authorization.

Never include keys, bearer tokens, webhook URLs, passwords, or stored password hashes in DOM labels, routes, logs, status messages, screenshots, or committed documentation. A copy action, if added, needs explicit intent and a generic acknowledgement that does not echo the secret. The current product has no general-purpose secret clipboard interface.

## Migration status

Implemented in source: flat shared surfaces; readable table headers and explicit row actions; stable busy-button geometry; shared search clear; global scrollbars and targeted reduced motion; corrected font loading; simpler login/registration; shared form validation and PasswordInput; product/profile dirty-state guards; data-router integration; explicit wrong-role guidance; a compact operator automation overview. Operational lists and the customer catalog use bounded pagination and URL-restored committed filters/pages. Product and customer order detail navigation preserves the owning list context.

Remaining integration work: finish paging/filter and stock-form migration, preserve destructive dialogs on failure throughout touched flows, reconcile any unused legacy breadcrumb props, and verify the complete workflows in the browser. Account-review agent setup/execution evidence belongs to the automation task; a frontend description alone does not verify a working n8n agent.

Track final completion in the task's TODO and verification record. Do not preserve old duplicate controls as permanent variants. Remove unused imports and obsolete code after migrating their consumers. These changes preserve the existing API and schema; scope rollback by coherent UI slice.

## Verification

Run from the repository root: npm run typecheck; npm run lint --workspace client; npm test --workspace client; npm run build. The commands and canonical ownership are recorded in premium-ui.json. Run the frontend-design-premium project audit in strict mode against the repository root and retain the JSON report in ignored local verification output. An audit pass is static evidence only.

Browser review must cover each changed role path on desktop and a narrow phone viewport: success, loading, empty/no matches, error/retry, keyboard, native select opened, long identifiers, navigation, focus, and reduced motion. Include mutation failure recovery and form validation. Preserve useful images and accessible image failure states. Check console errors after a clean reload.

The existing tests cover session/storage boundaries, cart logic, product payload safety, and safe list-page restoration/clamping. They do not establish full browser CRUD or WCAG compliance. No full-flow browser evidence is declared in the manifest until it is actually recorded. Compare administrator/supplier product editing and administrator/supplier inventory as sibling workflows. Run the final design detector once on changed UI after implementation and use bounded desktop/mobile inspection passes.

Integrated verification passed on 15 October 2026: typecheck, lint, 22 client tests, production build, and strict ownership audit with zero findings. Desktop/phone read, validation, navigation, scope, and recovery checks are recorded in [the verification report](docs/VERIFICATION-2026-10-15.md), including the limits of mutation and accessibility coverage. The exact strict audit command from the repository root is `python 'C:/Users/Junaid/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py' 'C:/Github/StockFlow' --mode strict --output '.local/premium-audit.json'`. The skill path is local tooling, not a project dependency; use the installed skill location on another machine.
