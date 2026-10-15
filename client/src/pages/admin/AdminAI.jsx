import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import { Table } from "../../components/ui/Table";

const AGENTS = [
  { id: "admin", name: "Admin Notification", account: "StockFlow Local Automation", schedule: "Daily, 09:15", purpose: "Inventory exceptions, open orders, and a prioritized review list." },
  { id: "supplier", name: "Supplier Assistant", account: "Supplier Test", schedule: "Weekdays, 09:30", purpose: "The account’s own products, order lines, and replenishment drafts." },
  { id: "customer", name: "Customer Assistant", account: "Customer Test", schedule: "Mondays, 10:00", purpose: "The account’s order history, available products, and reorder drafts." },
];

const WORKFLOWS = [
  { id: "critical", name: "Critical stock alerts", schedule: "Every 15 minutes", delivery: "Enabled at setup", purpose: "Posts to Discord when stock reaches zero or half its reorder threshold." },
  { id: "digest", name: "Inventory digest", schedule: "Daily, 09:00", delivery: "Preview", purpose: "Groups inventory totals and low-stock products by owner." },
  { id: "follow-up", name: "Open order follow-up", schedule: "Daily, 10:00", delivery: "Preview", purpose: "Flags pending or processing orders open for at least 48 hours." },
  { id: "audit", name: "Inventory data audit", schedule: "Mondays, 09:30", delivery: "Preview", purpose: "Reports missing ownership, invalid values, and catalog inconsistencies." },
  { id: "updates", name: "Order updates", schedule: "Every 15 minutes", delivery: "Preview", purpose: "Reports new orders and observed status changes after an initial baseline." },
];

const agentColumns = [
  { key: "name", header: "Agent", render: row => <span className="font-semibold">{row.name}</span> },
  { key: "account", header: "StockFlow account" },
  { key: "schedule", header: "Schedule · IST" },
  { key: "purpose", header: "Review" },
];
const workflowColumns = [
  { key: "name", header: "Workflow", render: row => <span className="font-semibold">{row.name}</span> },
  { key: "schedule", header: "Schedule · IST" },
  { key: "delivery", header: "Delivery at setup" },
  { key: "purpose", header: "Purpose" },
];

export function AdminAI() {
  return (
    <>
      <PageHeader
        title="Automations"
        description="Scheduled stock checks and account reviews, managed in local n8n."
        actions={<a href="http://localhost:5678/assistant" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-space-sm rounded-lg bg-secondary px-space-md text-sm font-semibold text-white hover:bg-secondary-container">Open n8n<Icon name="open_in_new" size={16} /></a>}
      />
      <section aria-labelledby="agents-heading" className="space-y-space-md">
        <div><h2 id="agents-heading" className="text-lg font-semibold">Account review agents</h2><p className="mt-1 max-w-3xl text-sm text-on-surface-variant">GPT-5 mini prepares reviews and drafts from verified records. Each agent is bound to the account below; it does not act as the person currently signed in to StockFlow. Changes are applied through the relevant StockFlow screen.</p></div>
        <Card><Table columns={agentColumns} rows={AGENTS} caption="Account review agents" /></Card>
        <p className="text-sm text-on-surface-variant">Budget guardrails: $3 per agent each month and $0.10 per session. Reviews appear in the agent’s n8n sessions. These limits are checked between model calls.</p>
      </section>
      <section aria-labelledby="notifications-heading" className="space-y-space-md">
        <div><h2 id="notifications-heading" className="text-lg font-semibold">Discord notifications</h2><p className="mt-1 max-w-3xl text-sm text-on-surface-variant">Posts go to one configured channel and identify the intended stock owner. These stock rules run without model calls. Preview workflows calculate results without posting.</p></div>
        <Card><Table columns={workflowColumns} rows={WORKFLOWS} caption="Inventory notification workflows" /></Card>
        <p className="text-sm text-on-surface-variant">Channel members can see posted inventory and owner details. Stock owners receive no direct messages or email.</p>
      </section>
      <Card className="p-space-lg flex flex-col sm:flex-row justify-between gap-space-md sm:items-center">
        <div><h2 className="font-semibold">Keep reorder thresholds current</h2><p className="mt-1 text-sm text-on-surface-variant">Alerts use each product’s recorded quantity and threshold. Demand forecasting is not available.</p></div>
        <Link to="/admin/inventory" className="inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold text-secondary hover:underline">Review inventory<Icon name="arrow_forward" size={16} className="ml-2" /></Link>
      </Card>
      <p className="text-xs text-on-surface-variant">Setup summary recorded 15 October 2026. Open n8n for current schedules, delivery settings, and execution history. Local services must be running for scheduled tasks to execute.</p>
    </>
  );
}
