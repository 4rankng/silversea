# UltraQA visual and functional results

Date: 2026-07-26
Controller: Codex
Status: affected code gates green; two confirmed cross-layer product defects and one not-implemented PRD requirement remain open.

## Executive summary

- Functional and visual spot coverage was completed across all seeded roles: `ADMIN`, `MANAGER`, `ACCOUNTANT`, `DRIVER`, `FORWARDER`, `CUSTOMER`, and a temporary `CLERK` user `qa-clerk-2126`.
- The 93-route inventory was exercised across role-allowed and role-denied
  paths at desktop, tablet, and mobile widths. The run produced 1,026 PNG
  artifacts under `qa/2026-07-26_product-wide-ultraqa_*`; these include
  reruns and denial/redirect evidence, so the image count is not a page count.
- The broad pass exposed four real CLERK defects. All four were fixed and re-proved green:
  - wrong clerk home/redirect behavior
  - clerk create page using a config-gated customers endpoint
  - clerk docs page using a bad `/api/api/...` shipment URL
  - clerk docs page using a config-gated container-types endpoint
- A fifth clerk mismatch was then proved and fixed: the topbar rendered notifications for CLERK even though Casbin denies `notifications`.
- The Forwarder portal accepted a container without a container number. The
  route now enforces a non-blank number and the 50-check suite rerun is green
  (48 pass, two explicit data/fixture skips).
- General expense creation returned HTTP 500 for an unknown supplier ID. The
  service now validates supplier existence on create/update and returns a
  clear Vietnamese 400 response.
- Two cross-layer access defects remain:
  - `MANAGER` dispatch loads with a background `403` on
    `/api/admin/app-settings`, which suppresses GPS-driven behavior on a page
    the role is allowed to use.
  - `ACCOUNTANT` receives `200` from `/api/audit-logs`, but the frontend
    redirects `/audit-logs` to `/dashboard`.

## Coverage completed

- `ADMIN`: dashboard, dispatch, trips, shipments, finance, config; desktop and mobile screenshots in `qa/2026-07-26_product-wide-ultraqa_manual-admin-*.png`.
- `MANAGER`: dashboard, dispatch, shipments, audit logs, config; desktop and mobile screenshots in `qa/2026-07-26_product-wide-ultraqa_manual-manager-*.png`.
- `ACCOUNTANT`: dashboard, shipments, users, expenses, config; desktop and mobile screenshots in `qa/2026-07-26_product-wide-ultraqa_manual-accountant-*.png`.
- `DRIVER`: my trips, my earnings, my penalties, two-orders; desktop and mobile screenshots in `qa/2026-07-26_product-wide-ultraqa_manual-driver-*.png`.
- `FORWARDER`: my trips, advances, settlements; broad run plus clean reruns in `qa/2026-07-26_product-wide-ultraqa_manual-forwarder-rerun.log` and `qa/2026-07-26_product-wide-ultraqa_manual-forwarder-mobile-rerun.log`.
- `CUSTOMER`: portal shipments, debit notes, statement; desktop and mobile screenshots in `qa/2026-07-26_product-wide-ultraqa_manual-customer-*.png`.
- `CLERK`: clerk create/docs plus denial redirects from dashboard, dispatch, and expenses; fixed-state evidence in `qa/2026-07-26_product-wide-ultraqa_manual-clerk-rerun.log` and `qa/2026-07-26_product-wide-ultraqa_manual-clerk-notifications-rerun4.log`.

## Confirmed defects and elimination path

### Fixed

1. CLERK landed on `/dashboard` and could open office routes that then failed with backend `403`s.
   - Evidence before fix: `qa/2026-07-26_product-wide-ultraqa_manual.rerun.log` lines for clerk landing `/dashboard`, `/dispatch`, `/expenses`.
   - Cause proved in code: `frontend/src/App.tsx` treated clerk as general office traffic for `/`, `/dashboard`, and `adminOnly`.
   - Fix: route clerk home to `/clerk/shipments/new` and redirect clerk away from office-only surfaces.
   - Evidence after fix: `qa/2026-07-26_product-wide-ultraqa_manual-clerk-rerun.log` shows `/dashboard`, `/dispatch`, and `/expenses` all ending at `/clerk/shipments/new`.

