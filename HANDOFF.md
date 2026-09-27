# HANDOFF.md — driver task screen polish (+ preserved journal incident)

**Updated:** 2026-09-27 ~09:40 (+08)
**Controller:** omp session — user order 2026-09-27 (phone screenshot of
`/my-trips/:id`): polish the page → commit → push.
**Status:** DONE and verified in-browser; case QA-2026-09-27-01 landed.
Commit stages **only this card's files** — two other sessions are editing this
same worktree uncommitted (see *Concurrent work*).

## Goal

Card `20260927_1`, three user-reported defects on the driver task screen:

1. the header titled the trip with the internal shipment code
   (`SHP-YYMM-NNNNN`) — it must title with the carrier's document number
   (Số Bill on IMPORT / Số Booking on EXPORT);
2. the `Chứng từ giao hàng` completion card was too tall for a driver's small
   phone (2-line instruction + 2-row bullet list);
3. the page did not fill the screen: a strip could show below the fixed tab
   bar, and both sticky bars re-added `env(safe-area-inset-bottom)` that the
   tab bar beneath them already reserves.

## Files owned by this task

`frontend/src/pages/driver/DriverTripHeader.tsx` (+ `.test.tsx`) ·
`frontend/src/pages/DriverTripDetailPage.{tsx,css}` (+ `.test.tsx`) ·
`frontend/src/api/driverClient.ts` (`documentNumber`) ·
`backend/src/services/driver.service.ts` (`blNumber` on the detail wire) ·
`frontend/src/components/layout/bottom-nav.css` (canvas tone + `::after` band) ·
`frontend/drv-repro.mjs` (re-runnable instrument) ·
`testplan/qa/cases/case-QA-2026-09-27-01-driver-task-mobile-polish.md` ·
`qa/2026-09-27_driver-task-polish/` · one `docs/design-guidelines.md` §12 row.

## Local fixture (required; the local DB has no live driver task)

trip `4394` → driver `laixe` (`drivers.id = 1`, IN_TRANSIT, `ORDER_RECEIVED`
recorded) → fulfillment `4674` → shipment `9389` (`SHP-2609-00208`,
`bl_number = MSCUVN260900208`, IMPORT, customer LONG MINH, site
`Kho seam B 1789702634486`). Re-seed SQL lives in the case file.
Re-capture: `cd frontend && node drv-repro.mjs`.

## QA

`qa/2026-09-27_driver-task-polish/2026-09-27_driver-task_summary.md` — driver
suites 248/248, both typechecks 0, build 0, four phone widths captured and
measured (card 128px → 56px; title = bill number; tab-bar surface band at
`top: 100%`). Full-suite reds are foreign (other commits/sessions) or the
journal-contiguity incident below. Real-device iOS/WebView slack strip:
NOT TESTED (Chromium clamps `captureBeyondViewport` to the layout viewport).

## Concurrent work (do not sweep into commits)

- Card `20260927_02` (uncommitted): `MasterPlanGrid.css`, `MasterPlanPage.tsx`,
  `untitled-ui/base/input|select/*`, `ListFilterBar.tsx`, master-plan tests.
- Pre-existing red at HEAD: `o2c-rev1.migration-safety` (journal contiguity),
  `overlay-surface` / `workboard-standard` / `font-family-contract` style
  contracts pointing at `CustomersPage.tsx`, `RoutesConfigPage.tsx`,
  `AccountingInvoiceTrackingPage.css`, `App.tsx`.

## ⚠️ Journal-restamp incident (preserved, alert channel = THIS FILE)

**Socket alert to `silversea-prod-7a` (pid 4697) FAILED delivery** — sends
succeed but no reply, transcript count 0 = the skill's listener-dead
signature; target needs a session restart.

- The idx 128→127 renumbering attempts on `backend/drizzle/meta/_journal.json`
  were a previous session's (python, idx-field only; no drizzle tool running).
  After the orchestrator's revert it re-applied once, then **fully reverted**
  (worktree + index match HEAD; idx@127 = 128 gap intact). A signed-repair
  commit attempt was **refused by the append-only guard**; **no `--no-verify`
  was or will be used.** This session touched no journal file
  (`git diff --stat -- backend/drizzle/meta/_journal.json` empty).
- **Do not commit a restamped/renumbered journal — especially not via
  `--no-verify`.** Risk: 42710 duplicate-object class on the next staging +
  prod migrate and every future deploy failing until hand-repaired. A real
  migration only APPENDS (next idx 133); if the guard refuses →
  `git checkout -- backend/drizzle/meta/_journal.json` and regenerate properly.

## Deploy state

- **No cut made.** Staging was healthy at `ce9a5c1e`, prod at `65de3492` per the
  orchestrator's earlier report; the prod cut waits for tree-clear and is owned
  by the orchestrator. This session's push is the only remote action taken and
  was explicitly requested by the user for this card.
