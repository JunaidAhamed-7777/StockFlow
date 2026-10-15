import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const sessionVersion = useRef(0);
  const activeToken = useRef(token);
  const activeUser = useRef(user);
  const validatingToken = useRef(null);

  const persist = useCallback((nextToken, nextUser, remember = true) => {
    const safeUser = publicUser(nextUser);
    activeToken.current = nextToken;
    activeUser.current = safeUser;
    setToken(nextToken);
    setUser(safeUser);
    const options = { session: !remember };
    if (nextToken) writeStorage(TOKEN_KEY, nextToken, options);
    else removeStorage(TOKEN_KEY);
    if (safeUser) writeStorage(USER_KEY, safeUser, options);
    else removeStorage(USER_KEY);
  }, []);

  const isCurrentSession = useCallback((expectedToken, version) => (
    sessionVersion.current === version && activeToken.current === expectedToken && readStorage(TOKEN_KEY) === expectedToken
  ), []);

  const resolveSupplier = useCallback(async (nextUser, expectedToken, version) => {
    if (!isCurrentSession(expectedToken, version)) return null;
    if (normalizeRole(nextUser?.role) !== "SUPPLIER") {
      setSupplier(null);
      return null;
    }
    try {
      const suppliers = await getSuppliers();
      if (!isCurrentSession(expectedToken, version)) return null;
      const userId = Number(nextUser.id);
      const match = (suppliers || []).find(
        (item) => Number(item.userId) === userId || Number(item.user?.id) === userId
      );
      setSupplier(match || null);
      return match || null;
    } catch {
      if (isCurrentSession(expectedToken, version)) setSupplier(null);
      return null;
    }
  }, [isCurrentSession]);

  const refreshUser = useCallback(async () => {
    const currentToken = readStorage(TOKEN_KEY);
    if (!currentToken) return null;
    const version = sessionVersion.current;
    const current = await getMe();
    if (!isCurrentSession(currentToken, version)) return null;
    persist(currentToken, current, !isSessionKey(TOKEN_KEY));
    await resolveSupplier(current, currentToken, version);
    return current;
  }, [isCurrentSession, persist, resolveSupplier]);

  const synchronizeSession = useCallback(async () => {
    const restoringToken = readStorage(TOKEN_KEY);
    const version = ++sessionVersion.current;
    activeToken.current = restoringToken;
    activeUser.current = null;
    validatingToken.current = restoringToken;
    setToken(restoringToken);
    setUser(null);
    setSupplier(null);
    setLoading(Boolean(restoringToken));
    if (!restoringToken) return null;
    try {
      const current = await getMe();
      if (!isCurrentSession(restoringToken, version)) return null;
      persist(restoringToken, current, !isSessionKey(TOKEN_KEY));
      await resolveSupplier(current, restoringToken, version);
      return isCurrentSession(restoringToken, version) ? current : null;
    } catch {
      if (isCurrentSession(restoringToken, version)) {
        persist(null, null);
        setSupplier(null);
      }
      return null;
    } finally {
      if (sessionVersion.current === version) {
        validatingToken.current = null;
        setLoading(false);
      }
    }
  }, [isCurrentSession, persist, resolveSupplier]);

  useEffect(() => {
    synchronizeSession();
    return () => {
      sessionVersion.current += 1;
    };
  }, [synchronizeSession]);

  const login = useCallback(async (email, password, remember = true) => {
    const version = ++sessionVersion.current;
    setLoading(true);
    setSupplier(null);
    try {
      const result = await loginRequest(email, password);
      if (sessionVersion.current !== version) throw new Error("Your session changed. Continue with the account currently signed in.");
      persist(result.token, result.user, remember);
      await resolveSupplier(result.user, result.token, version);
      if (!isCurrentSession(result.token, version)) throw new Error("Your session changed. Sign in again to continue.");
      return result.user;
    } catch (error) {
      if (sessionVersion.current === version) await synchronizeSession();
      throw error;
    } finally {
      if (sessionVersion.current === version) setLoading(false);
    }
  }, [isCurrentSession, persist, resolveSupplier, synchronizeSession]);

  const register = useCallback(async (payload) => {
    return registerRequest(payload);
  }, []);

  const logout = useCallback(() => {
    sessionVersion.current += 1;
    validatingToken.current = null;
    persist(null, null);
    setSupplier(null);
    setLoading(false);
  }, [persist]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== TOKEN_KEY && event.key !== USER_KEY && event.key !== null) return;
      const storedToken = readStorage(TOKEN_KEY);
      // Session-only accounts stay private to their tab when another tab signs in.
      // Token and user writes can each emit an event; validate each replacement once.
      if (storedToken === activeToken.current && (
        isSessionKey(TOKEN_KEY) || validatingToken.current === storedToken ||
        JSON.stringify(publicUser(readStorage(USER_KEY))) === JSON.stringify(activeUser.current)
      )) return;
      synchronizeSession();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
      window.removeEventListener("storage", onStorage);
    };
  }, [logout, synchronizeSession]);

  const value = useMemo(
    () => ({
      token,
      user,
      supplier,
      loading,
      isAuthenticated: Boolean(!loading && token && user && ["ADMIN", "SUPPLIER", "CUSTOMER"].includes(normalizeRole(user.role))),
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
