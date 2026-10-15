import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";

interface FieldDetails {
  label?: ReactNode;
  hint?: string;
  error?: string;
}

const fieldClass = "w-full border border-slate-300 bg-white text-on-surface font-body-sm text-body-sm rounded-lg transition-colors placeholder:text-outline focus:border-secondary disabled:bg-surface-container-low disabled:text-on-surface-variant disabled:cursor-not-allowed";

function FieldHelp({ id, error, hint }: { id: string } & Pick<FieldDetails, "error" | "hint">) {
  if (error) return <p id={`${id}-help`} className="font-caption text-caption text-error" role="alert">{error}</p>;
  if (hint) return <p id={`${id}-help`} className="font-caption text-caption text-on-surface-variant">{hint}</p>;
  return null;
}

export function Input({ label, hint, error, className = "", id, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldDetails) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = [props["aria-describedby"], (hint || error) && `${fieldId}-help`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label ? <label htmlFor={fieldId} className="font-label-sm text-label-sm text-on-surface">{label}</label> : null}
      <input {...props} id={fieldId} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
        className={`h-10 px-3 ${fieldClass} ${error ? "border-error" : ""} ${className}`} />
      <FieldHelp id={fieldId} error={error} hint={hint} />
    </div>
  );
}

export function Textarea({ label, hint, error, className = "", id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldDetails) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = [props["aria-describedby"], (hint || error) && `${fieldId}-help`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label ? <label htmlFor={fieldId} className="font-label-sm text-label-sm text-on-surface">{label}</label> : null}
      <textarea {...props} id={fieldId} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
        className={`min-h-[104px] px-3 py-2 resize-y ${fieldClass} ${error ? "border-error" : ""} ${className}`} />
      <FieldHelp id={fieldId} error={error} hint={hint} />
    </div>
  );
}

export function Select({ label, hint, error, children, className = "", id, ...props }: SelectHTMLAttributes<HTMLSelectElement> & FieldDetails) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = [props["aria-describedby"], (hint || error) && `${fieldId}-help`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label ? <label htmlFor={fieldId} className="font-label-sm text-label-sm text-on-surface">{label}</label> : null}
      <select {...props} id={fieldId} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
        className={`h-10 pl-3 pr-8 cursor-pointer ${fieldClass} ${error ? "border-error" : ""} ${className}`}>
        {children}
      </select>
      <FieldHelp id={fieldId} error={error} hint={hint} />
    </div>
  );
}
