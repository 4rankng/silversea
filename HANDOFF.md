# MOBFOOT-1016 mobile footer grey band — DONE, deployed to prod @ e6e2a653 (2026-10-16 ~22:12Z)

Controller: this session (Paseo agent), branch `fix/mobile-footer-band`
(reused the existing stale branch; base = origin/main `732c7ab9` via
`e3286338`). Merge `e6e2a653` on main, pushed; `make demo` (staging
curl-verified `e6e2a653`), `make deploy` PROD (silversea.tingting.vip
health ok @ `e6e2a653`, steady-state curl ×3, frontend 200; rollback
snapshot captured by the Makefile flow). Issue #8 closed with evidence.

- Owner phone report 21:07 SGT: /shipments phone band showed an empty grey
  band below the last lot card. Root cause: DOM ends at `nav.ds-pagination`;
  the band = shell ≤640 trailing clearance painted in page tone (34px
  on-device + ~25px iOS dvh slack; owner's 120–180px = 177 physical ≈ 59
  CSS @3x). Fix per the 2026-10-09 counted-once law's own-surface clause:
  shell band scoped off while the pagination is mounted; clearance moves
  INTO the pagination surface. CASCADE ORDER IS LOAD-BEARING (same selector,
  media queries add no specificity) — independent review caught the first
  cut placed dead above the base rule; order now pinned by
  `ShipmentsPage.mobile-footer.styles.test.ts` + substitution proof
  (46px live / 12px reordered control).
- Gates: FE tsc 0, full vitest 4937/4937 (pre- and post-F2-merge trees),
  `make build` ok, `check:ui` ok, lint 0 new (11 pre-existing W1 baseline
  unchanged, re-diffed against `qa/2026-10-16_fb061-fix_lint.log`).
- Residuals (documented in design-guidelines + 04 slice): grey band remains
  at 641–1023px (tablet band incl. landscape phones); iOS dynamic-viewport
  growth slack is shell-wide and transient (inner `.app-body` scroller never
  re-absorbs it — window-scroll compensation does not reach div scrollports).
  Evidence local-only under `qa/1016-mobile-footer/`; case
  `testplan/2026-10-16-mobile-footer-grey-band.md`; drivers
  `testplan/qa/scripts/1016-mobile-footer-{rung,cascade-proof}.mjs`.

---

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

---

# LCL Spec Gaps 1, 2, 3 Implementation & Staging Verification — DONE, deployed & verified on staging (2026-10-17)

Controller: this session (Paseo agent), branch `fix/lcl-spec-gaps` (HEAD `249cb396`, pushed to `origin/fix/lcl-spec-gaps`).
Staging deployment: `make demo` verified on `https://vantai.tingting.vip` (`buildHash: 359e12e8`).

## 1. Commits Landed & Pushed
- `c2373d2d`: `fix(lcl): enforce money conservation on un-merge and primary deletion (spec line 92)`
  - Added atomic promotion on un-merge and deletion of primary lots with full 100% freight conservation (both REV and COST dimensions).
  - Synchronized both trip and snapshot channels (`insertRevMergeSnapshot` + `upsertTripFinancialState`).
  - Added whole-group un-merge endpoint (`POST /api/shipments/lcl/unmerge-group`).
  - Clean dissolve and survivor renumbering when last-but-one lot is deleted.
- `260a9fa3`: `fix(lcl): enforce same-customer validation on revenue merge (spec line 66)`
  - Enforced strict server-side validation rejecting cross-customer revenue merges.
  - Returned descriptive Vietnamese error naming the specific bill numbers and conflicting customer names (`Chỉ cho phép ghép các lô của cùng một khách hàng (CÙNG 1 KHÁCH HÀNG) — phát hiện xung đột: ...`).
- `359e12e8`: `fix(lcl): bind customer debit note to virtual plate unconditionally (spec line 86)`
  - Customer-facing export (Debit Note / bảng kê Excel/PDF) unconditionally binds `truckPlate` to `billingTruckNo` ("xe ảo") and never leaks `actualTruckNo` / physical plate.
  - Preserved `actualTruckNo` for supplier / vendor settlement views (`getAccountingDebitBoard`, PHẢI TRẢ).
- `249cb396`: `fix(lcl): use UnmergeLclGroupInput in unmergeLclGroup signature` (lint clean-up).

## 2. Regression Tests
- `backend/src/tests/lcl-grouping.test.ts`: 32/32 tests pass (8 suites, 0 fails).
  - GAP 1: Money safety on unshipping / deleting group (whole group un-merge, primary lot deletion, last-but-one lot deletion).
  - GAP 2: Same-customer merge validation (conflict error naming bills and customers, zero DB mutation).
  - GAP 3: Debit note virtual plate binding (`billingTruckNo` on customer export, `actualTruckNo` on vendor view).
- `frontend/src/pages/ShipmentDebitPage.lcl-merge.test.tsx`: 3/3 tests pass.
- `backend/src/tests/unit/*.test.ts`: 289/289 tests pass (49 suites, 0 fails).

## 3. Live Staging Verification Proof (`https://vantai.tingting.vip`)
- Build hash confirmed: `{"status":"ok","buildHash":"359e12e8"}`.
- Authenticated as `admin` (`userId: 61`).
- Created 2 real LCL lots on staging:
  - Lot 1: ID 668 (`blNumber: QA-LCL-1-1792168565804`, `routeId: 12`, `cargoMode: LCL`)
  - Lot 2: ID 669 (`blNumber: QA-LCL-2-1792168565804`, `routeId: 12`, `cargoMode: LCL`)
- Merged lots into Revenue Group `6e73fbbd-ce26-4826-9470-5526e296c20f` with `vehicleSizeClassId: 4` (Xe 5T, price 2.400.000₫):
  - Lot 1 (Primary, order 1): freight snapshot = 2.400.000₫ (100%)
  - Lot 2 (Member, order 2): freight snapshot = 0₫
  - Total group freight before deletion: **2.400.000₫**
- Deleted Lot 1 (Primary) via `DELETE /api/shipments/668?version=2`:
  - Returned `{ ok: true }`.
  - Atomically promoted Lot 2 to order 1 (and dissolved group cleanly).
  - Lot 2 freight snapshot immediately received: **2.400.000₫** (100%).
  - Total group freight after deletion: **2.400.000₫**
  - **Invariant verified**: Initial 2.400.000₫ === Final 2.400.000₫ (freight strictly conserved, never falls to 0₫).
- Cleaned up: Lot 2 soft-deleted, QA fixture rows hard-purged. Zero test debris remaining.

