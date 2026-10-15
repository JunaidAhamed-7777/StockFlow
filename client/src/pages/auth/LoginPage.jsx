import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import logo from "../../assets/logo.svg";
import { useAuth } from "../../context/AuthContext";
import { useApiHealth } from "../../hooks/useApiHealth";
import { getErrorMessage } from "../../utils/errors";
import { portalHome } from "../../utils/roles";
import { clearFieldError, focusFirstError, validateForm } from "../../utils/formValidation";
import { Button } from "../../components/ui/Button";
import { Input, PasswordInput } from "../../components/ui/Input";

export function LoginPage() {
  const { login, isAuthenticated, role } = useAuth();
  const apiHealth = useApiHealth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function destination(userRole) {
    const requested = location.state?.from;
    return typeof requested === "string" && requested.startsWith("/" + String(userRole).toLowerCase() + "/") && !requested.includes("\\") ? requested : portalHome(userRole);
  }

  if (isAuthenticated) return <Navigate to={destination(role)} replace />;

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const errors = validateForm(event.currentTarget);
    setFieldErrors(errors);
    if (Object.keys(errors).length) { focusFirstError(event.currentTarget, errors); return; }
    setSaving(true);
    setError("");
    try {
      const user = await login(email.trim(), password, trust);
      navigate(destination(user.role), { replace: true });
    } catch (err) {
      setError(err?.response?.status === 401 ? "Email or password is incorrect. Check your details and try again." : getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface text-on-surface px-space-base py-12 sm:py-20">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <img src={logo} alt="" className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">StockFlow</span>
        </div>
        <section aria-labelledby="sign-in-title" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-xl sm:p-8">
          <h1 id="sign-in-title" className="font-headline-lg text-headline-lg">Sign in</h1>
          <p className="mt-2 mb-7 text-on-surface-variant">Access your inventory, products and orders.</p>
          {location.state?.registered ? <p role="status" className="mb-5 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-space-md">Account created. Sign in with your new credentials.</p> : null}
          {apiHealth === "down" ? <p role="status" className="mb-5 text-sm text-error">StockFlow is currently unreachable. Check that the application is running, then try again.</p> : null}
          <form noValidate className="flex flex-col gap-5" onSubmit={onSubmit} aria-busy={saving}>
            <Input id="email" name="email" label="Email address" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} disabled={saving} required value={email} error={fieldErrors.email}
              onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => clearFieldError(current, "email")); }} />
            <PasswordInput id="password" name="password" label="Password" autoComplete="current-password" disabled={saving} required value={password} error={fieldErrors.password}
              onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => clearFieldError(current, "password")); }} />
            <label className="flex items-start gap-2.5 cursor-pointer text-sm text-on-surface-variant">
              <input type="checkbox" disabled={saving} checked={trust} onChange={(event) => setTrust(event.target.checked)} className="mt-0.5 h-4 w-4 accent-secondary" />
              Keep me signed in on this private device
            </label>
            {error ? <p role="alert" className="font-body-sm text-error">{error}</p> : null}
            <Button type="submit" className="w-full" loading={saving}>Sign in</Button>
          </form>
          <p className="mt-6 pt-6 border-t border-outline-variant text-sm text-on-surface-variant">New to StockFlow? <Link className="font-semibold text-secondary hover:underline underline-offset-4" to="/register">Create an account</Link></p>
        </section>
      </div>
    </main>
  );
}