2. CLERK create page could not load customers.
   - Evidence before fix: `qa/2026-07-26_product-wide-ultraqa_manual.rerun.log` showed `403 /api/customers?limit=100&page=1` and the UI error `Không thể tải danh sách khách hàng`.
   - Competing hypotheses:
     - clerk RBAC missing for shipments create
     - clerk page calling the wrong catalog source
   - Elimination:
     - `qa/2026-07-26_product-wide-ultraqa_verify.log` proved clerk auth and shipment permissions were healthy.
     - `qa/2026-07-26_product-wide-ultraqa_verify.log` also proved `/api/customers` is intentionally denied while `/api/catalogs/bootstrap` is allowed.
   - Fix: use `tripClient.getBootstrap()` instead of config-gated customer fetch.
   - Evidence after fix: `qa/2026-07-26_product-wide-ultraqa_manual-clerk-rerun.log` and `...manual-clerk-notifications-rerun4.log` show the page loading normally with no customer-fetch error.

3. CLERK docs page could not load shipment detail.
   - Evidence before fix: `qa/2026-07-26_product-wide-ultraqa_manual.rerun.log` showed `403 http://localhost:7174/api/api/shipments/6278`.
   - Cause proved in code: `frontend/src/api/shipmentClient.ts` hard-coded `/api/...` on top of the API client's own `/api` base.
   - Fix: remove the duplicate `/api` prefix from shipment client calls.
   - Evidence after fix: `qa/2026-07-26_product-wide-ultraqa_manual-clerk-rerun.log` and `...manual-clerk-notifications-rerun4.log` show `Hồ sơ lô SHP-2607-06278` rendering with no shipment-detail error.

4. CLERK docs page could not load container types.
   - Evidence before fix: `qa/2026-07-26_product-wide-ultraqa_manual.rerun.log` showed `403 http://localhost:7174/api/container-types?limit=100&page=1`.
   - Cause proved in code: clerk docs page used a config-gated container-types source even though clerk is only permitted shipment workflows.
   - Fix: use `tripClient.getBootstrap()` container types instead of the config endpoint.
   - Evidence after fix: clerk docs page loads cleanly in `qa/2026-07-26_product-wide-ultraqa_manual-clerk-rerun.log` and `...rerun4.log`.

5. CLERK saw a notification bell that always generated `403` errors.
   - Evidence before fix: `qa/2026-07-26_product-wide-ultraqa_manual-clerk-rerun.log` showed `403 /api/notifications/unread-count` and `403 /api/notifications?page=1&limit=20` on every clerk page.
   - Competing hypotheses:
     - backend forgot clerk notification permissions
     - frontend rendered a control for a role that is intentionally denied
   - Elimination:
     - `backend/src/casbin/policy.csv` contains notification rows for `MANAGER`, `ACCOUNTANT`, `DRIVER`, `FORWARDER`, and wildcard `ADMIN`, but none for `CLERK`.
     - `frontend/src/components/layout/Topbar.tsx` rendered `<NotificationBell />` for every non-driver role.
   - Fix: show the notification bell only for roles that actually have notification access.
   - Evidence after fix: `qa/2026-07-26_product-wide-ultraqa_manual-clerk-notifications-rerun4.log` shows successful clerk login, `hasBell: false`, no console errors, no response errors, and no overflow on both clerk pages.

6. FORWARDER could create a container row without a container number.
   - Evidence before fix: the Forwarder E2E `TC-1332` received a success
     response for a payload without `containerNumber`.
   - Cause: the shared `tripContainerSchema` intentionally permits incomplete
     draft rows, and the Forwarder create route reused it without a
     workflow-specific required-number refinement.
   - Fix: `forwarderTripContainerSchema` requires a non-blank number only on
     the Forwarder create route; shared draft workflows remain unchanged.
   - Evidence after fix:
     `qa/2026-07-26_product-wide-ultraqa_forwarder-container-test.cycle2.log`
     and
     `qa/2026-07-26_product-wide-ultraqa_e2e-forwarder.final2.log`.

7. General expense creation exposed a database error for an unknown supplier.
   - Evidence before fix:
     `qa/2026-07-26_product-wide-ultraqa_e2e-vendor-expenses.final.log`
     shows `TC-1225` receiving HTTP 500.
   - Cause: the service validated the expense category but relied on the
     supplier foreign key to reject an unknown ID.
   - Fix: validate an active supplier before create and before a supplier
     change on update; return `Nhà cung cấp không tồn tại` with HTTP 400.
   - Evidence after fix:
     `qa/2026-07-26_product-wide-ultraqa_expense-supplier-test.final.log`
     and
     `qa/2026-07-26_product-wide-ultraqa_e2e-vendor-expenses.final2.log`.

### Still open

