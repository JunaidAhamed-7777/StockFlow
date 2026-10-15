export type FieldErrors = Record<string, string>;

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controls(form: HTMLFormElement): FormControl[] {
  return Array.from(form.elements).filter((element): element is FormControl =>
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
  );
}

/** App-owned feedback using the same semantic constraints as the shared fields. */
export function validateForm(form: HTMLFormElement): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of controls(form)) {
    const key = field.name || field.id;
    if (!key || field.disabled || field.matches(':disabled') || ('readOnly' in field && field.readOnly) || ['submit', 'button', 'hidden', 'reset'].includes(field.type)) continue;
    const label = (field.labels?.[0]?.textContent || key).replace(/\s+/g, ' ').trim().toLowerCase();
    const value = field.value;
    const isSecret = field.type === 'password' || /password/i.test(field.name) || /password/.test(field.autocomplete);
    const empty = isSecret ? value.length === 0 : value.trim().length === 0;
    if (field.required && (empty || (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type) && !field.checked))) errors[key] = `Enter ${label}.`;
    else if (!empty && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) errors[key] = 'Enter a valid email address.';
    else if (field instanceof HTMLInputElement && field.type === 'number' && (!empty || field.validity.badInput)) {
      const number = Number(value);
      if (empty || !Number.isFinite(number)) errors[key] = `Enter a valid ${label}.`;
      else if (field.step === '1' && !Number.isSafeInteger(number)) errors[key] = 'Enter a whole number.';
      else if (field.min !== '' && number < Number(field.min)) errors[key] = `Enter ${field.min} or more.`;
      else if (field.max !== '' && number > Number(field.max)) errors[key] = `Enter ${field.max} or less.`;
      else if (field.validity.stepMismatch) errors[key] = `Use increments of ${field.step || '1'}.`;
    } else if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      if (field.minLength > 0 && value.length < field.minLength) errors[key] = `Use at least ${field.minLength} characters.`;
      else if (field.maxLength > 0 && value.length > field.maxLength) errors[key] = `Use ${field.maxLength} characters or fewer.`;
      else if (field.validity.patternMismatch) errors[key] = `Check the format for ${label}.`;
    }
  }
  return errors;
}

export function focusFirstError(form: HTMLFormElement, errors: FieldErrors): void {
  const first = controls(form).find((field) => errors[field.name || field.id] && !field.disabled);
  if (first) requestAnimationFrame(() => first.focus());
}

export function clearFieldError(errors: FieldErrors, key: string): FieldErrors {
  if (!errors[key]) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}
