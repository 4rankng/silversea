# Staging CLERK logout diagnosis - 2026-07-28

## Executive summary
- Issue: staging user `qa_clerk` can authenticate, but the first authenticated API call immediately returns `401 Quyền tài khoản đã thay đổi, vui lòng đăng nhập lại`.
- Impact: CLERK session is unusable; frontend clears the token and sends the user back to the login page with the expired-session path.
- Root cause: `/api/auth/login` signs `customerId` / `customerIds` into every JWT, including `CLERK`; `authMiddleware` only re-validates customer scope for `CUSTOMER`, so any non-`CUSTOMER` token carrying customer scope self-fails.
- Status: reproduced and proven on staging at `2026-07-28 09:35:29 +0800`; no code changes made.
- Recommended minimal fix: make `authMiddleware` re-load and compare customer scope for every role allowed to carry customer links (`CUSTOMER`, `CLERK`, `ACCOUNTANT`). Follow-up: decide whether clerk `businessUnitIds` / `shipmentIds` also need JWT fresh-claim invalidation.

## Expected vs actual
- Expected: after `qa_clerk` logs in, frontend should land on `/clerk/shipments/new`, load `/api/catalogs/bootstrap`, and keep the session active.
- Actual: login returns `200`, but the first authenticated request `/api/auth/me` returns `401 Quyền tài khoản đã thay đổi, vui lòng đăng nhập lại`; the frontend auth client clears the token on authenticated `401`, so the user is bounced back to login immediately.

## Timeline
- `2026-07-28 09:35:29 +0800` - `POST /api/auth/login` for `qa_clerk` returned `200`.
- `2026-07-28 09:35:29 +0800` - decoded JWT showed `role=CLERK`, `customerId=1`, `customerIds=[1]`, no `businessUnitIds` / `shipmentIds`.
- `2026-07-28 09:35:29 +0800` - first authenticated request `GET /api/auth/me` returned `401 Quyền tài khoản đã thay đổi, vui lòng đăng nhập lại`.
- `2026-07-28 09:35:29 +0800` - every other authenticated probe returned the same `401`: `/api/catalogs/bootstrap`, `/api/salary-periods/resolve`, `/api/shipments`, `/api/shipments/quick`, `/api/notifications/unread-count`, `/api/onboarding/tasks`, `/api/agent/conversations`.
- `2026-07-28 09:35:29 +0800` - admin read-only blast-radius query found exactly one currently affected staging user: `qa_clerk` (`id=24`), the only non-`CUSTOMER` user with customer scope.

## Evidence
- Live staging trace: [qa/2026-07-28_clerk-logout_staging-api-trace.log](/Users/dev/Documents/projects/silversea/qa/2026-07-28_clerk-logout_staging-api-trace.log)
- Blast radius query: [qa/2026-07-28_clerk-logout_blast-radius.log](/Users/dev/Documents/projects/silversea/qa/2026-07-28_clerk-logout_blast-radius.log)
- Source inspection: [qa/2026-07-28_clerk-logout_source-inspection.log](/Users/dev/Documents/projects/silversea/qa/2026-07-28_clerk-logout_source-inspection.log)

Key chain:
- `backend/src/services/user.service.ts` `authenticate()` loads `customerIds`, `businessUnitIds`, and `shipmentIds`, then `addScopeIds()` adds them to the returned user object.
- `backend/src/routes/auth.ts` login signs `customerId` and `customerIds` into the JWT for every role, not just `CUSTOMER`.
- Staging JWT for `qa_clerk` contains `customerId=1` and `customerIds=[1]`.
- `backend/src/middleware/auth.ts` loads `currentCustomerIds` only when `current.role === Role.CUSTOMER`; for `CLERK` it forces `currentCustomerIds=[]`.
- `sameCustomerScope([], [1], payload)` returns `false`, so middleware returns `401 Quyền tài khoản đã thay đổi, vui lòng đăng nhập lại`.
- `frontend/src/lib/api/client.ts` treats any authenticated `401` as session expiry, clears the token, and notifies the shell; `frontend/src/hooks/useAuth.tsx` listens to that event and logs out.

