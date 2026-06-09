import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, getToken, setToken } from '../lib/api';
import type { AuthUser, LoginResponse } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;       // true during the initial /me probe on mount
  isAuthed: boolean;      // shorthand for `!!user`
  error: string | null;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());
  const [error, setError] = useState<string | null>(null);

  // On mount: if we have a token, probe /api/auth/me to confirm it's
  // still valid. 401 → wipe the stored token; anything else → trust it.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    api.get<{ user: AuthUser }>('/api/auth/me')
      .then(res => {
        if (cancelled) return;
        setUser(res.user);
        connectSocket();
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof ApiError && err.isAuthError) {
          setToken(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/api/auth/login', { email, password, remember });
      setToken(res.token, remember);
      setUser({ id: res.user.id, email: res.user.email, name: res.user.name });
      connectSocket();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  const value: AuthState = {
    user,
    loading,
    isAuthed: !!user,
    error,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() called outside <AuthProvider>');
  return ctx;
}
