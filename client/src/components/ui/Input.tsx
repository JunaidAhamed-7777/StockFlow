import { useId, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";

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

export function Input({ label, hint, error, className = "", id, endAdornment, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldDetails & { endAdornment?: ReactNode }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = [props["aria-describedby"], (hint || error) && `${fieldId}-help`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label ? <label htmlFor={fieldId} className="font-label-sm text-label-sm text-on-surface">{label}</label> : null}
      <div className="relative">
        <input {...props} id={fieldId} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
          className={`h-10 px-3 ${fieldClass} ${error ? "border-error" : ""} ${endAdornment ? "pr-16" : ""} ${className}`} />
        {endAdornment}
      </div>
      <FieldHelp id={fieldId} error={error} hint={hint} />
    </div>
  );
}

export function PasswordInput({ id, label = "Password", disabled, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & FieldDetails) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const [visible, setVisible] = useState(false);
  const fieldName = typeof label === "string" ? label.toLowerCase() : "password";
  return <Input {...props} id={fieldId} label={label} disabled={disabled} type={visible ? "text" : "password"}
    endAdornment={<button type="button" disabled={disabled} aria-label={`${visible ? "Hide" : "Show"} ${fieldName}`} aria-pressed={visible} aria-controls={fieldId}
      className="absolute right-1 top-1 h-8 min-w-12 px-2 rounded text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={() => setVisible((current) => !current)}>{visible ? "Hide" : "Show"}</button>} />;
}

export function Textarea({ label, hint, error, className = "", id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldDetails) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = [props["aria-describedby"], (hint || error) && `${fieldId}-help`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label ? <label htmlFor={fieldId} className="font-label-sm text-label-sm text-on-surface">{label}</label> : null}
      <textarea {...props} id={fieldId} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy}
        rows={props.rows || 5} className={`min-h-[136px] px-3 py-2 resize-none ${fieldClass} ${error ? "border-error" : ""} ${className}`} />
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
