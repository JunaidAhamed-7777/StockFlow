import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import logo from "../../assets/logo.svg";
import { useAuth } from "../../context/AuthContext";
import { useApiHealth } from "../../hooks/useApiHealth";
import { getErrorMessage } from "../../utils/errors";
import { portalHome } from "../../utils/roles";
import { Icon } from "../../components/ui/Icon";
import { Button } from "../../components/ui/Button";

const ROLES = [
  { id: "ADMIN", label: "Admin Console" },
  { id: "SUPPLIER", label: "Supplier Portal" },
  { id: "CUSTOMER", label: "Customer Portal" },
];

export function LoginPage() {
  const { login, isAuthenticated, role } = useAuth();
  const apiHealth = useApiHealth();
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState("ADMIN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const liveCopy = useMemo(
    () => ({
      ADMIN: "Authenticate into the global operations console.",
      SUPPLIER: "Authenticate into the inbound fulfillment desk.",
      CUSTOMER: "Authenticate into the procurement catalog.",
    }),
    []
  );

  if (isAuthenticated) {
    return <Navigate to={portalHome(role)} replace />;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const user = await login(email, password, trust);
      navigate(portalHome(user.role), { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col">
      <main className="w-full flex-1 flex flex-col">
        <div className="w-full max-w-7xl mx-auto px-space-base md:px-space-xl py-space-xl md:py-space-3xl flex-1 flex items-center justify-center">
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-space-2xl items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between p-space-2xl bg-surface-container rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute -right-16 -top-16 w-80 h-80 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10 flex flex-col gap-space-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-md">
                    <img alt="StockFlow Enterprise" className="w-10 h-10 rounded-sm object-contain shadow-sm bg-surface-container-lowest p-1" src={logo} />
                    <div className="flex flex-col">
                      <span className="font-headline-md text-headline-md text-on-surface tracking-tight flex items-center gap-space-xs">
                        StockFlow <span className="text-secondary font-label-md px-1.5 py-0.5 rounded bg-surface-container-highest">ENTERPRISE</span>
                      </span>
                      <span className="font-caption text-caption text-on-surface-variant uppercase tracking-wider">High-Density Inventory Mesh</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-md py-1 rounded-full shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-mono-data text-label-sm">v2.4</span>
                  </div>
                </div>
                <div className="inline-flex items-center gap-space-sm bg-surface-container-highest/80 px-space-base py-space-xs rounded-lg self-start">
                  <Icon name="sensors" className={apiHealth === "live" ? "text-secondary" : "text-on-surface-variant"} size={16} />
                  <span className="font-label-sm text-label-sm font-medium">
                    {apiHealth === "live" ? "Connected to StockFlow API" : apiHealth === "down" ? "StockFlow API unreachable" : "Checking StockFlow API…"}
                  </span>
                </div>
                <div className="flex flex-col gap-space-md mt-space-md">
                  <h1 className="font-display text-display tracking-tight max-w-lg">Autonomous Supply Chain & Multi-DC Stock Orchestration</h1>
                  <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
                    High-throughput inventory synchronization for admin, supplier, and customer operations — backed by the live JavaScript API.
                  </p>
                </div>
              </div>
              <div className="relative z-10 my-space-2xl">
                <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm flex flex-col gap-space-md">
                  <div className="flex items-center justify-between">
                    <span className="font-label-sm uppercase tracking-wider text-on-surface-variant flex items-center gap-space-xs">
                      <Icon name="hub" className="text-secondary" size={15} />
                      Portal routing
                    </span>
                    <span className={`font-mono-data text-label-sm px-2 py-0.5 rounded ${apiHealth === "live" ? "text-emerald-700 bg-emerald-50" : apiHealth === "down" ? "text-error bg-error/10" : "text-on-surface-variant bg-surface-container"}`}>
                      {apiHealth === "live" ? "LIVE API" : apiHealth === "down" ? "API DOWN" : "CHECKING"}
                    </span>
                  </div>
                  <p className="font-body-sm text-on-surface-variant">{liveCopy[selectedRole]} Role is assigned by the backend after authentication.</p>
                </div>
              </div>
              <div className="relative z-10 flex flex-wrap items-center gap-space-lg pt-space-lg text-on-surface-variant font-label-sm">
                <span className="flex items-center gap-space-xs"><Icon name="verified_user" className="text-secondary" size={15} />JWT session</span>
                <span className="flex items-center gap-space-xs"><Icon name="gpp_good" className="text-secondary" size={15} />Role-gated routes</span>
                <span className="flex items-center gap-space-xs"><Icon name="shield_lock" className="text-secondary" size={15} />PostgreSQL source of truth</span>
              </div>
            </div>
            <div className="lg:col-span-6 flex flex-col justify-center">
              <div className="bg-surface-container-lowest p-space-2xl rounded-xl shadow-md flex flex-col gap-space-xl">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="font-headline-lg text-headline-lg">Sign in to StockFlow</h2>
                    <span className="font-label-sm text-on-surface-variant bg-surface-container-low px-2 py-1 rounded">Tier-1 Node</span>
                  </div>
                  <p className="font-body-md text-on-surface-variant">Select your intended portal, then sign in with corporate credentials.</p>
                </div>
                <div className="flex p-1 bg-surface-container-low rounded-lg gap-1">
                  {ROLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedRole(item.id)}
                      className={`flex-1 py-1.5 px-space-sm font-label-sm rounded text-center transition-all ${selectedRole === item.id ? "bg-surface-container-lowest text-on-surface shadow-sm font-semibold" : "text-on-surface-variant hover:text-on-surface"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-space-sm">
                  <button type="button" disabled className="w-full h-10 px-space-lg bg-surface-container-low text-on-surface-variant font-label-md rounded-lg flex items-center justify-center gap-space-base opacity-60 cursor-not-allowed">
                    <Icon name="domain_verification" className="text-secondary" size={18} />
                    SSO / SAML is not configured
                  </button>
                </div>
                <div className="relative flex items-center justify-center my-space-xs">
                  <div className="w-full h-px bg-surface-container-highest" />
                  <span className="absolute bg-surface-container-lowest px-space-md font-caption text-caption uppercase tracking-widest">or sign in with corporate credentials</span>
                </div>
                <form className="flex flex-col gap-space-lg" onSubmit={onSubmit}>
                  <div className="flex flex-col gap-space-xs">
                    <label className="font-label-sm" htmlFor="email">Corporate Email</label>
                    <div className="relative flex items-center">
                      <Icon name="badge" className="absolute left-space-md text-on-surface-variant pointer-events-none" size={18} />
                      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@organization.com" className="w-full h-9 pl-9 pr-space-sm bg-surface-container-low focus:bg-surface-container-lowest rounded-lg outline-none font-body-sm" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-space-xs">
                    <label className="font-label-sm" htmlFor="password">Password</label>
                    <div className="relative flex items-center">
                      <Icon name="key" className="absolute left-space-md text-on-surface-variant pointer-events-none" size={18} />
                      <input id="password" type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full h-9 pl-9 pr-9 bg-surface-container-low focus:bg-surface-container-lowest rounded-lg outline-none font-body-sm" />
                      <button type="button" className="absolute right-space-md text-on-surface-variant" onClick={() => setShowPassword((v) => !v)}>
                        <Icon name={showPassword ? "visibility_off" : "visibility"} size={18} />
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center gap-space-sm cursor-pointer">
                    <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="accent-secondary" />
                    <span className="font-body-sm">Keep this workstation signed in</span>
                  </label>
                  {error ? <p className="font-body-sm text-error">{error}</p> : null}
                  <Button type="submit" className="w-full !h-11" loading={saving}>
                    Authenticate & Access Portal
                    <Icon name="arrow_forward" size={18} />
                  </Button>
                </form>
                <div className="text-center">
                  <span className="font-body-sm text-on-surface-variant">Need an account? </span>
                  <Link className="font-label-md text-secondary hover:underline" to="/register">Register your organization</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
