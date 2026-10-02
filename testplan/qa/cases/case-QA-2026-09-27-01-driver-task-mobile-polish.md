# Case QA-2026-09-27-01 — Driver task screen: bill number, dense completion card, bottom fill

Source: user report 2026-09-27 (phone screenshot of `/my-trips/:id`, iPhone class,
staging), verbatim:

> "polish this page, the buttom still can't fill the mobiel screen there is still big
> fucking gap bototm, also the section showing theiu 2 chung tu take too much space,
> please make them denser as mobiel screen of driver will be quite small, also fix the
> top page why the hell we are showing internal code SHP- .... we should show bill
> number only"

Case id: **QA-2026-09-27-01**. Card: `20260927_1`.

## Scope

Frontend + one backend wire field (`blNumber` on the driver fulfillment detail).
No schema, migration, RBAC or financial-calculation change.

Fixture for the local reproduction (the local DB carries no live driver task):
trip `4394` (driver `laixe`, IN_TRANSIT, `ORDER_RECEIVED` recorded) → fulfillment
`4674` → shipment `9389` (`shipment_code = SHP-2609-00208`,
`bl_number = MSCUVN260900208`, IMPORT, customer LONG MINH, factory site
`Kho seam B 1789702634486`). Reproduction script: `frontend/drv-repro.mjs`.

## Bugs covered

| # | Defect (reproduced at 390px, before) | Fix |
|---|---|---|
| 1 | Header title rendered the **internal shipment code** `SHP-2609-00208` — an ops key the driver cannot use | `driver.service.ts` exposes `blNumber`; `driverClient.mapFulfillmentDetail` resolves `documentNumber` (IMPORT → Số Bill, EXPORT → Số Booking, direction-first); `DriverTripHeader` titles with it, falling back to factory → route → `Lệnh vận chuyển`. The SHP- code is never a fallback |
| 2 | Completion card `Chứng từ giao hàng` occupied **128px** of the first screenful: 2-line instruction + 2-row bullet list restating the sticky bar | Card rebuilt: title row (`--text-section-size`) + one wrapped `·`-separated missing-documents line (`role="list"`); instruction paragraph kept only in the closed state; padding 12→10, gap 10→6 → **56px** measured |
| 3 | Bottom of the screen: the fixed tab bar can be pinned to a **shorter layout viewport** than the visible one (mobile browser/in-app WebView keeps a bottom toolbar strip after layout), exposing a bare strip below the tabs | `.bottom-nav::after` paints the bar's own `--surface` band from the layout-viewport bottom edge downward (fixed, `top:100%`, 160px); `html:has(body .app.is-driver)` takes the same token so the root canvas never shows a foreign gray band. Also removed the double `env(safe-area-inset-bottom)` inside both sticky bars (the tab bar below them already reserves it) |

## Expected behavior

1. `/my-trips/:id` header title = the carrier document number (`bl_number` for IMPORT,
   `booking_ref` for EXPORT); `SHP-…` never appears as the title.
2. `Chứng từ giao hàng` is one dense card: title + one status line (missing docs, or
   "Đủ chứng từ…", or the closed-state hint + e-POD link). ≤ 60px at 360–430px.
3. The tab bar's surface reaches the physical bottom edge; no foreign strip under it;
   the completion/accept bar sits flush above the tab bar with no extra inset gap.

## Evidence (local dev, browser-driven)

- `qa/2026-09-27_driver-task-polish/2026-09-27_driver-task_ui-{360,390,414,430}-top.png`
- `qa/2026-09-27_driver-task-polish/2026-09-27_driver-task_ui-{360,390,414,430}-bottom.png`
- Measurements per width (`.driver-task-footer__body` = 56px; nav `top:100%` band
  `background: rgb(255,255,255)`; root canvas white) in the QA log.

## Regression pins

- `frontend/src/pages/driver/DriverTripHeader.test.tsx` → *"never renders the internal
  SHP- shipment code as the title"* + the document-number title case.
- `frontend/src/pages/DriverTripDetailPage.test.tsx` → header title = document number
  (factory on line 2), route-location fallback with the document number still leading.

## Manual re-run (any agent, < 2 min)

```bash
# fixture (idempotent-ish): trip 4394 → laixe, shipment 9389 bill number
cd frontend && node drv-repro.mjs     # writes the 8 PNGs + per-width measurements
```

Then open `http://localhost:7175/my-trips/4394` as `laixe` / `Abc123` at 390px and
confirm: title is the bill number, the completion card is one line + one status line,
and the tab bar's white surface reaches the bottom edge.
