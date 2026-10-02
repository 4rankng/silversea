# Case QA-2026-09-24-01 — Phoi-phieu display cluster (audit c12 cluster B): seed-id labels on board rows, phiếu-chi counter disconnected from approvals, and clipped money headers in the tiền đường modal

- **Case ID:** QA-2026-09-24-01
- **Reported:** 2026-09-24, director work order c12 addendum (cluster B, bugs B1 + B2), reference
  screenshots `/tmp/opencode/c12/annotated/image11.png` (board rows) and `image13.png` (tiền đường modal).
- **Surface:** Kiểm soát phơi phiếu page (`/accounting/phoi-phieu` route family) — board table
  (`PhoiPhieuControlPage.tsx`) and the "Chi tiết tiền đường" modal (`PhoiPhieuTienDuongDialog.tsx`).
- **Status:** LANDED (ruled shapes) — `de852096` (modal header clip), `88b5d2d0` (approval guard +
  eligible counter + seeder fix), `19a77628` (strip migration trio), `c41022b9` (migration
  collision-safe fixup before first run anywhere). Applied to the dev DB after a 7.6M backup
  (`/tmp/ss5441_backup_20260924_113145.sql`); idempotent re-run verified; real business names
  intact. Card QA rung (visual pass on the live stack) pending on the QA lane.

## Sub-bugs and verdicts

| # | Symptom | Root cause (verified in source) | Verdict |
|---|---------|-------------------------------|---------|
| B1 | Board rows read `ADC P 1790089547534-zcain7` / `ADC route P 1790089547534-zcain7` under KHÁCH HÀNG / route (image11). Operator annotation: "không rõ ý nghĩa". | The strings are the seed fixtures' literal `customers.name` / `routes.name` values (dev DB rows 436/437: `ADC P 1790089547534-zcain7`), rendered verbatim by `PhoiPhieuControlPage.tsx:220` from `phoi-phieu-control.service.ts:97,100`. Naming pattern `<label> <epoch-ms>-<rand>` comes from backend test fixtures (cf. `accounting-debit-close.test.ts:153-154`). NOT a raw DB id column rendering — it is id-like seed *names* flowing into the row. | LANDED (ruled shapes) — seeder suites stop baking fragments into the three name fields (`88b5d2d0`); strip migration cleans stored rows (`19a77628` + collision-safe fixup `c41022b9`, applied to the dev DB after backup, idempotent re-run verified); render-layer fences pin that cells render stored names verbatim — no display laundering. |
| B2-counter | Toolbar button "Lập phiếu chi (0 dòng)" while approved entries exist in the modal (image13, annotation 4). | The button is the PAGE toolbar (`PhoiPhieuControlPage.tsx:194`), not the modal: it counts checked trips (`selected.size`); the modal (`PhoiPhieuTienDuongDialog`) has no voucher button. Approving entries in the modal cannot move that counter. Counter is truthful for what the button does, but disconnected from approval state. | LANDED (re-ruled shapes) — phoi-phieu voucher consumes approved chi-hộ/OPS sources ONLY (`88b5d2d0` guard, OPS-only re-affirmed in `dc9f44ee`); the toolbar counter previews the eligible OPS set (approved ∧ remaining>0, per direction, cash-adjusted) so preview == voucher contents; approved tiền đường payouts ride the cash/vouchers chain, whose approval gate now refuses with a fee-name row list and whose allocations decrement the cash-adjusted remaining (`dc9f44ee`, t5/t6). Payer scope split recorded in docs/adr/2026-09-24-expense-payer-scope-split.md. |
| B2-headers | "LÁI XE NHẬP BAN ĐẦU (Đ)" and "THỰC CHI HI..." clip mid-token in the modal table (image13). | `.tt-table` is `table-layout: fixed` (`Table.css:489`) + `thead th { white-space: nowrap }` (`Table.css:503`): 7 equal-share ~91px columns inside the 640px modal shell clip the two longest headers. | FIXED — modal widened 640→760px; headers wrap at spaces (`white-space: normal; word-break: keep-all; overflow-wrap: normal`) mirroring the board's pinned thead contract (card 20260922_54, design law §4). |

## Business-semantics flag (Director ruling needed before B2-counter fix)

