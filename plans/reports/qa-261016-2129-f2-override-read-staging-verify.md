# QA verify — card 161026113900 (F-2 override READ law + F-4 revenueOverrideReason) on staging

**Verdict: PASS 4/4** on staging `vantai.tingting.vip` @ build **e3286338** (exact mission pin), 2026-10-16 21:44–22:05 +07. Evidence + `summary.json`: `qa/2026-10-16_161026113900_f2-override-read/`. STAGING ONLY; prod untouched.

## Checks

| # | Claim | Verdict | Rung | Key evidence |
|---|---|---|---|---|
| 1 | Merge-override marker → debit money boards READ `trip_financial_state.revenue` | PASS | UI DRIVEN | A renders **7.654.321** on both boards after a M2.1 revenue stamp (no snapshot could produce it); member B renders **0** + "Ghép cước cùng Bill QA-F2-10162045-A" note; `ui-cus-debit.png`, `ui-accounting-board.png`, 6/6 UI verdicts |
| 2 | `freight_rate_snapshots` not mutated | PASS | DB/API VERIFIED | 180-row full-table dumps byte-identical after stamp / around merge2 / after purge; 0 rows ever referenced fixture lots |
| 3 | No marker → snapshot-sum fallback unchanged | PASS | API VERIFIED + UI control | 6/6 pre-existing FCL snapshot lots read exactly the DB-computed latest-grain sums on both boards; control lot C shows Chưa xác định / Thiếu cước thu |
| 4 | Trip GET exposes `revenueOverrideReason` (m21) | PASS | DB/API VERIFIED | GET /api/trips/{190,193} return the merge reason + `revenueOverriddenAt`; unstamped trips expose the key as null |

Fixture chain: QA customer 96 → LCL lots A/B/C/D/E (624–628, `QA-F2-10162045-*`) → EXTERNAL trips 189–193 → rev-group merges [A,B] and [D,E] (201) → M2.1 stamp on trip 189. Every write carried an `Idempotency-Key`.

## Teardown (all fixtures voided/purged)

API deletes (trips ×5, shipments ×5 with optimistic-lock versions) → sanctioned `make qapurge-dry` + `make qapurge` (deleted=83 registry-wide; exit 2 = pre-existing guarded skips, same as prior waves) → guarded DELETE of 5 orphaned `trip_financial_state` rows (no registry surface; before-image logged) → residual check: 0 live QA-F2 shipments/customer, snapshots table identical.

## Notes / residuals

- **Informational (pre-existing, out of scope):** `updateTripFiguresSchema` has no `revenueOverrideReason` field, so the M2.1 reason string cannot travel through the HTTP figure-update routes; merge/unmerge stamps and GET exposure (verified here) carry it. Owner may want an m21 follow-up.
- The A-stamp write preceded the first snapshot dump (first phase-1b run aborted on a column-name error mid-script); check 2 is carried by the clean merge2 before/after cycle + count-180 pre-write probe + full-content identity everywhere else.
- C5 (debt-summary follow-up from the F-2 handoff) was NOT in this task's scope and was not tested.
