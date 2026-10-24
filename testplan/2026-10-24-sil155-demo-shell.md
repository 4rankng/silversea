# SIL-155 — Demo Shell + Navigation (regression note)

Case ID: TC-SIL155-01 (routes render), TC-SIL155-02 (sidebar active state),
TC-SIL155-03 (fixtures integrity), TC-SIL155-04 (UI driven 1440/390).

Spec: 2026.10.24_Demo_layout.docx §2 (App Shell & Navigation). Ticket
SIL-155 (board plan.tingting.vip/tingtingsoft/SIL). Branch `demo24-shell`.

## Scope under test

- 6 demo routes under `/demo`: dashboard, dispatch, port-payments, billing,
  master-data, driver-app — each a placeholder page (title + skeleton) inside
  a shared demo shell.
- Demo App Shell: left sidebar (6 items, VN labels per spec) + top header
  (breadcrumb + search + user), built from vendored Untitled UI base
  components (`components/untitled-ui/base/*`) — no new libraries.
- Fixture seed `frontend/src/demo/data/`: ~20 trips / 6 đầu kéo / 8 khách
  hàng / 4 cảng, typed exports, shared by the demo lanes that follow.

## Reproduction / expected behavior

- TC-SIL155-01 — visiting each `/demo/*` path renders its placeholder page
  (H1 = the spec label) inside the demo shell; `/demo` redirects to
  `/demo/dashboard`. Auth-only: unauthenticated users still bounce to /login
  (demo is fixture-only, deliberately open to every authenticated role).
- TC-SIL155-02 — the sidebar marks exactly the current route's link with
  `aria-current="page"`; the other five do not carry it.
- TC-SIL155-03 — seed integrity: counts (20 trips / 6 trucks / 6 drivers /
  8 customers / 4 ports), unique cont numbers, referential integrity for
  customer/truck/driver/port ids, ≥1 port lift fee per trip, timeline blocks
  ordered and inside 00:00–24:00, ≥1 export trip missing container specs
  (feeds the dispatch warning KPI in the next lane).
- TC-SIL155-04 — real browser: shell renders at 1440 and 390 without
  horizontal clipping; sidebar nav visible at 1440, hamburger + overlay at
  390; screenshots + DOM assertions + driver log under `qa/`.

## Automated coverage

- `frontend/src/demo/demo-shell.routes.test.tsx` (TC-01/02)
- `frontend/src/demo/data/seed.test.ts` (TC-03)
- TC-04 via the UI driver log/screenshots named in the ticket Done comment.

## Known boundaries

- Demo pages make **zero API calls** by design (fixtures only); the real
  dispatch/billing screens are untouched.
- Demo tree is excluded from `PAGE_CATALOG`/`getNavItems` on purpose: the
  production sidebar must not grow demo entries (nav-sweep stays green).
