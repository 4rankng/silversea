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
