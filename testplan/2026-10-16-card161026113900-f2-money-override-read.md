# Testplan — F-2 (card 161026113900): money boards read the override channel

Owner ruling (documented option (b) of `testplan/2026-10-16-lcl-cost-closed-loop.md`
§F-2): the money boards read the override channel `trip_financial_state.revenue`
for the CƯỚC THU columns. Not option (a) (merge writes snapshot overrides) nor
(c) (snapshot recapture). Spec display law: `docs/qa-guides/2026-10-15_dev-spec-luong-hang-le.docx` §3.2/§4.

Related minor carried on this lane: F-4 (no card) — trip GET omits
`revenueOverrideReason` (one-line select addition so an operator surface can
show the zero reason).

## Defect

FB-093 writes the 100%/0đ jump to `trip_financial_state.revenue`
(`lcl-grouping.service.ts`): the principal is re-priced AUTO from the
customer × route × class lane (**no** override markers), members 2..N are
zeroed **with** markers + reason `Ghép cước cùng Bill <principal>`. FB-095
un-merge/delete transfers money on the same channel **with** markers and can
leave the survivor ungrouped (2-lot group dissolves).

Both money boards read other channels:

- CUS "Chi phí - Quyết toán" (`getShipmentDebitSummary`): `freightAuto` ←
  freight-rate snapshot grain (per-trip legs, intake fallback).
- Kế toán "Kế hoạch điều động tổng hợp" (`getAccountingDebitBoard`):
  `thu.cuocThu` ← snapshot `freightAmount` of the same grain.

Net: after a merge the boards keep each lot's own AUTO freight — the spec
§3.2/§4 law (Lô 1 = 100%, members 0₫ + note) is absent from the money
columns. The TRẢ side is NOT defective: both boards already read
`trip_carrier_info.external_freight_cost`, the channel FB-092 zeroes.

## Read rule implemented (ruling b)

