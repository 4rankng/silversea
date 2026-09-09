# T6 Phase-1 review — fafe5e37 (QA lane, owner: agent-1788957112192-fvrl)

**Reviewer:** fullstack lane (agent-1788969719950-myqeea)
**Review type:** writer/reviewer separation (PM assignment seq 22, 2026-09-09 16:16:58Z)
**Scope:** read-only review of `fafe5e37` test(pricing): T6 phase-1 unit + integration coverage.
**Output:** findings (this file) → PM + QA. **No fixes applied** (QA owns the file).

## Files reviewed

| File | Lines added | TC ID coverage claim |
|------|-------------|----------------------|
| `shared/src/calculations/fuelSurcharge.test.ts` | +128 (6 new `computeFreightRate` tests, lines 149-277) | TC-CUOC-007, TC-CUOC-008, Câu 1=B, rounding contract |
| `backend/src/tests/freight-pricing-engine.test.ts` | +355 (NEW file; integration suite) | TC-CUOC-015, TC-CUOC-009/016, TC-CUOC-017, TC-CUOC-018 |

**Engine under test:** `shared/src/calculations/fuelSurcharge.ts:115-124`
(`computeFreightRate`) + `shared/src/calculations/round.ts:5-13` (`round2dp`) +
`:18-20` (`roundInt`). Service under test:
`backend/src/services/freight-pricing-engine.service.ts`.

## Verdict

**APPROVE WITH FINDINGS** — both files are well-structured, assertions pin the
intended math, and there is no skip/only/placeholder. Three correctness nits and
two design nits are listed below; QA may address in a follow-up patch without
unblocking the wave (T1/T2/T3/T4 still gate integration tests).

---

## Findings — SHARED (`shared/src/calculations/fuelSurcharge.test.ts`)

### F-S1. **IMPORTANT — Stale "Expected" comment vs assertions in TC-CUOC-008 kỳ 21,740 (test line 197-217)**

The comment block says `Expected: freight=3587500, surcharge=324394, total=3911894`,
but the actual `assert.equal(...)` calls assert `surcharge=324264, total=3911764`.
The actual computed values are mathematically correct (verified by hand:
`(21740 - 17842.5926) * 83.2 = 324,264.29568 → round2dp=324264.30 → roundInt=324264;
total = 3,587,500 + 324,264 = 3,911,764`), so the test PASSES — but the comment
is off by 130 VND on the surcharge and 130 VND on the total. Risk: future reader
re-derives the comment values and assumes the test is broken.

**Suggested fix:** drop the redundant `Expected:` line in the comment OR update it
to match the assertion (`324264` / `3911764`). Three lines touched.

### F-S2. **IMPORTANT — Route label vs share% mismatch in TC-CUOC-007 SUNRISE+SJ 10T (line 158-172)**

Test name says "SUNRISE+SJ 10T" but uses `sharePct: 3`. Per
`docs/prd/CuocPhiThietKeDB.md` §1.2 + §3.1 (and confirmed by
`backend/src/seed/data/pricing.ts` `sharePct` set ∈ {2; 2,5; 4}),
**SUNRISE+SJ = 2.5 %** (NEWEB = 2 %, ASKEY = 4 %). The numeric assertions
(`surcharge === 563179`, `freight === roundInt(round2dp(2_700_000 * 1.03))`)
are mathematically correct for sharePct=3, but the route label in the test name
misleads readers into expecting SUNRISE+SJ-specific inputs.

**Suggested fix:** either (a) rename test to drop the route label
(`computeFreightRate: rounding boundary at non-.5 fractional liters`)
and treat it as a pure HALF_UP pin, OR (b) change `sharePct: 3 → 2.5` and
re-derive the expected `freight` (will become `roundInt(round2dp(2_700_000 * 1.025)) = 2_767_500`)
and verify `total` matches the new freight + 563179.

### F-S3. **IMPORTANT — Route label vs share% mismatch in TC-CUOC-008 CONT20 NEWEB kỳ 21,740 + 27,620 (lines 197-242)**

Both tests use `sharePct: 2.5`, but **NEWEB = 2 %** per CuocPhiThietKeDB §1.2
and the seed file. The numeric assertions are mathematically correct for the
inputs given, but the "CONT20 NEWEB" label in the test name does not match
the NEWEB share%. The actual exercise being tested is "scale-4 base_fuel_price
parity at the largest liters (83.2 L)" — not a route-specific calculation.

