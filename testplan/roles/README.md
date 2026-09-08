# Test Plan — Silversea (TingTing Vietnam)

> Acceptance criteria & manual test scripts for each role and each flow in
> the Silversea Vietnamese trucking-logistics platform.
>
> This file is the **index + shared conventions** for the test plan. The
> per-role documents live next to it (`01-cus.md` … `07-khachhang.md`)
> and are the source of truth for "what does role X need to be able to do, and
> how do I prove it works".
>
> **Tone**: every AC is written as a binary, observable statement. "Should be
> fast" is not an AC; "completes in < 1.5 s on the dev seed" is. If a step is
> not testable in a non-flaky way, it is not in this document.

---

## 1. Roles in scope

Sourced from `shared/src/constants/index.ts:294` (`Role` enum) and
`shared/src/constants/index.ts:425` (`ROLE_LABELS`).

| Code (label)        | Vietnamese label         | Test-plan doc                | Primary UI                  |
|---------------------|--------------------------|------------------------------|-----------------------------|
| `CUS`               | Nhân viên Chứng từ       | `01-cus.md`             | `/shipments`, `/shipments-detail` |
| `DISPATCHER`        | Điều vận                 | `02-dieuvan.md`         | `/dispatch`, `/dispatch-detail`, `/fleet/*`, `/suppliers` |
| `DRIVER`            | Lái xe                   | `03-laixe.md`           | `/my-trips`, PWA driver app |
| `ACCOUNTANT`        | Kế toán                  | `04-ketoan.md`          | `/accounting`, AR/AP, `/profit`, `/treasury` |
| `MANAGER`           | Quản lý                  | `05-quanly-admin.md`    | Full system except strict-admin pages |
| `ADMIN`             | Quản trị viên            | `05-quanly-admin.md`    | Full system + `/admin-center`, `/config/app-settings`, `/config/master-data-import` |
| `OPS`               | Nhân viên vận hành       | `06-vanhanh.md`         | `/my-orders`, `/my-advances`, `/my-settlements` |
| `CUSTOMER`          | Khách hàng               | `07-khachhang.md`       | `/portal/shipments`, `/portal/debit-notes`, `/portal/statement` |

Two roles are merged in one document on purpose: MANAGER ⊂ ADMIN for most
flows, and the only ADMIN-only delta is a small list of strict-admin pages
called out at the end of `05-quanly-admin.md`. The per-flow coverage is
identical so duplicating it gains nothing.

## 2. Test environments

| Environment | URL                          | Backend                       | When to use                          |
|-------------|------------------------------|-------------------------------|--------------------------------------|
| local dev   | http://localhost:7174        | http://localhost:3001         | Per-PR QA, fix-loop, e2e screenshot runs |
| staging     | https://vantai.tingting.vip  | (same droplet)                | Final acceptance, regression sweep   |

`make dev` brings up Postgres (`:5441`), Redis (`:6391`), backend (`:3001`),
frontend (`:7174`) and Adminer (`:8083`). First-run: `make setup`.

## 3. Accounts and credentials

This testplan is **role-only** — it never hardcodes a username. Every test
case names the role it needs (`CUS`, `DISPATCHER`, …) and the runner picks
the concrete account from the environment's role→username map.

The mapping lives in `../testaccounts.txt` (testplan root) and is split by
environment:

| Env         | What the file declares                            |
|-------------|---------------------------------------------------|
| `local:`    | prod-mirror named users (always present) + local-only demo seed accounts (`CUS`, `DISPATCHER`, …) added by `make seed` |
| `staging:`  | prod-mirror named users only — no `MANAGER` / `CUSTOMER` role exists on staging because prod has none |

Practical rules:

- The default for every test case is **role + environment** — the runner
  resolves `CUS + staging → thanhdc (NV018)`, `CUS + local → cus` (demo)
  or `thanhdc` (prod-mirror), etc.
- Roles `MANAGER` and `CUSTOMER` are **local-only** by design — staging
  has no users with those roles, so any case tagged with them is
  `BLOCKED` on staging until prod adds the role.
- All passwords on both environments are `Abc123` (verified 2026-09-06).
- The per-role docs (`01-cus.md` … `07-khachhang.md`) and per-flow docs
  (`flows/*.md`) follow the same role-only convention; none of them
  hardcode a username.

## 4. AC template

Each per-flow block follows this structure. Copy/paste it when adding a new
flow to a role document.

```markdown
### Flow: <name> — <one-line business outcome>

**Route(s)**: `/path/...`
**Roles allowed**: `CUS`, `DISPATCHER`
**Pre-conditions**: <data fixtures, env state, login state>
**Reference**: <link to code, e.g. `frontend/src/pages/FooPage.tsx:42`>

#### Acceptance criteria

1. **<AC code, e.g. CUS-SHIP-01> — <observable outcome>**
   - **Given** <state>
   - **When** <action>
   - **Then** <assertion, with concrete numbers / strings>
   - **Evidence**: <what to capture: screenshot path, API log, console>
2. ...

#### Test steps (manual)

1. Login as `<role>`.
2. Navigate to `<route>`.
3. ...

#### Out of scope

- <things this flow does NOT promise>

#### Regression hooks

- `pnpm test` must stay green.
- `qa/<date>_<flow>_<gate>.log` artifact under `qa/`.
```

The AC code prefix is the role's short code (`CUS`, `DISP`, `DRV`, `ACC`,
`MGR`, `ADM`, `OPS`, `CUST`). This makes cross-document searches cheap.

## 5. Cross-cutting ACs (apply to every role)

These are NOT in any per-role document because they apply everywhere. If a
per-role AC conflicts with one of these, the per-role AC is wrong; fix the
AC, not the cross-cutting rule.

