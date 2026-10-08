# Case 317-dup-tractor-plan-row — duplicate tractor on plan-row edits is refused

- **Card**: 20261003_317 (P1 regression)
- **Surface**: PATCH /shipments/dispatch-detail-plan-rows/:fulfillmentId/plan
- **Repro (staging, dungnv)**: PATCH row 169/plan then row 189/plan with the
  same truckId=11 in overlapping windows → both 200 (no validation).
- **Expected**: the second overlapping assignment returns 409
  'Đầu xe <biển số> đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp.'

## Contract (automated: backend/src/tests/dispatch-plan-row-rig-conflict.test.ts)

| Case | Expected |
|---|---|
| A1 first assignment of the rig | allowed |
| B1 same rig, overlapping window, different fulfillment | 409 (conflict message) |
| C1 same rig, provably disjoint window (different day) | allowed |
| A2 self re-save (same row, same rig, same window) | allowed (self excluded) |

The conflict key pre-dispatch is the PLATE (planned_vehicle_plate_number — no
planned truck id is persisted); dispatched trips join by trucks.license_plate.
Windows: the container's customer appointment (start) and the saved Giờ trả
hàng (end); rows without their own appointment are skipped (cannot prove
overlap). The reconciliation semantics (Kẹp/Kết hợp exemptions) remain the
dispatch-issuance gate's domain (assertResourceAvailability) — this gate
covers the pre-dispatch plan state only.

## Pass criteria

- B1 red at HEAD (observed: 200, no rejection), green with the gate.
- C1/A1/A2 green; the dispatch family suites green.
- The UI surfaces the 409 as the save-time error toast on the detailed plan
  (the card's AC2 warning = the visible refusal at save).
