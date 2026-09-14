import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Role } from '@tingting/shared';
import { qk } from '../api/keys';
import { getToken } from '../lib/token';
import { onSessionExpired } from '../lib/api/session';

export interface AuthUser {
  userId: number;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  fullName?: string;
  /** Legacy primary customer pointer retained for single-entity compatibility. */
  customerId?: number | null;
  /** Full legal-entity scope for CUSTOMER accounts. */
  customerIds?: number[];
  /** Clerk scope: assigned responsible units. */
  businessUnitIds?: number[];
  /** Clerk scope: explicit shipment assignments. */
  shipmentIds?: number[];
  capabilities?: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: (opts?: { revoke?: boolean }) => void;
  updateUser: (updates: Pick<AuthUser, 'email' | 'phone' | 'username' | 'fullName'>) => void;
  isAuthenticated: boolean;
  loading: boolean;
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);
const AUTH_API_BASE = import.meta.env.VITE_API_BASE || '/api';

function clearUserScopedQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  const authMeHash = hashKey(qk.auth.me);
  queryClient.removeQueries({
    predicate: (query) => query.queryHash !== authMeHash,
  });
}

async function revokeToken(token: string): Promise<void> {
  const response = await fetch(`${AUTH_API_BASE}/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    // A revocation that can't reach the server must not hold the logout
    // hostage — abort after a bounded timeout.
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // 401/403 means the token is already expired or revoked server-side —
    // the revocation goal is met, so treat it as done.
    if (response.status === 401 || response.status === 403) return;
    throw new Error(`Logout revocation failed with HTTP ${response.status}`);
  }
}

/** True when the JWT is malformed or its exp has passed. JWT segments are
 *  base64URL (—/_ alphabet, stripped padding) and the payload body is UTF-8,
 *  so the raw segment must be normalized before atob and decoded through
 *  TextDecoder. Calling atob on the raw segment throws on most real tokens —
 *  which cleared the token and logged every cold boot out. */
export function isTokenExpired(token: string): boolean {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

async function fetchAuthUser(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token || isTokenExpired(token)) {
    api.clearToken();
    return null;
  }
  try {
    return await api.get<AuthUser>('/auth/me');
  } catch (err) {
    // Only clear credentials on genuine auth failures (401/403 = invalid,
    // expired, or revoked). Transient server/network errors (502/503/429)
    // must NOT evict a valid session — the query will retry on next refetch.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      api.clearToken();
    }
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);
  /** Tracks the token currently being revoked so a second logout for the
   *  same token is idempotent, while a different account can still log out. */
  const revokingTokenRef = useRef<string | null>(null);

  // Cached at the TanStack level: login/logout invalidates the key, not the
  // entire app. The previous useEffect+fetch approach bypassed the cache
  // entirely, so every page mount re-fetched /auth/me.
  const { data: user = null, isLoading } = useQuery({
    queryKey: qk.auth.me,
    queryFn: fetchAuthUser,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', {
        identifier,
        password,
      });
      clearUserScopedQueries(queryClient);
      api.setToken(res.token);
      setSessionExpired(false);
      queryClient.setQueryData(qk.auth.me, res.user);
    },
    [queryClient],
  );

  const finalizeLocalLogout = useCallback(() => {
    api.clearToken();
    clearUserScopedQueries(queryClient);
    queryClient.setQueryData(qk.auth.me, null);
  }, [queryClient]);

  const logout = useCallback((opts?: { revoke?: boolean }) => {
    const token = getToken();
    if (!token) {
      finalizeLocalLogout();
      return;
    }
    // Local teardown happens IMMEDIATELY — a revocation request that hangs
    // must never keep the user signed in.
    finalizeLocalLogout();
    // Skip revocation when the caller already revoked server-side (e.g.
    // change-password) or when the JWT is expired client-side.
    const shouldRevoke = opts?.revoke !== false && !isTokenExpired(token);
    if (!shouldRevoke) return;
    // Idempotent per token: if this exact token is already being revoked,
    // don't fire a duplicate. A *different* token (new account logout while
    // a previous revocation is pending) proceeds normally.
    if (revokingTokenRef.current === token) return;
    revokingTokenRef.current = token;
    // Bounded single attempt. Clear locally regardless of outcome so the
    // user is never held hostage. If revocation fails the remote session
    // may still be alive — callers accepting this trade-off pass revoke:false.
    revokeToken(token).catch(() => {
      console.warn('[auth] server-side token revocation failed; remote session may still be active');
    }).finally(() => {
      if (revokingTokenRef.current === token) {
        revokingTokenRef.current = null;
      }
    });
  }, [finalizeLocalLogout]);

  useEffect(
    () => onSessionExpired(() => {
      setSessionExpired(true);
      logout();
    }),
    [logout],
  );

  const updateUser = useCallback(
    (updates: Pick<AuthUser, 'email' | 'phone' | 'username' | 'fullName'>) => {
      queryClient.setQueryData<AuthUser | null>(qk.auth.me, (prev) =>
        prev ? { ...prev, ...updates } : prev,
      );
    },
    [queryClient],
  );

  // Memoized so consumers only re-render when an auth-visible field actually
  // changes, not on unrelated provider re-renders.
  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      updateUser,
      isAuthenticated: !!user,
      loading: isLoading,
      sessionExpired,
    }),
    [user, login, logout, updateUser, isLoading, sessionExpired],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook co-located with its Provider; splitting would fragment a standard React context pattern
export function useAuth() {
  return useContext(AuthContext);
}
