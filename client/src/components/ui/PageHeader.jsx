import { Icon } from "./Icon";

export function UnavailableState({ title, message }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-2xl flex flex-col items-center text-center gap-space-sm">
      <div className="w-12 h-12 rounded-xl bg-surface-container-high text-secondary flex items-center justify-center">
        <Icon name="hub" size={22} />
      </div>
      <h3 className="font-headline-md text-headline-md text-on-surface">{title}</h3>
      <p className="font-body-sm text-body-sm text-on-surface-variant max-w-lg">{message}</p>
    </div>
  );
}

export function PageHeader({ breadcrumb, title, badge, description, actions }) {
  return (
    <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md bg-surface-container-lowest p-space-lg rounded-xl border border-outline-variant">
      <div className="min-w-0">
        {breadcrumb ? (
          <div className="flex items-center gap-space-xs font-mono-data text-label-sm text-outline mb-1">
            {breadcrumb}
          </div>
        ) : null}
        <div className="flex items-center gap-space-sm flex-wrap">
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">{title}</h1>
          {badge}
        </div>
        {description ? <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center flex-wrap gap-space-sm shrink-0">{actions}</div> : null}
    </section>
  );
}

export function ToolbarSearch({ value, onChange, placeholder = "Search…", label = "Search records" }) {
  return (
    <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
      <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" size={18} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        aria-label={label}
        className="w-full h-10 pl-8 pr-space-sm bg-surface-container-lowest rounded-lg border border-slate-300 font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:border-secondary"
      />
    </div>
  );
}
