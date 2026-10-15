import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getProfile, updateProfile } from "../services/user.service";
import { getErrorMessage } from "../utils/errors";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { ErrorState } from "./ui/ErrorState";
import { Loading } from "./ui/Loading";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { clearFieldError, focusFirstError, validateForm } from "../utils/formValidation";

export function ProfilePage() {
  const { user, refreshUser, supplier } = useAuth();
  const [form, setForm] = useState({ name: "", email: "" });
  const [initialForm, setInitialForm] = useState({ name: "", email: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const profile = await getProfile();
        if (!cancelled) {
          const values = { name: profile.name || "", email: profile.email || "" };
          setForm(values);
          setInitialForm(values);
        }
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const errors = validateForm(event.currentTarget);
    setFieldErrors(errors);
    if (Object.keys(errors).length) { focusFirstError(event.currentTarget, errors); return; }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await updateProfile({ name: form.name.trim(), email: form.email.trim() });
      const values = { name: updated.name, email: updated.email };
      setForm(values);
      setInitialForm(values);
      setMessage("Profile updated.");
      try { await refreshUser(); }
      catch { setError("Your profile was saved, but account details could not be refreshed. Reload the page to see the latest details."); }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading label="Loading profile…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />;

  return (
    <>
      <UnsavedChangesGuard dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} busy={loading || saving} />
      <PageHeader
        breadcrumb={
          <>
            <span>Account</span>
            <span className="text-outline-variant">/</span>
            <span className="text-secondary font-medium">Profile</span>
          </>
        }
        title="Profile"
        description="Update your name and email address."
      />
      {error ? <ErrorState message={error} /> : null}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <Card className="lg:col-span-8 p-space-xl">
          <form noValidate onSubmit={onSubmit} aria-busy={saving} className="flex flex-col gap-space-md max-w-xl">
            <Input id="name" name="name" label="Display name" error={fieldErrors.name} autoComplete="name" maxLength={200} disabled={saving} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFieldErrors((current) => clearFieldError(current, "name")); setMessage(""); }} required />
            <Input id="email" name="email" label="Email address" error={fieldErrors.email} type="email" autoComplete="email" autoCapitalize="none" maxLength={254} disabled={saving} value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setFieldErrors((current) => clearFieldError(current, "email")); setMessage(""); }} required />
            <Button type="submit" loading={saving}>Save profile</Button>
            <p className="font-caption text-caption text-secondary" role="status" aria-live="polite">{message}</p>
          </form>
        </Card>
        <Card className="lg:col-span-4 p-space-xl space-y-space-sm">
          <h2 className="font-headline-sm text-headline-sm">Account details</h2>
          <dl className="space-y-space-sm font-body-sm text-body-sm">
            <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Account number</dt><dd className="font-mono-data">{user?.id}</dd></div>
            <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Account type</dt><dd>{{ ADMIN: "Administrator", SUPPLIER: "Supplier", CUSTOMER: "Customer" }[user?.role]}</dd></div>
            {supplier ? (
              <>
                <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Company</dt><dd className="text-right break-words">{supplier.companyName}</dd></div>
                <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Supplier ID</dt><dd className="font-mono-data">{supplier.id}</dd></div>
              </>
            ) : null}
          </dl>
        </Card>
      </div>
    </>
  );
}
