# Case QA-2026-10-03-2 — Vehicle-conflict false alarm for Kết hợp sequences (Kẹp intact)

- **Card**: 20261002_271 (A03, P1)
- **Surface**: dispatch detailed-plan save (write gate `dispatch-resource-availability`)
- **Class**: false-positive 409 on legitimate same-rig day plans
- **mutates**: 2 shipment rows + 2–3 trip rows per scenario via the detailed-plan
  save (matrix suite runs on a throwaway DB clone; staging pass uses its own
  fixture bill)
- **Source**: card 20261002_271; prior-lane survey block in the card docx

## Repro (field report 01-10-2026, Kết hợp variant)

1. Log in as dispatcher (`dungnv`).
2. Take/create two fulfillments classified Kết hợp (COMBINED) scheduled
   back-to-back inside one business day on the same tractor + mooc + driver.
3. Save the second assignment in the detailed plan.
4. OBSERVED (pre-fix): save rejected with red toast "Xe đầu kéo đã bị trùng
   lịch kế hoạch" (no COMBINED exemption existed in the gate).
   EXPECTED (post-fix): save succeeds — declared sequential runs on one rig
   in one business day are legal.

## Kẹp side (unchanged, pinned)

The both-declared Kẹp clamp already passed at HEAD and keeps passing
(T1/T3/T6/T7 matrix rows + `VID-DSP-02/03/04` pins in
`dispatch-fulfillment.test.ts`). A DOUBLE incoming vs a partner still
declared SINGLE stays blocked on purpose (declaration guard — reverting that
pin needs an owner decision, see open question).

## Matrix (automated: `backend/src/tests/dispatch-resource-availability-kep-kethop.test.ts`)

| Row | Scenario | Expected |
|---|---|---|
| T1 | Kẹp both fulfillments DOUBLE-declared, partner unpaired | save allowed |
| T2 | Kẹp incoming vs partner still declared SINGLE | 409 stays (guard) |
| T3 | Kẹp incoming while partner actively paired to a third load | 409 stays |
| T4 | Kết hợp sequential same-rig same-business-day (windows may overlap) | save allowed [FIX] |
| T5 | Đơn + Đơn independent overlap on one rig | 409 stays |
| T6 | Kẹp partner carries a 40' container (probe guard) | 409 stays |
| T7 | Kẹp clamped weight sum over capacity | 409 stays |

## Pass criteria (met locally)

- T4 stops 409-ing after the fix; T1 passes; T2/T3/T5/T6/T7 keep 409.
- Red observed at HEAD: `qa/2026-10-03_271-dispatch-resource-availability_red.log`
  (T4's 409 captured in full). Green: `qa/2026-10-03_271-dispatch-resource-availability_green3.log`
  (1/1 suites green). Family scoped: `qa/2026-10-03_271-dispatch-family_scoped.log`.
- Regression case re-run before any staging cut that carries this fix.

## Open business question (parked, needs owner)

The field report may also cover the declare-order gap (partner fulfillment
still schema-default SINGLE when the second clamp assignment saves — the
gate reads the partner's classification, which lands in a later save).
Relaxing that conjunct reverses a deliberate pin (`VID-DSP-04 single-first`
pins DOUBLE-vs-SINGLE overlap as blocked). NOT changed pending owner ruling;
the COMBINED fix above is the unambiguous part of the card.