### AUTH-01 — Login works for every seeded user
- **Given** a valid username/password pair from `testaccounts.txt`
- **When** the user submits the login form
- **Then** the user lands on the role's home route within 2 s, with no
  console errors.
- **Evidence**: dev-tools network tab; first paint screenshot.

### AUTH-02 — Logout clears session and routes to /login
- **When** the user clicks Đăng xuất
- **Then** the access token is removed from `localStorage`; hitting any
  protected route bounces to `/login`; the back button does not expose a
  cached page.

### AUTH-03 — Role-based route guarding
- **Given** a user of role X navigates directly to a route reserved for
  role Y (e.g. `/config/app-settings` for any non-ADMIN)
- **When** the route mounts
- **Then** the user is redirected to their home route with no flash of
  forbidden content (no skeletons for the protected page, no error toast).

### AUTH-04 — Sidebar reflects role
- **Given** any user
- **When** the sidebar mounts
- **Then** it shows only the nav items in
  `frontend/src/components/Layout.tsx:85` `getNavItems()` for that role, in
  the section order produced by `getNavSections()`.

### AUTH-05 — Capability-based gating
- **Given** a route guarded by `capabilityOnly('foo.read', ...)` (e.g.
  `/finance/treasury` requires `treasury.read`)
- **When** a user without the capability visits
- **Then** they are bounced to home. The Sidebar must also hide the item.

### UI-01 — i18n & copy
- All user-visible strings are Vietnamese (project default locale is `vi`).
  English only for technical/code terms.
- No raw i18n keys (`home.title`) ever reach the rendered DOM.

### UI-02 — PWA safe areas on mobile
- Bottom nav / driver FAB do not collide with iOS home indicator.
- The driver-app PWA must respect `env(safe-area-inset-bottom)`.

### UI-03 — Loading state
- Every page that lazy-loads shows `<PageLoader />` (`App.tsx:121`) while
  the chunk fetches. No blank screens > 100 ms.

### UI-04 — Error boundary
- A crash in one page does not break navigation to other pages
  (`App.tsx:222` wraps each route in its own `<ErrorBoundary>`).

### DATA-01 — No raw SQL
- Every Drizzle query uses the schema in `backend/src/db/schema/*`. No
  `db.execute(sql\`...\`)` in feature code (allowed only in migration
  helpers).

### DATA-02 — Financial precision
- Currency computations use `round2dp()` or `computeTripTotals()` from
  `shared/src/calculations/`. Never `Math.round`, never `toFixed`.

### AUDIT-01 — Mutating actions log
- Every state-changing endpoint writes an `audit_logs` row visible at
  `/audit-logs` (ADMIN/MANAGER/ACCOUNTANT only). The log includes actor,
  action, target, before/after diff, timestamp.

### PERF-01 — Page load budget
- Local dev, cold cache: first contentful paint on any of the listed
  primary pages (`/shipments`, `/dispatch`, `/accounting`,
  `/my-trips`, `/portal/shipments`) ≤ 2.0 s on a 4× CPU-throttled
  Chromium.

## 6. Evidence & artifacts

Every test run leaves a paper trail under `qa/`:

```
qa/<YYYY-MM-DD>_<scope>_<gate>.<ext>
```

| Gate              | Command (from repo root)               | Required for                    |
|-------------------|----------------------------------------|---------------------------------|
| Lint              | `pnpm lint`                            | every change                    |
| Backend typecheck | `cd backend && npx tsc --noEmit`       | every change                    |
| Backend tests     | `cd backend && pnpm test`              | every change                    |
| Frontend typecheck| `cd frontend && npx tsc -b`            | every change                    |
| Frontend tests    | `cd frontend && pnpm test`             | every change                    |
| Build             | `make build`                           | every change                    |
| E2E               | `cd e2e && ./run_all.sh`               | any API / flow / RBAC / schema change |
| Visual            | Playwright screenshot sweep (manual)   | UI-affecting changes            |

When a role-specific flow ships, drop screenshots into
`qa/<date>_<role>_<flow>/`.

## 7. Test data reset

Local seed (`make setup`) is reproducible. To reset without nuking Postgres:

```bash
cd backend && pnpm db:reset && pnpm db:seed
```

For the driver app, the seed mounts `DRIVER` → `15C-284.56` so any driver AC
that needs a known plate can rely on it. For the customer portal, the seed
creates `CUSTOMER-SAMSUNG` (Samsung Electronics VN) and `CUSTOMER-CANON` (Canon Việt Nam) as row-scoped users.

If a test mutates a fixture (creates a customer, books a shipment, etc.) and
the next test needs a clean slate, **reset the DB before continuing**. Do
not chain tests on top of each other unless the AC explicitly says so.

## 8. Out of scope for this plan

- Load/stress testing (handled separately; current infra is sized for ≤ 50
  concurrent users).
- Security penetration (handled by `security-scan` skill on demand).
- Cross-browser matrix beyond Chromium / WebKit (Safari): the driver app
  ships as a PWA; Safari is in scope, Firefox is not in the QA matrix.
- Disaster recovery / RPO-RTO.

## 9. How to add a new AC

1. Pick the right role document. If the change touches more than one role,
   add the canonical AC to the role that owns the action and reference it
   from the others ("see `01-cus.md` CUS-SHIP-04").
2. Use the AC template in §4. Every AC is binary.
3. Add the test step block so a fresh tester can execute it without
   reading code.
4. If the change affects RBAC, also add a row to the role's "Negative /
   RBAC" table at the end of the document.
5. If the change touches a shared calculation, Drizzle schema, or
   cross-module API, run the full QA gate set including E2E
   (`cd e2e && ./run_all.sh`).