## Hypotheses tested
### Hypothesis 1: token is expired, malformed, or blacklisted
- Eliminated.
- Evidence: fresh login returned `200`; JWT decoded cleanly; failure message is the middleware scope-change message, not `Token hết hạn hoặc không hợp lệ` or `Token đã bị thu hồi`.

### Hypothesis 2: frontend misclassifies an authorization failure and logs out on `403`
- Eliminated.
- Evidence: first failing request is backend `401` on `/api/auth/me`, before any route-specific `403` path matters. The logout is a downstream effect of `api.handleSessionExpiry()`.

### Hypothesis 3: non-customer role is carrying customer claims that middleware rejects
- Confirmed.
- Evidence: staging login user and JWT both include customer scope for `qa_clerk`; middleware only accepts non-empty customer scope when the current DB role is `CUSTOMER`; every authenticated request fails with that exact branch's message.

## Proven root cause
- The auth contract is internally inconsistent for scoped clerk users.
- Login/user service behavior:
  - CLERK users are allowed to carry customer scope, business-unit scope, and shipment scope.
  - `authenticate()` returns those scopes.
  - login signs the customer scope into the JWT.
- Middleware behavior:
  - only `CUSTOMER` users get DB-backed customer-scope revalidation.
  - non-`CUSTOMER` users are treated as if they must have zero customer scope in the token.
- Result:
  - any `CLERK` or `ACCOUNTANT` token carrying customer scope is rejected on the first authenticated request, even if the DB state has not changed.

## Blast radius
- Proven current staging impact: one user, `qa_clerk` (`id=24`).
- Code-level blast radius:
  - any `CLERK` token with `customerId` or `customerIds`;
  - any `ACCOUNTANT` token with `customerId` or `customerIds`;
  - any future non-`CUSTOMER` role that is allowed to carry customer scope unless middleware is updated in lockstep.
- Symptom scope: total session failure, not page-specific denial. Every authenticated API route behind `authMiddleware` returns `401`.

## Recommended fix
### Immediate P0
- Update `backend/src/middleware/auth.ts` so customer-scope revalidation runs for all roles that legitimately carry customer links: `CUSTOMER`, `CLERK`, and `ACCOUNTANT`.
- Keep the existing role comparison and active/deleted checks.
- Add backend tests covering:
  - `CLERK` with valid customer scope -> authenticated requests stay `200`;
  - `ACCOUNTANT` with valid customer scope -> authenticated requests stay `200`;
  - scope changed after token issue -> `401` still fires for those roles.

### Short-term P1
- Decide whether clerk fresh-claim invalidation should also cover `businessUnitIds` and `shipmentIds`.
- If yes, include those claims in the JWT and compare them in middleware, or centralize all scoped-role claim generation/validation in one helper so login and middleware cannot drift again.

### Long-term P2
- Add an auth regression test for every scoped role, not just `CUSTOMER`.
- Add a staging smoke check: successful login must be followed by `GET /api/auth/me` `200`.
- Add a monitor/alert on `POST /api/auth/login 200` followed by immediate `GET /api/auth/me 401` for the same user within 10 seconds.

## Resolved design decision
- Use current database-backed row-level enforcement for clerk `businessUnitIds` /
  `shipmentIds`; do not make those assignments hard session-invalidating JWT
  claims. Every clerk shipment read and mutation reloads the three assignment
  sets through `loadClerkShipmentScope()`, so assignment changes take effect on
  the next request without trusting stale token scope. Customer links remain
  token-revalidated because they are present in the authentication contract.
- This follows the approved TingTing proposal and does not require a customer
  business decision.

Status: DONE
Summary: Reproduced the staging CLERK logout, proved the first failing request is `/api/auth/me` `401`, traced it to JWT customer-scope claims for a `CLERK` user conflicting with middleware that only re-validates `CUSTOMER` scope, and measured the current staging blast radius.
Concerns/Blockers: No browser automation artifact captured; user-visible redirect path is inferred from the proven frontend `401` logout flow plus live API evidence.
