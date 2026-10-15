import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loading } from "./ui/Loading";
import { normalizeRole, portalHome } from "../utils/roles";

export function ProtectedRoute({ roles }) {
  const { isAuthenticated, loading, role } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loading label="Restoring secure session…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (roles?.length && !roles.map(normalizeRole).includes(role)) {
    return (
      <main className="max-w-xl mx-auto px-6 py-20">
        <h1 className="font-headline-lg text-headline-lg">You don’t have access to this workspace</h1>
        <p className="mt-3 mb-6 text-on-surface-variant">This page belongs to a different account role. Continue in your {role.toLowerCase()} workspace.</p>
        <Link to={portalHome(role)} className="inline-flex min-h-11 items-center px-4 py-2 rounded-lg bg-secondary text-white font-semibold">Open my workspace</Link>
      </main>
    );
  }

  return <Outlet />;
}
