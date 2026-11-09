# QA gates — SIL-759 + SIL-765 (r7b-glm lane, 2026-11-09/10)

Base: fix/r7b-forms-glm @ 6d7a3886 (= origin/main). Machine: mini (local).

| Gate | Command | Result |
|---|---|---|
| Root lint | `pnpm lint` | EXIT 0 — 0 errors, 6 pre-existing warnings (files untouched by this lane) |
| Backend typecheck | `cd backend && npx tsc --noEmit` | EXIT 0 |
| Backend tests | `cd backend && pnpm test` | EXIT 0 — 342 passed / 0 failed (incl. new unit/shipment-extra-pickup-warehouses.test.ts 4/4) |
| Frontend typecheck | `cd frontend && npx tsc -b` | EXIT 0 (after fixture fixes for the new required detail field) |
| Frontend tests (affected) | `npx vitest run` scoped batches | EXIT 0 — 132 passed (8 files incl. cost form 32, draft 6, lcl-points 11, model, liftDropPoints, prefill, clerk page 53, portal lift-drop) |
| Build | `make build` | EXIT 0 — vite build ✓ 30.13s |
| Full FE suite | `cd frontend && pnpm test` | 6336 passed / 16 failed → isolated rerun on quiet machine: all non-pre-existing failures clear (clerk page fixed for the new sibling button; numeric-identity cleared by fresh build). 3 REMAINING failures are PRE-EXISTING at base — verified by `git stash` run on clean HEAD (same 5 failures incl. AccountingWorkspaceRoot ×2): table-no-truncation.styles (detailed-plan grid SIL-515), ShipmentContainersPage.styles (pending state), ShipmentsPage.density (editor triggers). None touch this lane's surfaces (driver cost form / LCL create + detail). Not weakened, not skipped. |

UI DRIVEN evidence (AGENTS §9) — see qa/2026-11-09_sil759_ui-driver.log, qa/2026-11-09_sil765_ui-driver.log:
- SIL-759: DRIVER_EXIT:0 (14 DOM asserts + DB: driver_incidental_costs row INVOICE-derived, occurred_at=today, photo; trips.cost_submission_note) + MONEY_EXIT:0 (Tạm tính định mức 450.000 ₫ locked, no add control) — screenshots 01…09 at 390/768, role bqhuong.
- SIL-765: DRIVER_EXIT:0 (create lot SHP-2611-00426 via [+ Thêm kho lấy hàng]: VICONSHIP + GLC; per-row delete; "+ Thêm kho" intact) + DETAIL_EXIT:0 (API additionalPickupWarehouses=[GLC]; /shipments/779508 shows both) — DB shipment_pickup_warehouses row `1:12` — screenshots 01…06 at 1440/768, role tiepvv.

uiux verdicts: APPROVE posted pre-commit (board comments 4870, 4871).
Independent review (ReviewR7B): BLOCK → all findings fixed (FUEL-filter HIGH restore, operationalName coalesce, LCL-only schema 400 on create/quick/update, normalize extraction + unit tests, dead fee-norm trio deleted, prefill round-trip tests, ONE-rule comment corrected).