`createPhoiPhieuVoucher` (`phoi-phieu-control.service.ts:256-307`) consumes ALL `RECORDED` chi-hộ
(OPS) sources with remaining>0 for the checked trips and never filters on `confirmedAt`, while the
modal's note claims "Khoản đã duyệt mới được lập phiếu chi thanh toán cho lái xe". Additionally the
voucher engine consumes only OPS sources — approved DRIVER (tiền đường) entries are never paid by
this button at all. So "what should the counter count" is a business question (checked trips? trips
with confirmable=true? approved entry count?), not a UI string change. Per the ask-first rule this
was escalated, not unilaterally redefined.

## Director rulings (2026-09-24, relayed by LEAD) — shapes for the second pass

### B1 — root-cause fix (render-strip option killed)

1. **Seeder/fixture generators stop baking `<epoch-ms>-<rand>` fragments into names.** Observed
   sources: backend fixture helpers (`accounting-debit-close.test.ts` `mkCustomer`/`mkRoute`
   `${suffix}` pattern) and QA seed scripts creating `<label> <Date.now()>-<rand>` names.
   `phoi-phieu-control.service.ts:97,100` are the read projections (verbatim `customers.name` /
   `routes.name`), not the source.
2. **Idempotent data migration** stripping the trailing fragment from existing rows:
   pattern `\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$` (whitespace + 13-digit epoch-ms + hyphen
   + alnum-leading tail allowing internal hyphens; verified against live specimens `ADC P
   1790089547534-zcain7`, `C16 customer 1790049643236-195l16-69`, `card6 driver
   1790004852053-9kzgw8-26`). Journal + snapshot + .sql in ONE commit (migration completeness
   family rule). Staging DB backup before running the data change; prod via deploy path only.
3. **Duplicate-collapse probe — EXECUTED 2026-09-24 (read-only, ss-prod-db):**
   - 338/… customers and 421 routes carry the suffix pattern.
   - Strips colliding (with each other or with already-clean names): **335/338 customers,
     421/421 routes** — repeated seed runs reuse the same labels (`ADC P` ×335+), so blind strip
     collapses nearly every row to a duplicate name.
   - Constraints: only PKs on `customers`/`routes`; **no unique constraint on name** — collapse
     violates nothing, but rows lose name-distinctness.
   - Attachment: customers 187 with shipments / 151 orphans; routes 292 with trips / 129 orphans.
   - Finalize options (Director decision; the check was demanded BEFORE finalizing):
     (a) strip-if-unique — safe but covers ~1% of rows (useless here);
     (b) **strip-all accepting duplicate names (LaneB recommendation)** — non-destructive,
         idempotent, full coverage; row identity rests on Số Bill/Booking per the display-key
         law, not on customer/route names;
     (c) delete unreferenced seed orphans (151+129) then strip-if-unique — destructive, needs an
         FK sweep + explicit Director approval;
     (d) strip + disambiguate — re-bakes id-like discriminators, contradicts the law's spirit.
4. **Open sub-question flagged:** driver display names carry the same fragment
   (`card6 driver 1790004852053-9kzgw8-26`); the ruling names customers/routes only — Director to
   confirm driver-name rows are in migration scope.

### B2-counter — both legs (copy-only tweak killed)

- **t1 (backend red-first):** service-side approval guard in `createPhoiPhieuVoucher` — among
  remaining>0 sources, only `confirmedAt IS NOT NULL` entries may enter the voucher (PDF:
  "Chỉ những khoản ĐÃ DUYỆT mới đủ điều kiện được đưa vào phiếu chi thanh toán"). Test: trip with
  one confirmed + one unconfirmed source (both remaining>0) → voucher contains ONLY the confirmed
  one; all-unconfirmed selection → the existing 409 ("…không còn khoản mở…").
- **t2 (frontend red-first, parked until page unblock):** the toolbar counter is redefined to the
  eligible set (approved ∧ remaining>0) so button preview == voucher contents — the count is the
  number of eligible khoản for the current selection. Copy unit wording ("dòng" vs "khoản") to
  follow the ruling's unit; test pins preview==contents, not the word.
