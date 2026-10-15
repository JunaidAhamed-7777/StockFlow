---
version: alpha
name: StockFlow
description: Inventory operations with a shared slate and cobalt visual system for administrators, suppliers, and customers.
colors:
  canvas: "#F8FAFC"
  panel: "#FFFFFF"
  subtle: "#F1F5F9"
  border: "#E2E8F0"
  border-strong: "#CBD5E1"
  ink: "#0F172A"
  text-secondary: "#475569"
  muted: "#64748B"
  primary: "#2563EB"
  cobalt-hover: "#1D4ED8"
  selected: "#EFF6FF"
  selected-text: "#1E40AF"
  danger: "#B91C1C"
  danger-surface: "#FEF2F2"
  danger-text: "#991B1B"
  warning-surface: "#FFFBEB"
  warning-text: "#92400E"
  success-surface: "#ECFDF5"
  success-text: "#065F46"
typography:
  sans:
    fontFamily: '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: "1.5"
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    fontSize: "12px"
    lineHeight: "1.5"
rounded:
  DEFAULT: "0.25rem"
  lg: "0.375rem"
  xl: "0.5rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  base: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
  2xl: "2rem"
  header: "3.5rem"
  sidebar: "15rem"
  dense-row: "2.5rem"
  default-row: "2.75rem"
components:
  page:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.sans}"
  button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel}"
    rounded: "{rounded.lg}"
  button-hover:
    backgroundColor: "{colors.cobalt-hover}"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  field-disabled:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.text-secondary}"
  table:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  table-header:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.text-secondary}"
  metadata:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  navigation-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-text}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.panel}"
  status-danger:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger-text}"
  status-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning-text}"
  status-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success-text}"
---

# StockFlow design system

## Overview

StockFlow is an inventory workspace for people managing products, stock adjustments, and orders. Its visual reference is an operations ledger: readable identifiers, aligned quantities, explicit status, and actions next to the records they affect. This is an operating application; task clarity and consistency lead.

The established identity is preserved: Hanken Grotesk, slate surfaces, cobalt actions, compact tables, and crisp borders. The recognizable detail is the combination of monospaced SKUs and aligned tabular quantities. It does not need decorative charts, simulated telemetry, a marketing hero inside a workspace, or repeated feature badges.

### Product scope and reference boundary

`client/` is the production frontend. `stitch_stockflow_enterprise_inventory_saas/` contains visual references; its text and illustrated capabilities are not an API specification. The application currently supports:

- Customers: product discovery and details, stock-aware cart, order placement/history, and name/email profile editing.
- Suppliers: owned-product management, stock adjustments, relevant customer orders, and profile editing. A linked supplier record is required for owned operations.
- Administrators: inventory, product ownership, suppliers, customers derived from order history, orders, and profile editing.
- Local n8n: documented notification workflows. Actual activation, credentials, delivery destination, and execution results belong to n8n and the private local configuration.

The existing stock-history and forecasting API routes return HTTP 501. The interface must explain unavailable capabilities without displaying invented records or predictions. The administrator's automation page describes separate n8n account-review agents. They are bound to fixed operator-selected StockFlow accounts; they do not inherit the identity currently signed in to the frontend. Working agent configuration does not implement demand forecasting.

Multi-warehouse allocations, EDI, carrier tracking, trade credit, tax/freight calculations, cryptographic ledgers, SSO, MFA, role administration, and session revocation are not implemented capabilities. Their appearance in earlier Stitch references does not authorize corresponding controls or claims. See [frontend capabilities and backend limits](docs/FRONTEND-LIMITATIONS.md).

The interface is English. Existing monetary formatting is USD with `en-US` formatting; the business market is not inferred from that choice. Operational use is primarily desktop with a functional narrow-screen layout. Japanese locale or market support is not currently specified.

### Token ownership and runtime mapping

The existing runtime tokens remain the executable source, following ownership model B. This document records accepted values and visual intent; it does not generate a second theme. Tailwind v4 loads the established JavaScript adapter through `@config` in `client/src/index.css`.

