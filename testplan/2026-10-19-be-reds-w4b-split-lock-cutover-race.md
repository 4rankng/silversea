# 2026-10-19 — w4 accounting/governance: split-brain payroll lock + receive/cutover fixture race

Context: wave-4 log `/tmp/be-final.log` (3363/3352/11). All 7 group-2 tests pass
isolated and pass a sequential full suite at base 64f81514; the reds fire only
when test FILES run as parallel processes against the shared dev DB
(be-final wall span 331s vs 21min of suite time = file-level parallelism).
`fix-be-reds-w4-a` + `fix-be-reds-final` (merged 38a2d814) landed advisory locks
and hermetic probes for these files. Two residual defects survive that merge:

## BUG-1 — split-brain lock key for `app_settings['salary.payroll_business_unit_id']`

- The payroll cluster (q09, q10, q11, m73, q15-routes, final-q01) serializes on
  `cross-suite-lock.ts` key `(906416, 1)`.
- `app-settings-routes.test.ts` serializes on `suite-serial-lock.ts` key
  `(906415, 2)` — a DIFFERENT advisory lock (w4-a/final merged two parallel
  helper designs).
- `app-settings-routes` PUTs `salaryPayrollBusinessUnitId` to its own fixture
  unit and restores + deletes that unit in `after()`. Because it holds the
  wrong lock, its PUT/restore lands inside q10/q15's pinned window:
  - q10 → 404 `Không tìm thấy lái xe đã chọn trong phạm vi kỳ lương`
  - q15 → 409 `Đơn vị tính lương đã cấu hình không còn hoạt động`
    (restore points the key at the unit the other suite then sweeps).
- Additionally `m53-credit-limit` and `q01-credit-override-routes` call
  `saveAppSettings({ ...originalSettings, ... })` (writes the payroll key too)
  with NO lock at all — same clobber class.

**Repro:** run `app-settings-routes.test.ts` and `q10-salary-exclusion-routes.test.ts`
as two concurrent `tsx --test` processes (repeat until overlap); expect q10 red.
**Expected:** q10/q15 green while app-settings-routes runs concurrently.
**Fix:** every payroll-key writer holds `CROSS_SUITE_LOCK_KEYS.payrollUnit (906416,1)`;
delete the dead second helper.

## BUG-2 — receive-without-account vs concurrent ACTIVE cutover fixture (422)

- `POST /api/payments/receive` without `treasuryAccountId` is legal only while
  no ACTIVE treasury account has `cutoverAt <= now`
  (`resolveTreasuryPaymentContract` → `hasActiveCutoverAt` → 422
  `Phải chọn tài khoản tiền mặt/ngân hàng sau thời điểm chuyển đổi kho quỹ`).
- Three suites create exactly such an ACTIVE fixture account mid-run and sweep
  it in `after()`: `treasury-reversal-governance` (cutoverAt 2026-07-01),
  `q03-payment-refund-governance` (2026-07-01), `treasury-route-idempotency`
  (2026-08-01).
- Under file-parallel execution their account window overlaps
  `q03-payment-receipts-route`'s first keyed submit → the standing wave-4 red
  `422 !== 201` at q03 line 308. The w4-a fix for q03 only widened the
  audit/notification wait budgets — it does not touch this 422.
- No lock protects this invariant (neither side takes one for cutover).

**Repro:** run `q03-payment-receipts-route.test.ts` concurrently with
`q03-payment-refund-governance.test.ts` (or `treasury-reversal-governance`);
expect q03 first submit 422.
**Expected:** q03 green under the same concurrency.
**Fix:** new `cross-suite-lock` key `treasuryCutoverWindow (906416,3)` held by
q03-payment-receipts-route for the file and by each cutover-fixture suite from
before the account insert until after the delete.

## Verification

- `cd backend && npx tsc --noEmit` → 0 (tsc 5.9.3; artifact `qa/2026-10-19_reds-w4b_tsc.txt`).
- Root `pnpm lint` (eslint) → exit 0.
- BUG-1 repro BEFORE fix: concurrent `m53 ∥ q10` left
  `salary.payroll_business_unit_id=2536` pointing at a deleted unit — m53 then
  failed 9/9 isolated with 400 `Đơn vị tính lương không tồn tại...`
  (artifact `qa/2026-10-19_reds-w4b_bug1-pollution-repro.log`); DB hygiene
  cleared the pin.
- BUG-1 AFTER fix: `m53 ∥ q10` ×4 rounds and `app-settings-routes ∥ q10` ×4
  rounds — all green, pin stays clean (`..._bug1-race-fixed.log`).
- BUG-2 mechanism BEFORE fix: a held ACTIVE cutover account made
  `q03-payment-receipts-route` fail 5/7 with `422 !== 201` — byte-identical to
  the wave-4 red (`..._mechanism-cutover-422.log`).
- BUG-2 AFTER fix: `q03-receipts ∥ treasury-reversal ∥` and both other creators,
  3 rounds each — green; cooperative-holder proof: a holder keeping the lock +
  a live cutover account for 6s blocked receipts until release, then receipts
  passed 6/6 (`..._bug2-race-fixed.log`).
- 14 touched/group files green isolated.
- Full integration suite on a quiet DB: see `qa/2026-10-19_reds-w4b_be-full-suite.log`.

Gates touched by this change (backend test files only): root lint, backend
typecheck, backend tests — green. `make build` compiles `tsconfig.build.json`
which excludes `src/tests`, so the build output is byte-identical to base;
frontend gates unaffected.
