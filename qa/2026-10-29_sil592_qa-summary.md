# SIL-592 (id 692) — QA gate summary (2026-10-29, worktree fix-sil-692)

Local dev only. No deploy. Branch `fix-sil-692` off origin/main @ 28c3a120.

| Gate | Command | Result | Artifact |
|---|---|---|---|
| Root lint | `pnpm lint` | 0 errors (9 pre-existing warnings, none in changed code) | this file |
| Backend typecheck | `cd backend && npx tsc --noEmit` | 0 errors | this file |
| Backend tests | `cd backend && pnpm test` | 338/338 pass, exit 0 | `2026-10-29_sil592_be-test.txt` |
| Frontend typecheck | `cd frontend && npx tsc -b` | 0 errors | this file |
| Frontend tests (full) | `cd frontend && pnpm test` | see `2026-10-29_sil592_fe-test-final.txt` | `2026-10-29_sil592_fe-test-final.txt` |
| Build | `make build` | success, exit 0 | `2026-10-29_sil592_build.txt` |
| Shared schema tests | `cd shared && npx tsx --test src/schemas/cus-shipment-workspace.test.ts` | 19/19 pass | (in shared-test.txt scope) |
| Scoped FE tests (new pins) | `npx vitest run cusUtils.externalClose ShipmentContainerLedger.external-close CusLotView.external-close` | 19/19 pass | this file |
| UI drive (rung 3) | `node qa/scripts/2026-10-29-sil592-cus-external-trip-complete-ui-drive.mjs` | 12/12 PASS, exit 0 | `2026-10-29_sil592_ui-driver.log` + PNGs + `2026-10-29_sil592_db-proof.txt` |

## Pre-existing red on trunk (NOT introduced by this change)

`cd shared && pnpm test` → 10/289 fail, all inside
`shared/src/calculations/fifoAging.test.ts` (`computeFifoAging`, last touched
by cb9e7242 "fix(finance): 'quá hạn' is the contractual overdue span…").
This diff touches only `shared/src/schemas/cus-shipment-workspace.{ts,test.ts}`
(schema pin) — `fifoAging` is outside its import graph; the failing file runs
against pristine trunk code. Financial-calculation repair needs its own ticket
(broadest QA per AGENTS.md §2/§5). Evidence: `2026-10-29_sil592_shared-test.txt`.

## UI verification coverage (AGENTS.md §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| CUS workboard (Chi tiết lô hàng) shows "Hoàn thành" for a live plated external trip and completes it end-to-end | UI DRIVEN | `ui-desktop-button.png`, `ui-desktop-dialog.png`, `ui-desktop-completed.png`, `ui-driver.log` T01/T05, `db-proof.txt` (trip 50 CREATED→COMPLETED v3 via the real button click) | roles other than CUS on this screen (allowlist hiding pinned by unit tests only) |
| Drawer (Tổng quan lô hàng → Chi tiết) shows the same close action on the live container line | UI DRIVEN | `ui-drawer-button.png`, `ui-driver.log` T02 | completing FROM the drawer (same shared component + handler contract, pinned by `CusLotView.external-close.test.tsx`) |
| Mobile 390px: button wraps, never clips | UI DRIVEN | `ui-mobile-390-button.png`, `ui-driver.log` T03 (geometry: 87×40 in 352px cell, `white-space: normal`, no overflow) | 768px tablet width |
| Plate-less deferred trip shows NO dead affordance (server 409 precondition) | UI DRIVEN | `ui-desktop-no-button-plateless.png`, `ui-driver.log` T04 | — |
| Failure path keeps dialog open with server reason | CODE-READ + unit | `ShipmentContainerLedger.external-close.test.tsx` ("keeps the dialog open…"), live 409 captured in `ui-driver.log` run-1 note | live failed-confirm drive at rung 3 |

Account/role: local CUS (`cus`, testplan/testaccounts.txt). Environment:
local `make dev` contract (frontend 7175 / backend 3002 / dev DB 5441).
Rows: FFAU6012758 (lot WITSE2609038, trip 50), lot R42DIS-02 (trip 54),
TCNU5789751 (trip 39, plate-less control).
