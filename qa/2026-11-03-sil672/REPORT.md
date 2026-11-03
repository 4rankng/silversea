# SIL-672 — /my-trips: bỏ nút 'Lệnh trong ngày'; paired-orders đổi nhãn 'Lệnh ghép'

Date: 2026-11-03 · Branch: `fix/sil672-day-view-button` · Lane driver: bqhuong / Abc123 (local only)

## Change

- `frontend/src/pages/DriverTripsPage.tsx` — removed the header shortcut
  `<a class="driver-journey__day-view">` to `/my-trips/paired-orders` and its
  `useDriverPairedOrders` count-chip prefetch. The board screen IS the day
  view (tabs Lệnh mới / Đã nhận / Lịch sử + in-day cards), per ticket ruling.
- `frontend/src/pages/DriverTripsPage.css` — removed the orphaned
  `driver-journey__day-view*` blocks.
- `frontend/src/styles/legacy-trip-control-ceiling.styles.test.ts` — dropped
  the removed selector from the control-ceiling scan.
- `frontend/src/pages/driver/DriverPairedOrdersPage.tsx` — page header/title
  renamed `Lệnh trong ngày` → `Lệnh ghép` (loading / error / malformed-date /
  empty states; persisted pair keeps `Lệnh ghép 2 chiều`); body copy follows.
- `shared/src/navigation/pageCatalog.ts` — `myPairedOrders.title`
  `Hành trình · Lệnh trong ngày` → `Hành trình · Lệnh ghép` (document.title).
- Tests updated: `DriverTripsPage.test.tsx` (3 shortcut tests → 1 absence
  test), `DriverPairedOrdersPage.test.tsx`, `DriverTripPodPage*.tsx` comments.
- Entry to paired-orders: removed entirely per ruling ("nếu không có chỗ đặt
  hợp lý thì bỏ hẳn lối vào"); route `/my-trips/paired-orders` and the
  `/my-trips/two-orders` redirect stay alive for external links.

## Gates

| Gate | Command | Result |
|---|---|---|
| Scoped vitest | `cd frontend && pnpm exec vitest run src/pages/DriverTripsPage.test.tsx src/pages/driver/DriverPairedOrdersPage.test.tsx src/pages/driver/PairedOrdersRedirect.test.tsx src/styles/legacy-trip-control-ceiling.styles.test.ts src/pages/DriverTripPodPage.test.tsx` | 5 files, 89/89 passed, exit 0 — `qa/2026-11-03_sil672-day-view-button_fe-vitest-scoped.log` |
| Frontend typecheck | `pnpm exec tsc -p frontend/tsconfig.json --noEmit` | 0 errors, exit 0 — `qa/2026-11-03_sil672-day-view-button_fe-typecheck.log` (empty output = clean) |

## UI drive (rung 3) — `qa/scripts/2026-11-03-sil672-day-view-button-ui.mjs`

Environment: local dev stack — frontend :7175, backend :3002 (`/api/health`
ok), DB ss-prod-db :5441. Puppeteer, viewport 390×844 mobile (deviceScale 2),
token pre-injected per house recipe. `MODE=before` run with the fix stashed
(Vite restarted around each mode so transforms match the served source).

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Shortcut gone from /my-trips (AC1) | UI DRIVEN | `2026-11-03_sil672_ui-mytrips-390-before.png` (button present) vs `…-after.png` (gone); driver log `ui-driver-after.log` PASS `no shortcut link` + PASS `no "Lệnh trong ngày" text`; DOM `a[href="/my-trips/paired-orders"] = []` | roles other than DRIVER (page is driver-only by RBAC) |
| Day-view tabs + cards still work (AC2) | UI DRIVEN | driver log PASS click-through ×3 (`Lệnh mới`/`Đã nhận`/`Lịch sử` panels re-rendered); tabs `["Lệnh mới 0","Đã nhận 2","Lịch sử 5"]`; `…-tab-running.png` ×2 | empty vs non-empty NEW tab on other data days |
| paired-orders loads by direct URL, no 404 (AC3) | UI DRIVEN | driver log PASS both modes; `…paired-orders-390-before.png` / `…-after.png` | `/my-trips/two-orders` redirect click-through (route tested by `PairedOrdersRedirect.test.tsx`) |
| paired-orders renamed, no old label (AC4) | UI DRIVEN | h1 `Lệnh trong ngày` → `Lệnh ghép`; document.title `Hành trình · Lệnh trong ngày · TransTing` → `Hành trình · Lệnh ghép · TransTing`; PASS `no "Lệnh trong ngày" anywhere` | persisted-pair day (today allToday=0 → h1 `Lệnh ghép`; `Lệnh ghép 2 chiều` branch covered by unit test only) |
| No layout break 390/768/1440 (AC5) | UI DRIVEN | PASS `no horizontal overflow, no shortcut` at 768 + 1440; screenshots `…-768-after.png`, `…-1440-after.png` | pointer:coarse touch devices |
| Day-view data untouched | DB/API VERIFIED | identical API identity both modes: journey-board items=10 (RUNNING 2 / HISTORY 8), two-orders allToday=0; DB `trips_total=11 today=1` for bqhuong — `api-identity-*.json`, `db-driver-trips-*.txt` | — |
| Console clean | UI DRIVEN | driver log PASS `console errors none` both modes | — |

Driver logs: `2026-11-03_sil672_ui-driver-before.log` (11/11 PASS),
`2026-11-03_sil672_ui-driver-after.log` (15/15 PASS).

Design provenance: no new component/layout — removal only; the renamed header
reuses the existing `PageHeader` primitive. No catalog consultation required
(no new UI surface); Tailkit/Untitled UI not used.