**Suggested fix:** rename tests to drop route label
(`computeFreightRate: largest-liters parity at scale-4 base_fuel_price (kỳ 21,740)`)
OR change `sharePct: 2.5 → 2` and re-derive expected `freight` (= 3,570,000)
and totals (= 3,894,264 / 4,383,480).

### F-S4. **NIT — TC-CUOC-007 HALF_UP tie-break: 0.5 boundary pins HALF_UP correctly (line 174-187)**

`assert.equal(tie.surcharge, 1)` for `delta × liters = 0.5` correctly pins
HALF_UP vs banker's rounding because `Math.round(0.5) === 1` in JS (banker's
would give 0). **Confirmed pin — no change needed.** (My initial concern that
this was a weak pin was wrong; the assertion does discriminate HALF_UP from
banker's at the 0.5 boundary.)

### F-S5. **NIT — `round2dp-then-roundInt ordering` test (line 264-276) does not pin the ORDER**

Test name promises "order matters" but the chosen inputs
(`9777.4074 * 1 = 9777.4074`) round to the same integer regardless of order
(`roundInt(round2dp(x)) = round2dp(roundInt(x)) = 9777`). The assertion
`result.surcharge === 9777` does not discriminate `round2dp → roundInt` from
`roundInt → round2dp`. Test serves as a gross-regression check, but the name
overstates coverage.

**Suggested fix:** rename to drop the "order matters" promise. The two orderings
are structurally equivalent under HALF_UP because `roundInt` uses `Math.round`
(which is HALF_UP for positives) and `round2dp` uses the same primitive
internally. The test name should reflect that this is a "value-equivalence
regression check", not an "order discriminator".

### F-S6. **PASS — Câu 1=B negative-clamp epsilon guard (line 235-247)**

`fuelPrice=17842.0`, `baseFuelPrice=17842.5926`, `liters=91`. Hand-verified:
`fuelDelta = -0.5926`; raw surcharge = -0.5926 × 91 = -53.9266; `round2dp` =
-53.93 (sign-flipped Math.round(parseFloat("53.9266e2") + "e-2") =
-Math.round(5392.66)/100 = -5393/100 = -53.93); `roundInt(-53.93) =
Math.max(0, -54) = 0`; `Math.max(0, 0) = 0`. Matches `assert.equal(result.surcharge, 0)`. ✓

Also: `result.fuelDelta === -0.5926` is preserved (no rounding) — correct per
§4.2 contract that `fuelDelta` keeps precision for UI explanation.

### F-S7. **PASS — Zero liters defensive case (line 249-261)**

`liters=0` → surcharge=0 (clamp + multiplication), freight=1,050,000 (sharePct=5),
total=1,050,000. ✓

---

## Findings — BACKEND INTEGRATION (`backend/src/tests/freight-pricing-engine.test.ts`)

### F-B1. **IMPORTANT — 422 vs 400 mismatch with testplan for TC-CUOC-018 (line 325-336)**

Testplan `testplan/flows/12-cuocphi-phuphi-dau.md` §12.4 TC-CUOC-018 says
**"thiếu lý do ⇒ 422 Unprocessable Entity"**. The integration test asserts
`/Bắt buộc nhập lý do/` (matches the message), and the engine throws
`ApiError(400, 'Bắt buộc nhập lý do khi thay đổi giá cước')` at
`backend/src/services/freight-pricing-engine.service.ts:325`. So the **engine
returns 400, the testplan expects 422, the test asserts the engine behavior (400)**.

**PM decision needed:** is TC-CUOC-018 supposed to be 422 (semantic validation)
or 400 (bad request)? Other validation in this codebase uses 400 for body
validation and 422 for semantic errors. The engine-level guard is pre-route
validation, so 400 is defensible — but the testplan should be updated either
way. (Suggested: keep engine at 400 + update testplan §12.4 TC-CUOC-018 to
"thiếu lý do ⇒ 400".)

### F-B2. **IMPORTANT — Silent skip if prior describe-block setup failed (line 297-298, 326-327, 341-342)**

Tests "one row per snapshot: …" / "changing final without reason → 400" /
"final == system with no reason → allowed" all do:
```js
if (!snapshotId) {
  // Setup failed earlier — skip silently so the suite can finish.
  return;
}
```
This silently PASSES if the upstream `persistFreightRateSnapshot` test failed.
Net effect: a regression in snapshot persistence could leave all three
override tests green-as-skip, masking the real failure.

**Suggested fix:** replace `return` with `assert.fail(...)` so a missing
upstream snapshot cascades as a test failure, OR have the override tests
create their own snapshot in a `before()` block so they don't depend on
prior describe-block state.

### F-B3. **NIT — TC-CUOC-009 test only persists with `shipmentId: null, tripId: null` (line 261-289)**

The test verifies that the snapshot row is written with all 4 FK refs and the
3 amount columns, but doesn't exercise the `shipmentId`/`tripId` wiring path
(those are the T1 wiring responsibilities, not engine-service concerns). This
is correct scoping — the test ID label "TC-CUOC-009/016" implies full
lock-at-create flow, but the actual unit-under-test is `persistFreightRateSnapshot`.
**Acceptable for Phase-1** but worth noting: TC-CUOC-009 lock-at-create (snapshot
written from `shipment-create.service.ts` and/or dispatch flow) requires a
higher-level integration test once T1 lands. (QA's T6 handoff already notes
this as Phase-2 entry point #1.)

### F-B4. **NIT — TC-CUOC-017 uniqueness assertion is solid (line 295-322)**

Verifies: (a) second upsert hits same row (id1 === id2), (b) only one row in
`debit_note_overrides` per snapshot (rows.length === 1), (c) `final_debit_freight`
was updated to the new value. ✓ Confirmed against engine source at
`freight-pricing-engine.service.ts:336-349` (update branch when existing).

### F-B5. **NIT — TC-CUOC-015 two-test isolation is correct (line 188-256)**

Each test creates its own customer/route/vehicle-class via `mkCustomer()`/
`mkRoute()`/`mkVehicleClass()` to avoid cross-test state. The first test
intentionally omits `pricing_tables` (triggers MANUAL). The second test
explicitly inserts `price='0'` (triggers the `Number(price) === 0` guard at
`freight-pricing-engine.service.ts:115-117`). Both paths verified. ✓

---

## Cross-cutting checks (PM checklist, seq 22)

| Check | Result |
|-------|--------|
| Test/impl parity vs flows/12 §12.4 TC registry | **6/8 covered** (TC-CUOC-007, TC-CUOC-008, TC-CUOC-015, TC-CUOC-009/016, TC-CUOC-017, TC-CUOC-018) — TC-CUOC-018 status-code drift (F-B1) |
| Fixture figures match Excel (I=1.300.000, share 2 %, F=17.842,5926) | **2 mismatches** — TC-CUOC-007 sharePct=3 (SUNRISE+SJ=2.5) (F-S2), TC-CUOC-008 sharePct=2.5 (NEWEB=2) (F-S3). Note: basePrice 3,500,000 for "CONT20 NEWEB" is a synthetic test value, not an Excel row — acceptable as scale-4 parity probe. |
| HALF_UP assertions actually pin HALF_UP (not implementation-dependent) | **PASS** — `0.5 → 1` tie-break test (F-S4) correctly discriminates HALF_UP vs banker's. Order test does not pin order (F-S5) but asserts correct value. |
| No test has skip/only/placeholder | **PASS** — `grep -nE "(\.skip\|\.only\|todo\|fixme\|placeholder\|XXX)"` returns 0 matches in both files. |
| Engine code references for cross-check | `shared/src/calculations/fuelSurcharge.ts:113,118` (clamp + round), `:122` (J formula), `:125` (K); `shared/src/calculations/round.ts:5-13` (round2dp), `:18-20` (roundInt); `backend/src/services/freight-pricing-engine.service.ts:113-129` (MANUAL fallback), `:268-282` (snapshot persist), `:325,328` (reason 400), `:336-349` (upsert update branch), `:354-369` (insert branch). |

---

## Suggested patch scope (for QA's next cycle)

Three low-risk edits — total ~6 line changes:
1. Fix the stale "Expected:" comment in TC-CUOC-008 kỳ 21,740 (F-S1).
2. Rename or fix sharePct in TC-CUOC-007 SUNRISE+SJ 10T (F-S2).
3. Rename or fix sharePct in TC-CUOC-008 CONT20 NEWEB (F-S3).

One semantic question for PM (F-B1): 422 vs 400 for TC-CUOC-018.

Two robustness improvements:
4. Replace silent `return` with `assert.fail(...)` in TC-CUOC-017/018 if upstream snapshot missing (F-B2).

These do NOT block the wave — engine + schema COVERED, T1/T2/T3/T4/T6 Phase-2
integration is the real gate. Reviewer (fullstack lane) records APPROVE WITH
FINDINGS; QA can address in a follow-up commit or defer to Phase-2.
