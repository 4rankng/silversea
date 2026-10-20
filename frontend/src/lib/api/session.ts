type SessionExpiredListener = () => void;

const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Notify the authenticated shell that the server rejected the current token.
 * Kept framework-agnostic so the HTTP client does not depend on React.
 */
export function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

/** Subscribe to session-expiry notifications from the shared HTTP client. */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

/** Who a session-identity event is about — audit-safe display fields only. */
export interface SessionIdentity {
  userId: number;
  fullName?: string | null;
  role: string;
}

export interface SessionIdentityEvent {
  /** Another tab in the same browser profile signed in as a DIFFERENT user,
   *  swapping this tab's identity through the shared token. */
  kind: 'cross-tab-login';
  previous: SessionIdentity;
  current: SessionIdentity;
}

/** The shared token was removed from another tab (logout / password change):
 *  every tab in this browser profile is now signed out. */
export interface SessionSignedOutElsewhereEvent {
  kind: 'cross-tab-logout';
  previous: SessionIdentity;
}

export type SessionIdentityChangeEvent = SessionIdentityEvent | SessionSignedOutElsewhereEvent;

const sessionIdentityListeners = new Set<(event: SessionIdentityChangeEvent) => void>();

/**
 * Announce that the active identity changed (or ended) because of what
 * ANOTHER tab did to the one shared auth token. The token design is one
 * session per browser profile by owner ruling — the swap itself is correct;
 * what was missing (QA R27) is the signal, so a tester never unknowingly
 * keeps testing under the wrong role.
 */
export function notifySessionIdentityChanged(event: SessionIdentityChangeEvent): void {
  for (const listener of sessionIdentityListeners) listener(event);
}

/** Subscribe to cross-tab session identity changes. */
export function onSessionIdentityChanged(
  listener: (event: SessionIdentityChangeEvent) => void,
): () => void {
  sessionIdentityListeners.add(listener);
  return () => sessionIdentityListeners.delete(listener);
}
