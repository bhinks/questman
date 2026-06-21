import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, clearLegacyAuthToken } from '../lib/api';
import type { AuthUser, LoginResponse } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;       // true during the initial /me probe on mount
  isAuthed: boolean;      // shorthand for `!!user`
  error: string | null;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  /** Start a throwaway, re-seeded demo session (no credentials). */
  demo: () => Promise<void>;
  logout: () => void;
  /** Revoke EVERY session for this account (bumps the server tokenVersion),
   *  then sign out here. The "lost a device / compromise" response. */
  logoutAll: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // On mount: probe /api/auth/me. The httpOnly cookie (if any) rides along —
  // 200 means we're already signed in, anything else means show the login.
  useEffect(() => {
    clearLegacyAuthToken(); // one-time: drop any pre-cookie web-storage token
    let cancelled = false;
    api.get<{ user: AuthUser & { role?: string } }>('/api/auth/me')
      .then(res => {
        if (cancelled) return;
        setUser({ ...res.user, role: res.user.role });
        connectSocket();
      })
      .catch(() => { /* not signed in — the login screen handles it */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    setError(null);
    try {
      // The server sets the httpOnly session cookie; we just track the user.
      const res = await api.post<LoginResponse>('/api/auth/login', { email, password, remember });
      setUser({ id: res.user.id, email: res.user.email, name: res.user.name, role: res.user.role });
      connectSocket();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw err;
    }
  }, []);

  const demo = useCallback(async () => {
    setError(null);
    try {
      // Server re-seeds the demo sandbox and sets a short-lived session cookie.
      const res = await api.post<LoginResponse>('/api/auth/demo');
      setUser({ id: res.user.id, email: res.user.email, name: res.user.name, role: res.user.role });
      connectSocket();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start demo';
      setError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    // Clear the cookie server-side, then drop local state.
    void api.post('/api/auth/logout').catch(() => { /* best effort */ });
    setUser(null);
    disconnectSocket();
  }, []);

  const logoutAll = useCallback(() => {
    // Bump tokenVersion server-side so every outstanding token is revoked.
    void api.post('/api/auth/logout-all').catch(() => { /* best effort */ });
    setUser(null);
    disconnectSocket();
  }, []);

  const value: AuthState = {
    user,
    loading,
    isAuthed: !!user,
    error,
    login,
    demo,
    logout,
    logoutAll,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() called outside <AuthProvider>');
  return ctx;
}
