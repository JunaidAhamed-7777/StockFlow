export function Card({ children, className = "" }) {
  return (
    <div className={`min-w-0 bg-surface-container-lowest rounded-xl border border-outline-variant ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, icon, action, subtitle }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-space-md px-space-lg py-space-base border-b border-outline-variant">
      <div className="flex items-center gap-space-sm min-w-0">
        {icon}
        <div className="min-w-0">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
          {subtitle ? <p className="font-body-sm text-body-sm text-on-surface-variant">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}
