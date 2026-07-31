import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Role } from '@tingting/shared';
import { qk } from '../api/keys';
import { getToken } from '../design-system/hooks/useToken';
import { disposeAgentSocket, clearAgentConversation } from '../api/agentClient';
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
  workflowRolloutMode?: 'OFF' | 'SHADOW' | 'ACTIVE';
  /** Assistant (bot) enabled for this deployment (BOT_ENABLE). Launcher hides when false. */
  botEnabled?: boolean;
  /** Onboarding tutorial enabled app-wide (admin toggle). Checklist panel + tours hide when false. */
  onboardingEnabled?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Pick<AuthUser, 'email' | 'phone' | 'username' | 'fullName'>) => void;
  isAuthenticated: boolean;
  loading: boolean;
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);
const PENDING_LOGOUT_TOKENS_KEY = 'pending_logout_tokens';

function clearUserScopedQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  const authMeHash = hashKey(qk.auth.me);
  queryClient.removeQueries({
    predicate: (query) => query.queryHash !== authMeHash,
  });
}

function readPendingLogoutTokens(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_LOGOUT_TOKENS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))]
      : [];
  } catch {
    return [];
  }
}

function writePendingLogoutTokens(tokens: readonly string[]): void {
  if (tokens.length === 0) {
    localStorage.removeItem(PENDING_LOGOUT_TOKENS_KEY);
    return;
  }
  localStorage.setItem(PENDING_LOGOUT_TOKENS_KEY, JSON.stringify([...new Set(tokens)]));
}

function enqueuePendingLogoutToken(token: string): void {
  writePendingLogoutTokens([...readPendingLogoutTokens(), token]);
}

async function revokeToken(token: string): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) {
    throw new Error(`Logout revocation failed with HTTP ${response.status}`);
  }
}

/** Decode a JWT payload without a library; null if malformed or expired. */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
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
    // Any failure to validate the token (network, 401, malformed) means
    // the user is effectively logged out — drop the bad token.
    if (err instanceof ApiError) api.clearToken();
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);
  const logoutInFlightRef = useRef<Promise<void> | null>(null);
  const pendingRevocationInFlightRef = useRef<Promise<void> | null>(null);

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
    disposeAgentSocket(); // drop the assistant socket so a stale token isn't reused
    clearAgentConversation(); // forget the resumed thread so the next user starts fresh
    api.clearToken();
    clearUserScopedQueries(queryClient);
    queryClient.setQueryData(qk.auth.me, null);
  }, [queryClient]);

  const retryPendingRevocations = useCallback(() => {
    if (pendingRevocationInFlightRef.current) return pendingRevocationInFlightRef.current;
    pendingRevocationInFlightRef.current = (async () => {
      const pending = readPendingLogoutTokens();
      const failed: string[] = [];
      for (const token of pending) {
        try {
          await revokeToken(token);
        } catch {
          failed.push(token);
        }
      }
      writePendingLogoutTokens(failed);
    })().finally(() => {
      pendingRevocationInFlightRef.current = null;
    });
    return pendingRevocationInFlightRef.current;
  }, []);

  const logout = useCallback(() => {
    // Idempotent: useAuthedQuery invokes logout() on any 401/403, so during a
    // logout teardown several in-flight queries may race to log out again.
    if (logoutInFlightRef.current) return;
    const token = getToken();
    if (!token) {
      finalizeLocalLogout();
      return;
    }
    enqueuePendingLogoutToken(token);
    logoutInFlightRef.current = (async () => {
      try {
        await retryPendingRevocations();
        if (readPendingLogoutTokens().includes(token)) {
          await retryPendingRevocations();
        }
      } finally {
        // Local teardown is unconditional, while failed server revocations stay
        // in a separate queue and are retried when connectivity returns.
        finalizeLocalLogout();
        logoutInFlightRef.current = null;
      }
    })();
  }, [finalizeLocalLogout, retryPendingRevocations]);

  useEffect(() => {
    void retryPendingRevocations();
    const handleOnline = () => {
      void retryPendingRevocations();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [retryPendingRevocations]);

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

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        updateUser,
        isAuthenticated: !!user,
        loading: isLoading,
        sessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook co-located with its Provider; splitting would fragment a standard React context pattern
export function useAuth() {
  return useContext(AuthContext);
}
