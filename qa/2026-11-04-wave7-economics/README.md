# Wave-7 economics evidence — SIL-676 + SIL-638 TC3-T3 (2026-11-04)

Branch `fix/sil-wave7-economics`. Local stack: backend :3102 (this worktree),
frontend :7176 (this worktree, proxied to :3102), DB `ss-prod-db` (prod mirror).
QA pair 36 (trips 1321/1322) completed on the FIXED build; BEFORE pair 34
(trips 1310/1311) completed on the merge-base build (same worktree, stash).

## Files

| File | What it proves |
| --- | --- |
| `e2e-pair-economics.py` | Harness: 2 CONT20 lots → dispatch → pair KẸP → complete BOTH legs via driver-app close ONLY (no actuals save — the staging pair-29 shape) → read economics. `before`/`after` modes. |
| `e2e-pair-economics-before.log` | BEFORE run log (pair 34, pre-fix build). |
| `before-dump-oldbuild.py` / `.log` | BEFORE state of pair 34 on the merge-base build: leg A `driverSalary NULL`, no ledger DRIVER_SALARY for leg A, GET /api/trips has NO `costBreakdown`, GET /api/settlements has 0 TRIP_PAIR rows. |
| `e2e-pair-economics-after.log` | AFTER run (pair 36, fixed build): **FAILURES: 0** — VETC once (leg A 110.000 / leg B 0 + deduction 110.000), driverSalary both legs immediately after driver close (192.308 / 200.000 phụ phí), costBreakdown on trips composite + driver detail both legs, settlements OS-PAIR-36 exactly once, ledger DRIVER_SALARY both legs, regression snapshot 3.952.000/pricingTableId 33 + pricing lookup 3.800.000. |
| `after-dumps.py` / `after-dumps-ledger-snapshot-settlements.log` | AFTER DB/API dumps: ledger postings, snapshot row, trip_financial_state both legs, GET /api/settlements admin (batches + all OS-PAIR rows incl. historical pair 29 — the original staging FAIL pair — now observable). |
| `ui-drive-driver.mjs` / `ui-driver.log` | UI DRIVEN at 390×844 (driver `laixe`, real driver app): 9 PASS / 0 FAIL, 0 console errors. |
| `ui-390-legA-cost-breakdown.png` | Leg A driver detail with Chi phí chuyến section centered (VETC 110.000 ₫, lương 192.308 ₫, phụ phí 0 ₫). |
| `ui-390-legB-cost-breakdown.png` | Leg B driver detail (VETC honest 0 ₫, phụ phí 200.000 ₫). |
| `ui-390-cost-section-closeup.png` | Close-up of the section grid at 390px. |
| `ui-shot-cost-section.mjs` | The close-up capture driver. |

## Gates run (2026-11-04)

| Gate | Command | Result |
| --- | --- | --- |
| Backend typecheck | `cd backend && npx tsc --noEmit` | 0 errors |
| Backend unit (full) | `npx tsx --test 'src/tests/unit/*.test.ts'` | 872/872 pass (incl. 20 new wave-7 tests + updated sil676 alias pin) |
| Frontend typecheck | `cd frontend && npx tsc -b` | 0 errors |
| Frontend vitest (driver scope) | `npx vitest run src/pages/driver/` | 7 files / 88 tests pass |
| Root lint | `pnpm lint` | see `../2026-11-04_wave7_lint.log` |
| uiux POLISH verdict | §3 flow | **Approve** — posted to SIL board, SIL-638 comment 3807 |

## Phụ phí Kẹp ruling note

Spec 638 TC3 states the LAW ("lương tài xế = lương chuyến cơ bản + phụ phí kẹp
hàng") but fixes NO number. The existing repo law (LoHangKepKetHop §4.2 /
TC-GHEP-007, pre-wave7) reads the surcharge from `app_settings`
(`salary.pair_surcharge_kep`) — kế toán tunes it without a deploy. No new
formula was invented: with the setting configured (200.000 in QA) leg B's wage
IS the phụ phí; unconfigured (0) the standard base allocation applies and the
breakdown shows the explicit `0 ₫` line. Owner may set the production value in
app_settings.
