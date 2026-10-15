import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "../../assets/logo.svg";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import { Icon } from "../../components/ui/Icon";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Input";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "CUSTOMER",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    if (step === 1) {
      if (!form.name.trim()) { setError("Enter your full name."); return; }
      setError("");
      setStep(2);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      navigate("/login", { replace: true, state: { registered: true } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface min-h-screen">
      <div className="w-full bg-surface-container-high px-space-xl py-space-sm flex items-center justify-between">
        <div className="flex items-center gap-space-md">
          <img src={logo} alt="StockFlow" className="h-6 w-6" />
          <span className="font-label-sm">StockFlow account registration</span>
        </div>
        <Link to="/login" className="font-label-sm text-secondary">Back to sign in</Link>
      </div>
      <div className="w-full max-w-4xl mx-auto px-space-xl py-space-2xl flex flex-col gap-space-2xl">
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
            <div className="flex items-center gap-space-md">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${step > 1 ? "bg-surface-container-highest text-secondary" : "bg-primary text-on-primary"}`}>
                {step > 1 ? <Icon name="check" size={16} /> : <span className="font-mono-data text-label-sm">01</span>}
              </div>
              <div>
                <span className="font-caption uppercase tracking-wider text-on-surface-variant">Step 01</span>
                <div className="font-label-md">Organization profile</div>
              </div>
            </div>
            <div className="flex items-center gap-space-md">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${step === 2 ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}>
                <span className="font-mono-data text-label-sm">02</span>
              </div>
              <div>
                <span className="font-caption uppercase tracking-wider text-on-surface-variant">Step 02</span>
                <div className="font-label-md">Credentials</div>
              </div>
            </div>
          </div>
          <div className="w-full bg-surface-container-high h-1 rounded-full mt-space-md overflow-hidden">
            <div className="bg-secondary h-full rounded-full transition-all" style={{ width: step === 1 ? "50%" : "100%" }} />
          </div>
        </div>
        <form onSubmit={onSubmit} aria-busy={saving} className="bg-surface-container-lowest p-space-lg sm:p-space-2xl rounded-xl border border-outline-variant shadow-sm flex flex-col gap-space-lg">
          <div>
            <h1 className="font-headline-lg">Register a StockFlow account</h1>
            <p className="font-body-sm text-on-surface-variant">
              Create a procurement or supplier account. Your account opens the workspace for your selected role.
            </p>
          </div>
          {step === 1 ? (
            <>
              <Input id="name" name="name" autoComplete="name" maxLength={100} label="Full name" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
              <Input id="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} label="Corporate email" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} required />
              <Select id="role" label="Portal role" value={form.role} onChange={(e) => setField("role", e.target.value)}>
                <option value="CUSTOMER">Customer / Procurement</option>
                <option value="SUPPLIER">Supplier</option>
              </Select>
              {form.role === "SUPPLIER" ? <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-space-md">An administrator must provision your supplier profile before you can publish products.</p> : null}
              {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
              <Button type="submit">Continue</Button>
            </>
          ) : (
            <>
              <Input id="password" name="password" autoComplete="new-password" minLength={12} maxLength={72} hint="Use a unique passphrase of 12–72 characters." disabled={saving} label="Password" type="password" value={form.password} onChange={(e) => setField("password", e.target.value)} required />
              <Input id="confirmPassword" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={72} disabled={saving} label="Confirm password" type="password" value={form.confirmPassword} onChange={(e) => setField("confirmPassword", e.target.value)} required />
              {error ? <p role="alert" className="font-body-sm text-error">{error}</p> : null}
              <div className="flex gap-space-sm">
                <Button variant="outline" type="button" onClick={() => setStep(1)}>Back</Button>
                <Button type="submit" loading={saving}>Create account</Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