- Note: the voucher consumes OPS (chi hộ) sources; the chi-hộ approval flow sets their
  `confirmedAt`. The previously-flagged gap "approved DRIVER (tiền đường) entries are never paid
  by this button" remains OUT of the ruling's scope and stays flagged for Director.

## Re-rule (2026-09-24, later) — payer scope split

The second GO's DRIVER-leg widening (t3/t4) was **dropped by re-rule**: phoi-phieu pays
chi-hộ/OPS only; approved tiền đường payouts ride the cash/vouchers chain (whose approval gate
lists fees, never ids — t5/t6 in expense-cash-authority.test.ts). The interim widening landed in
`88b5d2d0` and was removed in `dc9f44ee`. Landed series: `195601d6` (debit tripId aria-labels),
`dc9f44ee` (OPS-only voucher + named-fee approval gate), ADR
`docs/adr/2026-09-24-expense-payer-scope-split.md`. Migration runs LOCAL-only; the staging run is
a cut-runbook step (backup-first), not a lane action.

## Collision note (mid-run event, resolved)

The parallel lane (mimo) was actively editing `PhoiPhieuControlPage.tsx` (Báo-cáo-tháng header) and
`PhoiPhieuChiHoDialog.tsx` when this case opened; per the work-order pre-check LaneB stopped and
reported. The collision lifted when the parallel lane's in-flight edits left the worktree — the page
file verified clean vs HEAD twice, immediately before the second-pass edits and landing. Fix specs
that became the second pass:

- **B1:** in `PhoiPhieuControlPage.tsx` rows (lines 216-240), pass `customerName`/`routeName`
  (and on parity surfaces, driver name) through a display-level sanitiser that strips trailing
  ` <13-digit-epoch-ms>-<alnum>` seed suffixes before render (pure helper in `frontend/src/lib/`,
  red-first component test: fixture row with id-like name renders without the raw pattern).
- **B2-counter:** after a Director ruling on the semantics above, re-source the counter at
  `PhoiPhieuControlPage.tsx:194`.

## Automated fence (must stay green)

- `frontend/src/features/accounting/PhoiPhieuTienDuongDialog.test.tsx` →
  `modal table headers never clip (case QA-2026-09-24-01; design law §4)` — RED pre-fix (no inline
  wrap style; 640px shell), GREEN post-fix.
- `frontend/src/features/accounting/PhoiPhieuDialogs.test.tsx` →
  `board rows show business names only — seed id suffixes never render` and
  `phiếu toolbar zero state instructs instead of showing a false "(0 dòng)"` — both RED at HEAD,
  GREEN post-fix.
- `frontend/src/lib/business-label.test.ts` — pure-helper unit fence for the seed-suffix strip.
- Gates at landing: 4 suites 25/25 green; repo-wide `tsc -b` red ONLY on a foreign untracked file
  (`src/api/opsClient.ts`, another lane's in-flight token); zero errors in this cluster's files.

## Browser rung needs (QA lane, serialized)

Verifying the modal headers on the live stack (vite :7175): open Kiểm soát phôi phiếu → "Xem chi
tiết" on a trip with cost entries → headers read whole at 1280×800; screenshot to this case's
evidence. The board-row label check (B1) can ride the same session.

## Correction (2026-09-24, director round 3 — payer scope split)

LaneB's interim widening (88b5d2d0: approved DRIVER sources paid OUT by the phoi-phieu
voucher) was superseded per the option-B ruling: the phoi-phieu voucher pays chi-hộ/OPS
sources ONLY (approved ∧ remaining>0, counter previews the same set); driver money pays
exclusively via the cash/vouchers DRIVER_PAYOUT chain with approval-precedes-payment.
Landed: dc9f44ee (service + engine fee-name refusal + authority t5/t6), 3b4736f5 (ADR),
2bb1eded (sanitiser retirement). BE-verified: payer-split pin observed RED against the
pre-correction service (88b5d2d0 behavior drove the driver payout through the phiếu) and
GREEN at HEAD; authority suite green; debit-close seeder discipline applied (ordinal
names, epoch tags only on usernames); strip-collision heal = migration trio
20260924115231_strip_residual_disambiguate (strip + "Base (2)" disambiguator, 50-attempt
cap, (name, tax_code) guard, skip+WARNING log; runs dev first, staging/prod at cut #2).
