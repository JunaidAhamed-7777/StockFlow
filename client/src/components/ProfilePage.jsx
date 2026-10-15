import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getProfile, updateProfile } from "../services/user.service";
import { getErrorMessage } from "../utils/errors";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { ErrorState } from "./ui/ErrorState";
import { Loading } from "./ui/Loading";

export function ProfilePage() {
  const { user, refreshUser, supplier } = useAuth();
  const [form, setForm] = useState({ name: "", email: "" });
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
        if (!cancelled) setForm({ name: profile.name || "", email: profile.email || "" });
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
    if (!form.name.trim() || !form.email.trim()) {
      setError("Enter your name and email address.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await updateProfile({ name: form.name.trim(), email: form.email.trim() });
      await refreshUser();
      setMessage("Profile updated.");
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
      <PageHeader
        breadcrumb={
          <>
            <span>Account</span>
            <span className="text-outline-variant">/</span>
            <span className="text-secondary font-medium">Profile</span>
          </>
        }
        title="Profile & account"
        description="Keep your name and contact details up to date. Your role determines which workspace you can access."
        badge={<Badge tone="info">{user?.role}</Badge>}
      />
      {error ? <ErrorState message={error} /> : null}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <Card className="lg:col-span-8 p-space-xl">
          <form onSubmit={onSubmit} className="flex flex-col gap-space-md max-w-xl">
            <Input id="name" label="Display name" autoComplete="name" maxLength={200} disabled={saving} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input id="email" label="Email address" type="email" autoComplete="email" maxLength={254} disabled={saving} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Button type="submit" loading={saving}>Save profile</Button>
            <p className="font-caption text-caption text-secondary" role="status" aria-live="polite">{message}</p>
          </form>
        </Card>
        <Card className="lg:col-span-4 p-space-xl space-y-space-sm">
          <h2 className="font-headline-sm text-headline-sm">Session identity</h2>
          <dl className="space-y-space-sm font-body-sm text-body-sm">
            <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">User ID</dt><dd className="font-mono-data">{user?.id}</dd></div>
            <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Role</dt><dd>{user?.role}</dd></div>
            {supplier ? (
              <>
                <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Company</dt><dd className="text-right break-words">{supplier.companyName}</dd></div>
                <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Supplier ID</dt><dd className="font-mono-data">{supplier.id}</dd></div>
              </>
            ) : null}
          </dl>
          <p className="font-caption text-on-surface-variant pt-space-sm">Role changes, password updates, and supplier company edits are not available in this workspace.</p>
        </Card>
      </div>
    </>
  );
}
