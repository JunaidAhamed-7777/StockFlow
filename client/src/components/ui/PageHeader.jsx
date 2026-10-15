import { useRef } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

export function UnavailableState({ title, message }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-xl flex items-start gap-space-md">
      <Icon name="info" size={20} className="text-on-surface-variant shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-space-xs">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-3xl">{message}</p>
      </div>
    </div>
  );
}

export function PageHeader({ breadcrumbs = [], title, badge, description, actions }) {
  return (
    <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-base py-space-xs">
      <div className="min-w-0">
        {breadcrumbs.length ? (
          <nav aria-label="Breadcrumb" className="mb-space-sm">
            <ol className="flex flex-wrap items-center gap-space-xs text-sm text-on-surface-variant">
              {breadcrumbs.map((item, index) => (
                <li key={item.to || `${item.label}-${index}`} className="inline-flex items-center gap-space-xs">
                  {index > 0 ? <Icon name="chevron_right" size={14} /> : null}
                  {item.to && index !== breadcrumbs.length - 1 ? <Link to={item.to} className="hover:text-secondary hover:underline underline-offset-4">{item.label}</Link> : <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="flex items-center gap-space-sm flex-wrap">
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">{title}</h1>
          {badge}
        </div>
        {description ? <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xs max-w-3xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center flex-wrap gap-space-sm shrink-0">{actions}</div> : null}
    </section>
  );
}

export function ToolbarSearch({ value, onChange, onClear, placeholder = "Search…", label = "Search records", disabled = false, maxLength = 200 }) {
  const inputRef = useRef(null);

  function clearSearch() {
    onChange("");
    onClear?.();
    inputRef.current?.focus();
  }

  return (
    <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
      <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" size={18} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
        }}
        placeholder={placeholder}
        type="search"
        disabled={disabled}
        maxLength={maxLength}
        aria-label={label}
        className="w-full h-10 pl-8 pr-10 bg-surface-container-lowest rounded-lg border border-slate-300 font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:border-secondary disabled:bg-surface-container-low disabled:cursor-not-allowed"
      />
      {value ? <button type="button" disabled={disabled} onClick={clearSearch} aria-label={`Clear ${label.toLowerCase()}`} className="absolute right-0 top-0 h-10 w-10 inline-flex items-center justify-center rounded-r-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface disabled:cursor-not-allowed"><Icon name="close" size={18} /></button> : null}
    </div>
  );
}
