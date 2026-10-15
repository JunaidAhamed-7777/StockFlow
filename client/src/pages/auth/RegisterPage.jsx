import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "../../assets/logo.svg";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import { clearFieldError, focusFirstError, validateForm } from "../../utils/formValidation";
import { Button } from "../../components/ui/Button";
import { Input, PasswordInput, Select } from "../../components/ui/Input";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", role: "CUSTOMER", password: "", confirmPassword: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => clearFieldError(current, key));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const errors = validateForm(event.currentTarget);
    if (!["CUSTOMER", "SUPPLIER"].includes(form.role)) errors.role = "Select a customer or supplier account.";
    if (!errors.password && form.password !== form.confirmPassword) errors.confirmPassword = "Passwords do not match.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { focusFirstError(event.currentTarget, errors); return; }
    setSaving(true);
    setError("");
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role });
      navigate("/login", { replace: true, state: { registered: true } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface text-on-surface px-space-base py-10 sm:py-14">
      <div className="mx-auto w-full max-w-lg">
        <Link to="/login" className="mb-7 flex w-fit mx-auto items-center gap-3 rounded hover:text-secondary">
          <img src={logo} alt="" className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">StockFlow</span>
        </Link>
        <section aria-labelledby="registration-title" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-xl sm:p-8">
          <h1 id="registration-title" className="font-headline-lg text-headline-lg">Create your account</h1>
          <p className="mt-2 mb-7 text-on-surface-variant">Choose the workspace you need to manage products or place orders.</p>
          <form noValidate onSubmit={onSubmit} aria-busy={saving} className="flex flex-col gap-5">
            <Input id="name" name="name" autoComplete="name" maxLength={100} disabled={saving} label="Full name" value={form.name} error={fieldErrors.name} onChange={(event) => setField("name", event.target.value)} required />
            <Input id="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} disabled={saving} label="Email address" type="email" value={form.email} error={fieldErrors.email} onChange={(event) => setField("email", event.target.value)} required />
            <Select id="role" name="role" label="Account type" disabled={saving} value={form.role} error={fieldErrors.role} onChange={(event) => setField("role", event.target.value)} required>
              <option value="CUSTOMER">Customer</option>
              <option value="SUPPLIER">Supplier</option>
            </Select>
            {form.role === "SUPPLIER" ? <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-space-md">An administrator must link a supplier profile before you can add products or manage stock.</p> : null}
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={12} maxLength={72} hint="Use a unique passphrase of 12–72 characters." disabled={saving} label="Password" value={form.password} error={fieldErrors.password} onChange={(event) => setField("password", event.target.value)} required />
            <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={72} disabled={saving} label="Confirm password" value={form.confirmPassword} error={fieldErrors.confirmPassword} onChange={(event) => setField("confirmPassword", event.target.value)} required />
            {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
            <Button type="submit" loading={saving}>Create account</Button>
          </form>
          <p className="mt-6 pt-6 border-t border-outline-variant text-sm text-on-surface-variant">Already have an account? <Link to="/login" className="font-semibold text-secondary hover:underline underline-offset-4">Sign in</Link></p>
        </section>
      </div>
    </main>
  );
}
