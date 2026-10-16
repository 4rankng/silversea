# F-2 card 161026113900 — money boards read the override channel — DONE, local commits (2026-10-16 ~21:20Z)

Controller: this session (Paseo agent), branch `fix/f2-money-override-read-r2`
(worktree-isolated; NOT pushed/merged/deployed — Hermes consolidates).

## What landed

Owner ruling option (b) implemented: the two money boards read the override
channel `trip_financial_state.revenue` for the CƯỚC THU columns so FB-093's
100%/0₫ merge jump and FB-095's transfer aftermath reach the boards.

Read law (ONE shared helper, `backend/src/services/revenue-override-read.service.ts`):
per lot, cước thu = Σ live-trip `trip_financial_state.revenue` (direct or
fulfillment link, active scope — FB-093's own attribution) when the lot is
**LCL** and (in a REV group OR any live trip override-stamped); otherwise the
historical freight-snapshot grain byte-for-byte. LCL-only scope is the review
C1 hardening: FCL can never flip (groups are LCL-only; operator M2.1 stamps on
FCL stay snapshot — pinned F2-05 BE).

- CUS "Chi phí - Quyết toán" (`shipment-debit-summary.service.ts`):
  `freightAuto` + the receivable addend + profit use ONE effective freight;
  row exposes `freightOverrideReason` (shared zod schema + FE type). Locked
  lots keep the frozen receivable (card _19).
- Kế toán "Kế hoạch điều động tổng hợp" (`accounting-debit-close.service.ts`):
  `thu.cuocThu` switches (feeds tongThu/loiNhuan); `phuPs` stays snapshot.
- FE: note under the Cước vận tải (Auto) cell per spec §3.2 (desktop
  `ShipmentDebitPage.tsx` + phone `ShipmentDebitRecords.tsx` via
  `freightFact`; CSS `shipment-debit-row__freight-note`).
- F-4 riding minor: `getTripById` selects `revenueOverrideReason` (+ optional
  field on shared `Trip` type) so an operator surface can show the zero reason.

TRẢ side needed no change: both boards already read
`trip_carrier_info.external_freight_cost` (the channel FB-092 zeroes).

## Commits (local, not pushed)

- `b859d0b8` — code + tests (a consolidator WIP snapshot taken mid-flight at
  21:12:50 AFTER all gates were green on the identical tree; could not be
  re-split per-ticket without history rewrite — banned. Content = final
  reviewed state, verified by `git diff` against the working tree).
- `f4021c53` — testplan records completion (read law, review resolution,
  case results).

## Gates (final content)

BE tsc 0 · `lcl-grouping.test.ts` 23/23 (4 new F-2 cases + FCL guard) ·
board siblings + consumers + m21 51/51 · FE `tsc -b` 0 · FE vitest 4 files
38/38 · shared build/tsc 0 · root lint errors pre-existing in untouched W1
verify scripts (identical on stashed base). Evidence:
`qa/2026-10-16_f2-override-read_*`, `qa/2026-10-16_f4-trip-get-reason_*`.
Independent code review: 7/7 hard constraints PASS; C1/C2/C3/C4/C6 applied,
C5 documented residual. Case record:
`testplan/2026-10-16-card161026113900-f2-money-override-read.md`.

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Merged boards show Lô 1 = 100% lane price, member 0₫ + reason (CUS + Kế toán) | DB/API VERIFIED (service + real DB) | `qa/2026-10-16_f2-override-read_be-lcl-grouping.log` 23/23 | UI not driven in a browser (no rung-3 click on either board); staging not touched; locked-lot live-column mix pre-existing |
| FB-095 unmerge keeps boards on the override channel (stamp) | DB/API VERIFIED | same log, F2-03 | delete-principal path pinned only at service level (existing FB095-06) |
| Unqualified lots byte-identical + stamped FCL stays snapshot | DB/API VERIFIED | same log, F2-04/F2-05 BE | multi-leg FCL lots not fixture-tested |
| FE note under freight cell | CODE-READ + component tests | `qa/2026-10-16_f2-override-read_fe-vitest.log` 38/38 | No browser drive at 390/768/1440; phone variant covered via shared freightFact contract only |
| F-4 trip GET returns revenueOverrideReason | DB/API VERIFIED | `qa/2026-10-16_f4-trip-get-reason_be-m21.log` 6/6 | No FE consumer exists yet (by design) |

## Residuals / next for Hermes

- **C5 follow-up card needed**: `customer-debt-summary.service.ts` still reads
  the snapshot freight channel (third reader of the same defect class,
  outside this card's two-board ruling scope) — merged-lot receivable can
  desync between boards and the debt report until it reads the same channel.
- Rung-3 UI drive of both boards with a merged pair (local or staging) still
  open; services are rung-2 verified on the real DB.
- Local commits only — merge/push/deploy owned by Hermes per task contract.
