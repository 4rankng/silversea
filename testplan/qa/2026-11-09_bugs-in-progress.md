# Regression spec — 20261109_4 Bugs (IN_PROGRESS)

**Source:** `/Users/dev/My Drive/SilverSea/Kanban/IN_PROGRESS/20261109_4.docx`
**Status:** PREP — ready to execute on staging
**Date:** 2026-11-09

## Goal

Cover 4 bugs reported on the IN_PROGRESS kanban board:

1. **BUG 1** — Cannot log out (clicking "Đăng xuất" does not work)
2. **BUG 2** — Dispatch issued order to driver, but driver screen does not show it
3. **BUG 3** — Bien so xe (license plate) not linked to nha xe (shipping company)
4. **BUG 4** — Error when clicking a button (unknown trigger — screenshot shows error toast)

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Staging UI | `https://vantai.tingting.vip` |
| Accounts | per `testplan/testaccounts.txt` |

---

## Acceptance criteria

### TC-IP-001 — Logout: clicking "Đăng xuất" logs the user out

- **Given** any logged-in user on staging
- **When** they click "Đăng xuất" in the sidebar/header
- **Then**:
  - The user is redirected to the login page
  - `localStorage['token']` is cleared
  - Navigating back to a protected route redirects to login
- **Assert:**
  - `browser_evaluate(() => localStorage.getItem('token'))` returns `null` after logout
  - URL contains `/login` after logout
- **Evidence:**
  - `qa/2026-11-09_bugs-ip_ui-001-logout.png`
- **Regression unit test:** `frontend/src/hooks/useAuth.logout.test.tsx` (7 scenarios — already exists)

### TC-IP-002 — Dispatch order visible on driver screen after issuance

- **Given** dispatcher issues a dispatch order to a driver on staging
- **When** the driver logs in and opens their trip list (`/my-trips`)
- **Then**:
  - The newly issued trip appears in the driver's trip list
  - The trip detail page loads without errors
  - The trip shows correct dispatch info (route, container, task notes)
- **Assert:**
  - `GET /api/driver/me/trips` returns the trip within 5 seconds of issuance
  - `browser_evaluate` on `/my-trips` shows the trip row
- **Evidence:**
  - `qa/2026-11-09_bugs-ip_ui-002a-dispatcher-issued.png`
  - `qa/2026-11-09_bugs-ip_ui-002b-driver-list.png`
  - `qa/2026-11-09_bugs-ip_api-002.log`
- **Existing coverage:** `testplan/flows/03-laixe-nhan-lenh.md` TC-LX-NHANLENH-001 through 010

### TC-IP-003 — Bien so xe linked to nha xe in carrier fleet catalog

- **Given** an external carrier (nha xe) exists with `isCarrier=true` in the customers table
- **When** the dispatcher opens the carrier fleet vehicles page or the plate picker in dispatch detail
- **Then**:
  - Adding a plate to a carrier stores the `carrierId` FK correctly
  - Selecting a carrier in the dispatch detail plate picker filters plates to that carrier's fleet
  - A plate added to carrier A does NOT appear when carrier B is selected
- **Assert:**
  - `GET /api/shipments/carrier-fleet-vehicles?carrierId=<A>` returns only carrier A's plates
  - `POST /api/shipments/carrier-fleet-vehicles` with `carrierId: A` creates a row with correct FK
  - DB: `SELECT carrier_id FROM carrier_fleet_vehicles WHERE id = <new_id>` = A
- **Evidence:**
  - `qa/2026-11-09_bugs-ip_ui-003a-carrier-picker.png`
  - `qa/2026-11-09_bugs-ip_db-003.sql`
  - `qa/2026-11-09_bugs-ip_api-003.log`
- **Existing coverage:** `testplan/qa/2026-09-10_dispatch-detailed-plan.md` TC-DDP-003, TC-DDP-004

### TC-IP-004 — Button click error does not occur

- **Given** the specific screen/button from the bug report (screenshot shows error toast)
- **When** the user clicks the button
- **Then**:
  - No error toast appears
  - The expected action completes successfully
  - Console shows no unhandled errors
- **Assert:**
  - `browser_get_logs()` contains no red entries during the action
  - No error toast element present in DOM after click
- **Evidence:**
  - `qa/2026-11-09_bugs-ip_ui-004-before.png`
  - `qa/2026-11-09_bugs-ip_ui-004-after.png`
  - `qa/2026-11-09_bugs-ip_ui-driver.log`
- **Note:** Exact button identity requires the original screenshot context. QA to confirm on staging.

## QA gates

```
pnpm lint                           # 0 errors
cd backend && npx tsc --noEmit      # 0 errors
cd backend && pnpm test             # all pass
cd frontend && npx tsc -b           # 0 errors
cd frontend && pnpm test            # all pass
make build                          # succeeds
```

## Pass criteria

PASS iff TC-IP-001 through TC-IP-004 ALL hold on staging. Any FAIL → `fix-and-re-run`.

## What is NOT covered

- Mobile viewport for dispatch detail (desktop-first)
- Offline/PWA logout path (covered by `03-laixe-nhan-lenh.md` separately)
- Concurrent dispatch issuance race conditions
- Error toast root cause (BUG 4) — requires exact reproduction steps from the screenshot context
