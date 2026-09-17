# Authentication during dependency outages

Scope: authenticated office and portal API requests, including protected images.
Case IDs: SISPROD-AUTH-001 through SISPROD-AUTH-005.

## Regression cases

- **SISPROD-AUTH-001 — database temporarily unavailable.** Send a correctly signed,
  unexpired token to a protected API and image route while its PostgreSQL
  connection is unavailable. Expect HTTP 503 with a retryable Vietnamese message;
  the protected handler must not execute. Restore the database and retry the same
  session. The browser must retain the current token and any form draft.
- **SISPROD-AUTH-002 — revocation store temporarily unavailable.** Repeat with a
  token containing a session ID (`jti`) while Redis is unavailable. Expect HTTP
  503, no protected handler execution, and no false expired/revoked-session claim.
  Access remains denied until the revocation check succeeds.
- **SISPROD-AUTH-003 — actual authentication failures.** Missing, malformed,
  expired, and not-yet-valid tokens still return 401, even while dependencies are
  unavailable. A genuinely blacklisted token remains 401. Deleted/inactive users,
  changed roles and changed customer scopes still invalidate the session.
- **SISPROD-AUTH-004 — browser session preservation.** While signed in, enter a
  draft, trigger an authenticated request that receives 503, and observe the
  retryable error without navigation to login or token/draft removal. Retry after
  recovery. A later real 401 for the current session still signs out.
- **SISPROD-AUTH-005 — Redis recovers after reconnect exhaustion.** Make the
  configured Redis connection unavailable until its client ends, then restore
  the same endpoint. The next request must create a new connection and check the
  real blacklist successfully. A newly blacklisted session must still be denied.
  Exercise with a TCP relay to the real isolated Redis; do not stop shared Redis
  or emulate its protocol.

## Evidence requirements

Run the real HTTP middleware against refused local dependency connections, then
the existing session-revocation suite against the isolated QA database/Redis.
Save command, output and exit status under `qa/2026-09-17-sisprod/backend/`.
The browser case additionally needs a screenshot, DOM assertion and driver log;
no successful database mutation is expected for requests blocked by authentication.
Report dependency checks as DB/API VERIFIED until the browser case is driven.
