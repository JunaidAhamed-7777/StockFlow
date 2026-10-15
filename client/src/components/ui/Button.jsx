const variants = {
  primary:
    "bg-secondary hover:bg-secondary-container active:bg-blue-800 text-on-secondary",
  dark: "bg-primary hover:bg-slate-800 active:bg-slate-900 text-on-primary",
  ghost:
    "bg-surface-container hover:bg-surface-container-high active:bg-surface-dim text-on-surface",
  outline:
    "bg-surface-container-lowest hover:bg-surface-container-low active:bg-surface-container-high text-on-surface border border-outline-variant",
  danger: "bg-error hover:bg-red-800 active:bg-red-900 text-on-error",
};

export function Button({
  children,
  variant = "primary",
  className = "",
  type = "button",
  disabled,
  loading,
  icon,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`relative min-h-10 px-4 py-2 rounded-lg font-label-md text-label-md inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${className}`}
      {...props}
    >
      <span className={`inline-flex items-center justify-center gap-2 ${loading ? "opacity-0" : ""}`}>{icon}{children}</span>
      {loading ? <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center"><span className="material-symbols-outlined text-base animate-spin">progress_activity</span></span> : null}
    </button>
  );
}
