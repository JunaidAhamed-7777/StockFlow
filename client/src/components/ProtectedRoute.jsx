import { Navigate, Outlet, useLocation } from "react-router-dom";
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
    return <Navigate to={portalHome(role)} replace />;
  }

  return <Outlet />;
}