Per lot, the cước-thu money value = Σ `trip_financial_state.revenue` over the
lot's live trips (direct `trips.shipment_id` OR via `shipment_fulfillments`,
active scope — the same attribution FB-093 writes through) when the lot is
**LCL** (groups are LCL-only by FB-092/093 law — the scope keeps every FCL
lot on the snapshot channel, per the ruling's "affects FCL too" caveat) and:

1. the lot is in a REV group (`revGroupId != null` — picks up the un-marked
   principal's re-price), OR
2. any of those live trips carries a revenue-override stamp
   (`revenueOverriddenAt != null` — picks up FB-095 promote/transfer/re-stamp
   aftermath after a group dissolves; operator M2.1 overrides on LCL lots
   ride the same channel).

Otherwise the historical snapshot channel stays byte-identical (FCL always;
ungrouped LCL; un-overridden trips). A qualified lot with no live-trip
revenue reads null = "Chưa xác định" (PRD: never a false 0) — merged-but-
undispatched LCL lots keep today's null (LCL lots have no intake freeze:
no rate key is derivable without containers).

Consequences pinned by the same rule:

- CUS `freightAuto` feeds `receivableTotal`/`profit` with the effective
  value (spec §3.2 note: chi hộ stays counted; chỉ Cước vận tải = 0).
- Kế toán `thu.cuocThu` feeds `tongThu`/`loiNhuan` with the effective value.
- Locked lots: the frozen `receivableTotal` snapshot NEVER mutates (card _19
  law); only the live columns (`freightAuto`, `profit`) reflect the channel.
- The row exposes `freightOverrideReason` so the UI renders the spec's
  "chú thích nhỏ bên dưới" under the CƯỚC VẬN TẢI (AUTO) cell.

## Cases

| ID | Scenario | Expected | Result |
|---|---|---|---|
| F2-01 | Merge 2 same-customer LCL lots (each with a live trip + own per-trip freight snapshot); principal lane price exists | CUS board: principal `freightAuto` = lane price (not its own snapshot), member `freightAuto` = `0`; member row carries `freightOverrideReason` = "Ghép cước cùng Bill <principal>"; `receivableTotal` follows the effective freight | PASS — `lcl-grouping.test.ts` F2-01 (rung 2, service + real DB) |
| F2-02 | Same fixture, Kế toán board | `thu.cuocThu`: principal = lane price, member = `0`; `tongThu` follows; `phuPs` stays on the snapshot channel | PASS — F2-02 |
| F2-03 | Un-merge Lô 1 from the 2-lot group (FB-095: money transfers to Lô 2, group dissolves) | Both boards keep reading the override channel for the survivor via its override stamp: survivor shows the transferred amount, leaver shows `0` with its re-stamped reason | PASS — F2-03 |
| F2-04 | Control: ungrouped, un-overridden lot with per-trip snapshots (trip revenue deliberately ≠ snapshot total) | Both boards byte-identical to the pre-change snapshot channel (regression guard; a broken always-override precedence would read the trip revenue) | PASS — F2-04 |
| F2-05 (BE) | Override-stamped **FCL** lot (operator M2.1 edit) with per-trip snapshot | Boards stay on the snapshot channel — the stamp clause is scoped to LCL, so FCL semantics are untouched by the ruling | PASS — F2-05 BE (review C1 hardening) |
| F2-05 | FE: member row on Chi phí - Quyết toán renders the note "Ghép cước cùng Bill X" under the Cước vận tải (Auto) cell (desktop table + phone fact list) | Note visible only when `freightOverrideReason` present | PASS — `ShipmentDebitPage.f2-money.test.tsx` (desktop driven; the phone variant renders through the same `freightFact` row contract) |
| F4-01 | `getTripById` on an overridden trip | Response carries `revenueOverrideReason` (previously DB+audit-only) | PASS — `m21-override-reason.test.ts` F-4 case |

Sibling regression sweep (boards' other contracts unchanged):
`accounting-debit-close.test.ts` + `shipment-debit-summary.test.ts` +
`debit-voided-expenses` + `card181-signed-expense-total` +
`ops-chi-ho-group-receivable` + `m21-override-reason` 51/51; FE page suites
38/38. Evidence: `qa/2026-10-16_f2-override-read_*.log`,
`qa/2026-10-16_f4-trip-get-reason_*.log`. Pre-existing failures verified
identical on the stashed base: shared `computeFifoAging` (10 cases,
documented in the W1 handoff) and root-lint errors in untouched W1 verify
scripts.

## Independent review (resolved)

Code-reviewer pass (2026-10-16, this lane): all 7 hard constraints PASS
(write paths untouched; unqualified lots byte-identical; null law; locked
freeze; Drizzle-only; phuPs on snapshot; discriminating tests). Applied
hardening from its concerns:

- **C1 → fixed by scoping**: qualification is LCL-only
  (`cargoMode = 'LCL' && (revGroupId != null || override stamped)`). Groups
  are LCL-only by law, so every FB-093/FB-095 path is covered while ordinary
  operator M2.1 edits on FCL lots can never flip the boards (zero FCL blast
  radius; also removes the potential freight+phuPs double-count for stamped
  FCL). Pinned by F2-05 (BE).
- **C2**: `freightOverrideReason` now exposed only on the qualified branch.
- **C3**: deterministic reason pick (`order by trips.id`).
- **C4**: `Set` membership for lot ids.
- **C6**: F2-04's CUS control made discriminating (trip revenue 999.000 vs
  snapshot total 1.294.000).
- **C5 (documented residual)**: `customer-debt-summary.service.ts` still
  reads the snapshot freight channel — a third reader of the same defect
  class, outside the card's two-board ruling scope. Follow-up card needed
  before merged-lot receivable can desync between boards and the debt
  report.

## Not covered / out of scope

- No money-calculation changes beyond reading the override channel (ruling
  (b) guardrail): uniqueness/duplicate laws, FB-093 write path, snapshot
  lifecycle untouched.
- Debit Note export (xlsx/pdf) money columns — FB-094 law already prints from
  the trip claim channel; not re-driven here.
- `customer-debt-summary.service.ts` also reads freight snapshots (a third
  reader) — not one of the card's two boards; left untouched, residual noted.
- UI browser drive (rung 3) — service/board level verified via DB-backed
  tests (rung 2) + FE component tests; no staging touched.
