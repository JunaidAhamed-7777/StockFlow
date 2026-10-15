import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe, login as loginRequest, register as registerRequest } from "../services/auth.service";
import { getSuppliers } from "../services/discovery.service";
import { TOKEN_KEY, USER_KEY, SESSION_EXPIRED_EVENT, isSessionKey, readStorage, removeStorage, writeStorage } from "../utils/storage";
import { normalizeRole, portalHome } from "../utils/roles";
import { getErrorMessage } from "../utils/errors";
import { publicUser } from "../utils/apiData";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readStorage(TOKEN_KEY));
  const [user, setUser] = useState(() => publicUser(readStorage(USER_KEY)));
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(Boolean(readStorage(TOKEN_KEY)));

  const persist = useCallback((nextToken, nextUser, remember = true) => {
    const safeUser = publicUser(nextUser);
    setToken(nextToken);
    setUser(safeUser);
    const options = { session: !remember };
    if (nextToken) writeStorage(TOKEN_KEY, nextToken, options);
    else removeStorage(TOKEN_KEY);
    if (safeUser) writeStorage(USER_KEY, safeUser, options);
    else removeStorage(USER_KEY);
  }, []);

  const resolveSupplier = useCallback(async (nextUser, expectedToken) => {
    if (normalizeRole(nextUser?.role) !== "SUPPLIER") {
      setSupplier(null);
      return null;
    }
    try {
      const suppliers = await getSuppliers();
      if (readStorage(TOKEN_KEY) !== expectedToken) return null;
      const userId = Number(nextUser.id);
      const match = (suppliers || []).find(
        (item) => Number(item.userId) === userId || Number(item.user?.id) === userId
      );
      setSupplier(match || null);
      return match || null;
    } catch {
      if (readStorage(TOKEN_KEY) === expectedToken) setSupplier(null);
      return null;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const currentToken = readStorage(TOKEN_KEY);
    const current = await getMe();
    if (readStorage(TOKEN_KEY) !== currentToken) return null;
    persist(currentToken, current, !isSessionKey(TOKEN_KEY));
    await resolveSupplier(current, currentToken);
    return current;
  }, [persist, resolveSupplier]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const restoringToken = readStorage(TOKEN_KEY);
      if (!restoringToken) {
        setLoading(false);
        return;
      }
      try {
        const current = await getMe();
        if (cancelled || readStorage(TOKEN_KEY) !== restoringToken) return;
        persist(restoringToken, current, !isSessionKey(TOKEN_KEY));
        await resolveSupplier(current, restoringToken);
      } catch {
        if (!cancelled && readStorage(TOKEN_KEY) === restoringToken) {
          persist(null, null);
          setSupplier(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, [persist, resolveSupplier]);

  const login = useCallback(async (email, password, remember = true) => {
    const result = await loginRequest(email, password);
    persist(result.token, result.user, remember);
    await resolveSupplier(result.user, result.token);
    return result.user;
  }, [persist, resolveSupplier]);

  const register = useCallback(async (payload) => {
    return registerRequest(payload);
  }, []);

  const logout = useCallback(() => {
    persist(null, null);
    setSupplier(null);
  }, [persist]);

  useEffect(() => {
    const onStorage = (event) => {
      if ((event.key === TOKEN_KEY || event.key === null) && !readStorage(TOKEN_KEY)) logout();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
      window.removeEventListener("storage", onStorage);
    };
  }, [logout]);

  const value = useMemo(
    () => ({
      token,
      user,
      supplier,
      loading,
      isAuthenticated: Boolean(token && user && ["ADMIN", "SUPPLIER", "CUSTOMER"].includes(normalizeRole(user.role))),
      role: normalizeRole(user?.role),
      login,
      register,
      logout,
      refreshUser,
      homePath: portalHome(user?.role),
      errorMessage: getErrorMessage,
    }),
    [token, user, supplier, loading, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