1. `MANAGER` dispatch page makes a strict-admin app-settings call.
   - Evidence: `qa/2026-07-26_product-wide-ultraqa_manual.rerun.log` shows `403 http://localhost:7174/api/admin/app-settings` on manager desktop and mobile dispatch.
   - Cause proved in code: `frontend/src/pages/DispatchPage.tsx` calls `useAppSettings()`, and `frontend/src/hooks/useAppSettings.ts` always requests `/api/admin/app-settings`.
   - Why not fixed here: the correct behavior is product-dependent. A safe fix requires deciding whether managers should read the GPS/app-settings toggle or whether dispatch should source that toggle from a non-admin contract.

2. `ACCOUNTANT` audit-log authority differs between frontend and backend.
   - Evidence:
     `qa/2026-07-26_product-wide-ultraqa_e2e-system-admin.cycle2.rerun2.log`
     has 28 passing checks and only `TC-1027` red: frontend URL
     `/dashboard`, backend `/api/audit-logs` status `200`.
   - Why not fixed here: the PRD proposals are not customer-approved and the
     intended Accountant capability is ambiguous. The product owner must
     choose frontend admission or backend denial before the layers can be
     aligned safely.

3. PRD requirement M1.7, two-way cargo pairing for the same truck and driver,
   is not implemented.
   - Evidence:
     `reports/prd-requirements-matrix.md` classifies M1.7 as `not found`, based
     on the roadmap's explicit two-way pairing gap.
   - This is a product-delivery gap, not a regression introduced by this QA
     pass.

4. PRD requirement M7.2, attendance calendar day-type classification, is
   marked implemented but has no direct automated acceptance-case coverage.
   All five proposed cases remain unproved; see
   `reports/requirements-test-coverage.md`.

## Automated gates after the final fixes

- `pnpm lint` — pass, 0 errors / 22 warnings —
  `qa/2026-07-26_product-wide-ultraqa_lint.final.log`
- `cd backend && npx tsc --noEmit` — pass —
  `qa/2026-07-26_product-wide-ultraqa_backend-tsc.final.log`
- `cd backend && pnpm test` — pass, 1,428 / 1,428 —
  `qa/2026-07-26_product-wide-ultraqa_backend-test.final.log`
- `cd frontend && npx tsc -b` — pass —
  `qa/2026-07-26_product-wide-ultraqa_frontend-tsc.final.log`
- `cd frontend && pnpm test` — pass, 55 files / 298 tests —
  `qa/2026-07-26_product-wide-ultraqa_frontend-test.final.log`
- `make build` — pass —
  `qa/2026-07-26_product-wide-ultraqa_build.final.log`
- Authentication/RBAC E2E — pass, 20 / 20 —
  `qa/2026-07-26_product-wide-ultraqa_e2e-auth.cycle2.rerun4.log`
- Forwarder E2E — pass, 48 / 48 executed; two explicit
  data/fixture skips —
  `qa/2026-07-26_product-wide-ultraqa_e2e-forwarder.final2.log`
- Driver E2E — pass, 31 / 31 executed; one data-dependent skip —
  `qa/2026-07-26_product-wide-ultraqa_e2e-driver.final3.log`
- Vendor-expense E2E — pass, 40 / 40 executed; one
  data-dependent skip —
  `qa/2026-07-26_product-wide-ultraqa_e2e-vendor-expenses.final2.log`
- Customer E2E — pass, 13 / 13 —
  `qa/2026-07-26_product-wide-ultraqa_e2e-customer.cycle2.log`
- Smoke E2E — pass, 8 / 8 —
  `qa/2026-07-26_product-wide-ultraqa_e2e-smoke.cycle2.rerun.log`
- System Admin E2E — red, 28 / 29; only the confirmed Accountant
  audit-authority mismatch remains —
  `qa/2026-07-26_product-wide-ultraqa_e2e-system-admin.final2.log`

## Constraints and residual uncertainty

- The broad first browser matrix hit intermittent browser-only auth failures on some later admin/forwarder pages (`500 /api/auth/login` or `500 /api/auth/me`). Those were not accepted as root cause. They were eliminated as universal backend faults by direct API verification in `qa/2026-07-26_product-wide-ultraqa_verify.log` and by clean dedicated reruns for forwarder and clerk.
- The route inventory includes parameterized pages whose meaningful visual
  state depends on a suitable entity and lifecycle state. All route patterns
  were swept for routing/access behavior; deep workflow certification is
  bounded by the acceptance-case gaps documented in
  `reports/requirements-test-coverage.md`.
- The PRD source is not an approved acceptance baseline: all 66 numbered
  sections, all 122 module-wide criteria, and Q01–Q23 still have blank/pending
  customer decisions. Results therefore distinguish delivery evidence from
  customer acceptance.
