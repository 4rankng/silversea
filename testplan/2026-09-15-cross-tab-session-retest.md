# Cross-tab session retest — 15 September 2026

Observed by parent in Chrome: signing out CUS and signing in DRIVER in one tab was followed by a late logout while another CUS tab remained open. Current transport compares a failed request token to a cached token, so an old tab can clear the newer shared storage token before a storage event arrives.

## Acceptance

- Defer an authenticated request with token A; another tab writes token B directly to localStorage; resolve A with401 before dispatching the storage event. B remains stored, session-expired listeners do not fire.
- A401 for the current token still clears credentials and the local user. Wrong-password unauthenticated401 remains an ordinary login error.
- A token storage event cancels old scoped queries, removes their private cached data and refetches current user B. No stale role/user renders under B's credentials.
- Remote logout clears the local user without revoking a different account or making a new authenticated call.
- Unrelated localStorage keys leave auth state unchanged; late responses from cancelled old auth requests cannot restore A.
- Storage unavailable retains current in-memory session handling; listeners clean up on unmount.

Run scoped API/auth tests and frontend type/lint. Parent owns actual serialized two-tab Chrome reproduction. No backend change, commit, index write or deployment.

- Session changes reset API version hints and generated retry keys; a late A success cannot repopulate B caches.
- A missing-version428 received before or during a row refetch cannot automatically replay A mutation under B.
- Explicit logout before the storage event preserves a newer shared B token and resynchronizes the UI.
- A pending login response cannot overwrite a different session established while that login was in flight.

- Render the exported authenticated-query wrapper around the real ApiClient; resolve A401 after a direct storage change to B, before the storage event. Preserve B and propagate the query error without calling logout. Current-token401 still notifies session expiry exactly once; custom permission errors remain ordinary errors. No production callers of this exported wrapper were found in the current source inventory.

Final gate follow-up: preserve ordinary same-session missing-version428 recovery using real token storage (no divergent getToken mock); retain explicit-version and genuine409 conflict behavior.