| Design role | Runtime owner/alias | Shared consumers |
|---|---|---|
| Canvas, white panel, subtle well | `client/tailwind.config.js`: `surface`, `surface-container-lowest`, `surface-container-low` | AppShell, Card, fields, tables |
| Ink and secondary text | `on-surface`, `on-surface-variant`, `outline` | PageHeader, Table, fields |
| Cobalt action and focus | `secondary`, `secondary-container`; base focus rule in `client/src/index.css` | Button, links, active navigation, focus |
| Selected surface and text | `primary-container`, `on-primary-container` | Sidebar, selected context |
| Dark action | `primary`, `on-primary` | Existing Button `dark` variant |
| Danger | `error`, `error-container`, `on-error-container` | Button, ErrorState, Badge, field errors |
| Success/warning | Tailwind emerald/amber palette used by `components/ui/Badge.jsx` | Text-and-color status badges |
| Type, radius, spacing, geometry | `fontFamily`, `fontSize`, `borderRadius`, `spacing` in `client/tailwind.config.js` | Shared primitives and layout |
| Scrollbar states | `--scrollbar-thumb`, `--scrollbar-track`, `--scrollbar-hover`, `--scrollbar-active` in `client/src/index.css` | Every document-owned overflow region |

The structured design token `colors.primary` means the cobalt brand action. The legacy runtime alias `primary` means dark ink; runtime `secondary` means cobalt. The mapping above is intentional: preserve those executable meanings instead of renaming every consumer. New components consume existing semantic aliases. Durable token changes require this document and the owning runtime adapter to change together. Do not copy values into another theme object. Border values remain documented tokens even though the alpha component-token format has no border-color property.

## Colors

Use canvas for page background, white for data panels, and subtle slate for table headers and control wells. Borders define grouping. Cobalt is reserved for primary actions, active navigation, links, and keyboard focus. It is not a decoration on every icon or caption.

Status needs text in addition to color: success for available/completed states, warning for low stock or attention, danger for out of stock or destructive consequences, and neutral for inactive context. Inventory quantity and each product's recorded threshold determine stock status; a badge must not imply a forecast.

Light is the supported theme. Do not present a theme switch without a complete alternative. High-contrast and forced-colors modes must retain visible controls, focus, and usable scrollbars.

## Typography

Use Hanken Grotesk for headings, body, controls, and tables, with the system stack in the token above. Use the monospaced stack only for SKUs, record identifiers, and technical values. Quantities and money use tabular figures and right alignment when compared in columns.

- Page heading: 24px, weight 700, 32px line height.
- Section heading: 16–18px, weight 600, 24–26px line height.
- Body and controls: 14px, 21–22px line height.
- Labels and metadata: 12px, 18px line height.
- Principal metric: approximately 30–32px, weight 700; use only for meaningful recorded measures.

Use sentence case for labels and actions. Reserve uppercase tracking for short navigation group labels or compact column headers where it helps scanning. Do not apply it to ordinary help, loading messages, or paragraphs. Keep descriptive copy to a readable measure. Do not introduce a display font into application controls.

## Layout

Use the existing 4px-based spacing vocabulary: 4, 8, 12, 16, 20, 24, and 32px. The header is 56px; desktop navigation is 240px with a 64px collapsed rail. The navigation becomes a modal drawer below 1024px. The content shell remains fluid with the established 1600px maximum.

Page headings describe the current job and place relevant actions at the same level. Data lives in bordered panels; avoid nesting a heading card, toolbar card, and additional ornamental cards when one grouped panel communicates the task. Keep related filters near their results.

Comparison tables retain native table semantics and horizontal overflow on narrow screens. A table panel may own scrolling; do not give the shared page shell a fixed viewport height to force a table to fit. Forms retain natural document flow. Preserve every action and readable status on mobile.

Reserve image dimensions, loading regions, inline help, and button geometry. Scrollbar gutters and overlay scroll locking must not shift the page. Important focused controls must remain visible below the fixed header and above any sticky actions.

## Elevation & Depth

