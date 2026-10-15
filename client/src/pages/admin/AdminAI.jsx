import { useState } from "react";
import { Link } from "react-router-dom";
import { getForecast, getRecommendations, getStockout } from "../../services/ai.service";
import { getErrorMessage, isNotImplemented } from "../../utils/errors";
import { PageHeader } from "../../components/ui/PageHeader";
import { UnavailableState } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import { ErrorState } from "../../components/ui/ErrorState";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";

const WORKFLOWS = [
  { title: "Critical stock alerts", icon: "notifications_active", schedule: "Every 15 minutes", description: "Groups products by their stock owner when quantity reaches zero or half the product's reorder threshold. Successful alerts have a 24-hour cooldown, with immediate out-of-stock escalation." },
  { title: "Daily inventory digest", icon: "inventory_2", schedule: "Daily · 09:00 IST", description: "Summarizes each owner's inventory and products at or below their reorder threshold. One digest per owner per day." },
  { title: "Open order follow-up", icon: "local_shipping", schedule: "Daily · 10:00 IST", description: "Flags pending or processing orders open for at least 48 hours. Each owner receives only the lines for their own products." },
];

async function probe(label, fn) {
  try {
    const data = await fn();
    return { label, status: "ready", data };
  } catch (error) {
    return {
      label,
      status: isNotImplemented(error) ? "unavailable" : "error",
      message: getErrorMessage(error),
    };
  }
}

export function AdminAI() {
  const [results, setResults] = useState([]);
  const [checking, setChecking] = useState(false);

  async function checkAI() {
    if (checking) return;
    setChecking(true);
    try {
      setResults(await Promise.all([probe("Forecast", getForecast), probe("Stockout prediction", getStockout), probe("Recommendations", getRecommendations)]));
    } finally { setChecking(false); }
  }

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Core</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">AI Forecasting</span></>}
        title="Automations & AI"
        description="Keep owners informed with inventory rules. Review AI availability separately."
        badge={
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container text-secondary text-label-sm">
            <Icon name="hub" size={14} /> Local n8n
          </span>
        }
        actions={<a href="http://localhost:5678/home/workflows" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-space-sm h-10 rounded-lg border border-outline-variant px-space-md text-sm font-semibold text-secondary hover:bg-surface">Open local n8n<Icon name="open_in_new" size={16} /></a>}
      />
      <Card className="p-space-lg space-y-space-sm">
        <div className="flex items-center gap-space-sm flex-wrap"><h2 className="text-lg font-semibold">Owner notification workflows</h2><Badge tone="warning">Gmail setup required</Badge></div>
        <p className="text-sm text-on-surface-variant">These workflows use recorded stock and order data with no OpenAI calls. Delivery starts in preview mode. Connect Gmail in n8n and enable delivery after reviewing real supplier email addresses.</p>
        <p className="text-xs text-on-surface-variant">Workflow definitions and schedules are shown here. Live execution and connection status are available in n8n.</p>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-space-base">
        {WORKFLOWS.map((workflow) => <Card key={workflow.title} className="p-space-lg flex flex-col gap-space-md"><Icon name={workflow.icon} className="text-secondary" size={24} /><h2 className="font-semibold">{workflow.title}</h2><p className="text-xs font-semibold text-secondary">{workflow.schedule}</p><p className="text-sm text-on-surface-variant">{workflow.description}</p><Badge>Rule-based · no AI cost</Badge></Card>)}
      </div>
      <Card className="p-space-lg flex flex-col sm:flex-row justify-between gap-space-md sm:items-center"><div><h2 className="font-semibold">Review reorder thresholds</h2><p className="text-sm text-on-surface-variant">Alert rules depend on each product's current quantity and threshold.</p></div><Link to="/admin/inventory" className="text-sm font-semibold text-secondary hover:underline">Open inventory →</Link></Card>
      <UnavailableState
        title="AI forecasting is not connected"
        message="Demand forecasts and AI recommendations are not implemented by the current API. No predictions are generated or displayed. Local stock notifications can work independently."
      />
      <div><Button variant="outline" onClick={checkAI} loading={checking}>Check AI service availability</Button></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-space-base" aria-live="polite" aria-busy={checking}>
        {results.map((item) => (
          <Card key={item.label} className="p-space-lg space-y-space-sm">
            <div className="flex items-center gap-space-sm">
              <Icon name="psychology" className="text-secondary" />
              <h2 className="font-headline-sm">{item.label}</h2>
            </div>
            <p className="font-body-sm text-on-surface-variant">{item.message || "Service responded. Forecast rendering requires a supported result format."}</p>
            {item.status === "error" ? <ErrorState message={item.message} /> : null}
            <p className="font-caption uppercase tracking-wider text-outline">{item.status}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
