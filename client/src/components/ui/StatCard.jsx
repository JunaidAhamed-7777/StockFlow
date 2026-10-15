import { Icon } from "./Icon";

export function StatCard({ label, value, hint, icon, tone }) {
  return (
    <div className="min-w-0 bg-surface-container-lowest p-space-lg rounded-xl border border-outline-variant flex flex-col justify-between gap-space-sm">
      <div className="flex items-start justify-between gap-space-sm">
        <div className="flex flex-col min-w-0">
          <span className="font-body-sm text-body-sm text-on-surface-variant">{label}</span>
          <span className={`font-display text-display tabular-nums mt-space-xs ${tone === "danger" ? "text-error" : "text-on-surface"}`}>
            {value ?? "—"}
          </span>
        </div>
        {icon ? (
          <span className="pt-0.5 text-on-surface-variant shrink-0">
            <Icon name={icon} size={18} />
          </span>
        ) : null}
      </div>
      {hint ? <p className="font-caption text-caption text-on-surface-variant">{hint}</p> : null}
    </div>
  );
}