Borders and tonal surfaces supply the default hierarchy. Shared Card and StatCard are flat, and PageHeader sits directly in the page flow. Keep moderate elevation for account popovers and strong elevation for modal surfaces. Do not add blurred blobs, glow effects, or gradients to operating screens.

## Shapes

The existing radius scale is 4px for small controls, 6px for standard controls, and 8px for larger panels. Fully rounded shapes are limited to avatars and meaningful compact status elements. Icons do not each require a colored tile. Use one-pixel borders except for clear focus or selected treatment.

## Components

`client/src/components/ui/` owns Button, Card, Input/Select/Textarea, Table, Badge, Modal, loading, and empty/error states. Reuse these primitives. Interaction, navigation, validation, and recovery rules are recorded in [UX-CONTRACT.md](UX-CONTRACT.md).

Buttons have one clear primary action per decision area. Secondary actions use outline or quiet treatment. Destructive row actions remain visually separated from ordinary edits; the final irreversible confirmation may use solid danger. A busy button preserves its dimensions, exposes pending state, and blocks duplicate activation.

Tables use 40px headers and approximately 44px rows. Header text uses secondary text on the subtle surface for normal-text contrast. Long values may grow rows instead of overlapping adjacent columns. Use text plus semantic badges, readable column labels, and actual links/buttons for navigable records. Table row-click enhancement has a separate native View button; a focusable table row is not the only action. Empty, no-results, loading, and error states are useful product states and must remain.

Forms use the shared field primitives with visible labels and associated help/errors. Native Select is the accepted platform-owned popup; do not imply its opened geometry is authored. Error text explains the correction. PasswordInput owns masked-by-default fields and their Show/Hide control. Textarea has five initial rows and a 136px minimum with resize-none; longer content remains scrollable without disrupting adjacent controls.

Material Symbols Outlined is the existing icon family. Standard controls use 16–20px icons; larger empty-state icons are permitted. Decorative icons are hidden from assistive technology; icon-only actions need names. Prefer a nearby label over a novel symbol.

Motion communicates opening, loading, or a state change. Keep routine transitions short and interruptible. Do not pulse a generic “live” dot independently of a verified state. The unlayered reduced-motion rules in index.css stop continuous spinner/pulse/ping animations while preserving status text and useful color feedback.

Global scrollbars use a slate thumb on the subtle surface, with darker hover/active states. The baseline applies to new overflow regions automatically and resets to system colors in forced-colors mode. Root scrollbar gutter and scroll padding keep navigation and focus stable. The Hanken font request includes the used 400–700 weights; unused font families are not loaded.

Product copy names the job: “Products”, “Orders”, “Stock”, “Create product”, and “Save changes”. Avoid invented operational jargon, repeated claims of intelligence, feature marketing, or internal setup instructions in a customer's purchasing flow. Keep technical configuration in the administrator's relevant integration context or documentation.

Free illustrative product photographs are presentation metadata mapped by SKU, not proof of a specific manufactured item. Preserve their honest caption/credit and an accessible missing-image state. The earlier requested demonstration records are real local catalog records; this polish does not silently delete them.

## Do's and Don'ts

- **Do:** let identifiers, quantities, ownership, and the next action carry the layout.
- **Do:** distinguish recorded facts, generated advice, configuration documentation, and verified live state.
- **Do:** preserve shared loading, error, empty, and no-results recovery across roles.
- **Don't:** display invented forecasts, percentage gains, carrier events, financial terms, or activation status.
- **Don't:** use fake role selectors, inert controls, perpetual status decoration, or unsupported security claims.
- **Don't:** remove legitimate field examples, honest unavailable states, or image attribution under a blanket “placeholder” cleanup.

### Reconciliation recorded on 15 October 2026

The previous document copied the Stitch concept's capability taxonomy. This revision preserves its slate/cobalt palette, Hanken typography, compact geometry, and restrained elevation while replacing aspirational capability claims with the verified API scope. Shared surface, contrast, font-loading, search, and motion changes now implement that direction in source. Runtime and browser verification of the complete rollout remain separate evidence in UX-CONTRACT.md.
