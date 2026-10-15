const tones = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-error-container text-on-error-container border-red-200",
  info: "bg-secondary-fixed text-on-secondary-fixed border-secondary-fixed-dim",
  neutral: "bg-surface-container-low text-on-surface-variant border-outline-variant",
};

export function Badge({ children, tone = "neutral", className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-label-sm text-label-sm ${tones[tone] || tones.neutral} ${className}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const value = String(status || "").toUpperCase();
  if (["IN", "IN_STOCK", "IN STOCK"].includes(value)) {
    return <Badge tone="success"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />In Stock</Badge>;
  }
  if (["DELIVERED", "FULFILLED"].includes(value)) {
    return <Badge tone="success"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />{value === "DELIVERED" ? "Delivered" : "Fulfilled"}</Badge>;
  }
  if (["LOW", "LOW_STOCK", "PENDING", "PROCESSING"].includes(value)) {
    const label = value === "PENDING" ? "Pending" : value === "PROCESSING" ? "Processing" : "Low Stock";
    return <Badge tone="warning"><span className="w-1.5 h-1.5 rounded-full bg-amber-600" />{label}</Badge>;
  }
  if (["OUT", "OUT_OF_STOCK", "CANCELLED", "STOCKOUT"].includes(value)) {
    const label = value === "CANCELLED" ? "Cancelled" : "Out of Stock";
    return <Badge tone="danger"><span className="w-1.5 h-1.5 rounded-full bg-error" />{label}</Badge>;
  }
  if (["SHIPPED", "IN_TRANSIT"].includes(value)) {
    return <Badge tone="info"><span className="w-1.5 h-1.5 rounded-full bg-secondary" />Shipped</Badge>;
  }
  return <Badge>{value || "Unknown"}</Badge>;
}

export function OrderStatusBadge({ status }) {
  const value = String(status || "").toUpperCase();
  const map = {
    PENDING: { tone: "warning", label: "Pending" },
    PROCESSING: { tone: "info", label: "Processing" },
    SHIPPED: { tone: "info", label: "Shipped" },
    DELIVERED: { tone: "success", label: "Delivered" },
    CANCELLED: { tone: "danger", label: "Cancelled" },
  };
  const config = map[value] || { tone: "neutral", label: value || "Unknown" };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
