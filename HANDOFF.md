# STAGING STATE (auto-ship, 2026-10-16 ~07:12Z) — staging is CODE-CURRENT, no deploy needed

# Shipped-waves QA verify — 4 waves re-driven on staging, 21 PASS / 0 FAIL (2026-10-16)

- Branch `qa/shipped-waves-verify-1016` (base ae419e3d). Waves (a) UI-audit-1
  c5f1cd3e, (b) W5 fb-regressions 7c44a1fd, (c) kanban-1016b a6ba72c5,
  (d) W3a-r17 ae419e3d — all PASS per their own QA records; record:
  `testplan/2026-10-16-shipped-waves-verify.md`, evidence `qa/1016-shipped/`.
- Build gate: staging re-cut mid-run ae419e3d→7dcdcf33 (deploy-hold actor);
  continued on 7dcdcf33 — a verified superset with an EMPTY diff on every
  tested surface; every phase asserted buildHash before driving.
- 0 product defects → 0 fix commits. Raw-log FAILs are driver bugs
  (FB-057 focus persistence, FB-085 select-all), corrected + re-driven PASS.
- Local pins at HEAD: FE 49+7+145, BE 18+3+18 — all green.
- Sweep clean: ?q=QAW16/QAW3A/QAWU200 → 0. No merge, no deploy (Hermes).

# Kanban wave 1016b — five IN_PROGRESS cards verified on main (2026-10-16)

Staging vantai.tingting.vip runs buildHash `7dcdcf33` (= main incl. W1
ketoan+cham-cong; images built 06:54-06:55Z by a parallel process — likely the
Muse-QA agent deploying main itself). main (aa3e7ba3) is ahead ONLY by
QA-evidence files + these notes — ZERO source diff, do NOT `make demo` again
while QA runs are in flight. In flight vs staging: paseo 99f8bdb (Muse QA 4
shipped waves, cut over ae419e3d→7dcdcf33 mid-run ~06:58Z — its post-cutover
evidence is against 7dcdcf33, pre-cutover against ae419e3d) and d540efb (w3b
r20 retests, started on ae419e3d — check its buildHash note in findings).
NEXT: when 99f8bdb is done → dispatch W1 Muse QA on staging (buildHash must be
7dcdcf33+; testplan/2026-10-16-card141026*, role accounts
testplan/testaccounts.txt, Idempotency-Key on every write, clean fixtures).

# Kanban wave 1016c — same five cards: re-run evidence, one commit per card (2026-10-16)

- Controller: this session (Paseo agent). Branch `feat/kanban-wave-1016c`, cut
  from origin/main @ `ae419e3d`. Five commits (one per card), pushed after each
  green one — the batching death of the two prior 1016c lanes is why. No code
  changes: every card's behavior was already on main (1016b wave and each
  card's original dispatch). This wave landed only §6/§7 re-run evidence.
- Per card (commit · gates):
  - QA2-005 `qa2-005` commit · FE tsc 0 · ShipmentsPage 135/135 · BE tsc 0 ·
    cus-record-search 6/6 · shared cus-shipment-workspace 18/18.
  - FB-066 `fb066` commit · FE tsc 0 · TripInfoCard.quick-add 5/5.
  - FB-083 `fb083` commit · FE tsc 0 · label pins 2/2 (asterisk-contract +
    ClerkShipmentCreatePage, `-t "Ngày giao hàng"`).
  - FB-084 `fb084` commit · FE tsc 0 · asterisk+model 27/27 · BE tsc 0 ·
    shipment-intake-lcl-cargo 3/3.
  - FB-085 `fb085` commit · FE tsc 0 · declarations+ledger 53/53 · BE tsc 0 ·
    cus-container-declaration-wire 6/6.
- Rung: ≤2 this wave (pins executed, no UI drive); rung-3 evidence for all five
  lives in `qa/2026-10-16_w3a-r17-verify/` and `qa/2026-10-14_fb066-*` from the
  earlier drives. Card .docx were unreadable (0-byte stubs; Drive IN_PROGRESS
  empty) — scope reconstructed from dispatcher summaries + testplan records.

# Wave W1 ketoan + chấm công — DONE, pushed (2026-10-16)

- Controller: this session (Paseo agent). Branch `feat/w1-ketoan-chamcong`
  (tracking origin; auto-ship takes it from here). 9 cards = 9 FB commits,
  all pushed.
- Goal: backlog wave W1 (cards 141026230730…230810 from `.backlog-cards/`).
  Status: DONE per user gate contract (FE tsc + scoped vitest per commit,
  BE tsc when touched). UI NOT driven in a browser (§9 rung ≤2).
- Commits: 48ed1fe1 FB-096 · d57c6b53 FB-097 · d49b0920 FB-098 · 8221fccc
  FB-099 · 4ee08710 FB-100 · f2c413fc FB-101 · 4685f0ca FB-102 · fc537cb1
  FB-103 · 8907f766 (Hermes salvage snapshot of FB-104 mid-flight) +
  1623de28 FB-104 finish.
- Sources: 7/9 card docx on the SSD were 0-byte truncations; specs read from
  the Google Drive originals (`My Drive/SilverSea/Kanban/TODO/*.docx`).
  `testplan/2026-10-16-card141026*` cases record per-card contract+status.
- Decisions: FB numbering continues the kanban sequence (FB-096…104).
  `tsc --noEmit=0` (user's literal gate) is TS5025-invalid → repo gates used
  (`frontend npx tsc -b`, `backend npx tsc --noEmit`). FB-104 Excel image
  unavailable → màu ô (xanh K/Q/Đ, vàng Chủ nhật+lưu ca, đỏ N/P), "Số chuyến
  quay đầu = 2×Q", "Tỷ lệ % = kẹp/tổng lệnh ngày" documented in the case.
- Known pre-existing (untouched): shared `computeFifoAging` 10 failing tests
  at base (verified fail identically with FB-100's schema change stashed).
- Next for Hermes: merge/auto-ship; if the customer's Excel image contradicts
  the FB-104 mapping, it changes in one place (`cellClass`/`perDay` in
  TimesheetMonthlyReportPage.tsx).

---

# W4 ops/chiphí/bảng giá — wave handoff (2026-10-16)

Controller: this session (Paseo agent), branch `feat/w4-ops-chiphi-banggia`
(cut from the W3a verify head `ae419e3d`). Seven cards dispatched; six card
.docx files arrived 0-byte at 14:02 (content never synced), one readable.

## Per-card outcome

| Card | Status | Evidence |
|---|---|---|
| 161026121500 bảng giá xóa rồi thêm lại báo trùng ảo | FIXED, rung 3 | commit (this wave); `testplan/2026-10-16-bang-gia-xoa-roi-them-lai.md`; `qa/2026-10-16_bang-gia-tombstone_*` |
| 161026095800 bảng giá không thêm được theo loại xe | ALREADY ON MAIN (F-1) | fix `b9b22bf9` merged via `0ca5b428`; regression pin `backend/src/tests/pricing-table-selector-axis.test.ts` header names this ticket; FE page test 4/4 this wave |
| 161026113900 F-2 LCL merge money channel owner ruling | DOCUMENTED, no implementation | question below; `testplan/2026-10-16-lcl-cost-closed-loop.md` §F-2 |
| 141026230700 driver chi phí lô hàng tiền đường redesign | BLOCKED — card 0 bytes | needs the card's UI spec; do not redesign from a title |
| 141026230710 ops không khai được chi phí lô hàng | BLOCKED — card 0 bytes | TC-B2 (`testplan/2026-10-16-lcl-cost-closed-loop.md`): OPS GET /api/shipments 403 is the FB-033 owner ruling (2026-10-12, `016b0d0b`): Khai-chi-phí dialog stays OPS-only per-vehicle scope. Reopening an owner ruling requires the card text. |
| 141026230720 ops khai chi phí tất cả + cảnh báo trùng | BLOCKED — card 0 bytes | title reads as an FB-033 scope change (declare for ALL lots) — owner decision, card unreadable |
| 161026100400 lô lẻ chưa gắn xe không hiện kế hoạch chi tiết xe | BLOCKED — card 0 bytes | FB-092 spec (`testplan/2026-10-15-fb092-*.md`) defines unassigned display as bare `Lẻ`; exact repro/expected unknown without card |

## F-2 owner ruling still open (money logic — affects FCL too)

FB-093 merge writes the 100%/0đ jump to `trip_financial_state.revenue`, but
both money boards read other channels: CUS "Chi phí - Quyết toán" reads
`freightAuto` ← `freight_rate_snapshots`; Kế toán "Kế hoạch điều động tổng
hợp" reads `thu.cuocThu` ← trip legs `freight_amount`. After a merge the
boards keep each lot's own AUTO freight; spec §3.2/§4 display law (Lô 1 =
100%, members 0₫ + "Ghép cước cùng Bill") is not reflected on money
columns. Decision needed between:
(a) merge writes snapshot overrides,
(b) boards read the override channel (`trip_financial_state.revenue`),
(c) snapshot recapture on merge.
Related minor F-4 (no card): trip GET omits `revenueOverrideReason` —
one-line select addition when an operator surface for the zero reason is
wanted. Routed for owner/Hermes; nothing implemented this wave.

## The fix that landed (161026121500)

Defect class: pricing-catalog CRUD soft-deletes rows and every app guard
excludes tombstones, but five DB unique indexes still counted them —
delete → re-add passed the guard and failed the INSERT (phantom duplicate).
Sweep (5 indexes): `pricing_tables` ×3, `road_allowances`, `lift_pricing`
gained `deleted_at is null` predicates (schema + migration
`20261016143000_pricing_tombstone_unique_idx`, journal idx 150, house
hand-SQL pattern). `carrier_route_pricing` ×2 and `port_zone_surcharges`
already had the law and are pinned unchanged. No money calculation
changed — uniqueness only; live-row duplicate protection intact (BGX02
DB + UI both prove the 409 path).

Gates: BE tsc 0 · BE unit (new pin) 5/5 · FE tsc 0 · FE scoped vitest
(PricingTablesConfigPage.vehicle-class) 4/4 · root lint 0 errors ·
make build 0. Full `pnpm test` is BANNED on this host (hangs 40+ min on
the shared DB — owner instruction 2026-10-16); scoped files only. Two
partial full-suite runs (pre- and post-migration) failed with IDENTICAL
failure sets (card10-ops-review AC1, card197 negative-amount validators,
CUS container-flat projection, E2E dispatch/financial, customer account
linkage) — pre-existing on this branch head/shared-DB state, no code-path
overlap with the index predicates (assertion mismatches in unrelated
listings, not insert failures). Not fixed in this lane (unrelated to the
card; owner scoped the gates). UI rung 3: create → delete → re-create
same selector on /config/pricing-tables as admin — SUCCESS; real
duplicate still blocked; screenshots + DOM + DB rows + driver log in
qa/2026-10-16_bang-gia-tombstone_*.

## Environment notes for the next session

- Shared dev containers `ss-prod-db`/`ss-prod-redis` were already up;
  `make dev` fails on container-create — start backend/frontend directly
  (PORT=3002 / vite 7175) and reuse :5441/:6391.
- Fresh worktree needs `pnpm install --prefer-offline` +
  `pnpm --dir shared build` before any gate.
- Puppeteer lesson (cost ~20 min): `page.evaluate` serializes a RegExp
  argument to `{}`; `new RegExp({})` becomes a `[object Object]` character
  class that matches almost anything — pass regex SOURCE as a string.
  Also use `{ polling: 120 }` on waitForFunction in headless tabs (rAF
  polling stalls on occluded pages).

## Wave status (final)

- 161026121500: FIXED, rung 3, committed + pushed per-ticket.
- 161026095800: already on main (F-1 `b9b22bf9`), verified this wave.
- 161026113900 (F-2): owner ruling documented, nothing implemented.
- Four 0-byte cards (141026230700/710/720, 161026100400): UNBLOCKED and
  resolved the same day — see the W4b section below (2 implemented, 2 →
  FB-033 owner ruling; cards stay in Kanban/TODO until (a) is answered).
- Backend full `pnpm test` HANGS on this host (40+ min on the shared
  ss-prod-db, owner-killed twice) — run scoped test files with explicit
  timeouts only. Pre-existing failures to be aware of on this branch head:
  card10-ops-review.test.ts (AC1), card197-negative-cost-totals.test.ts
  (validators + phoi-phieu), CUS container-flat projection, both E2E
  dispatch/financial suites, customer account linkage.
# W4b ops/chi-phí — 4 blocked cards unblocked (2026-10-16, this wave)

Controller: this session (Paseo agent), branch `feat/w4b-ops-chiphi-cards`,
cut from `e717d2cb` (= origin/main after W4's tombstone merge). All four W4
0-byte cards re-read from the Google Drive originals
(`My Drive/SilverSea/Kanban/TODO/*.docx` — all four readable this time).
Every green commit pushed immediately (never batched). auto-ship owns
merge/deploy/QA from here.

## Per-card outcome

| Card | Status | Evidence |
|---|---|---|
| 141026230700 driver chi phí lô hàng/tiền đường redesign | IMPLEMENTED · commit `fc72763a` | `testplan/2026-10-16-card141026230700-driver-chiphi-hai-bang.md`; FE tsc 0 + vitest 48/48 (4 files) · BE tsc 0 + tsx 38/38 (5 files); `qa/2026-10-16_card141026230700_*` |
| 161026100400 lô lẻ chưa gắn xe không hiện Kế hoạch Chi tiết Xe | FIXED (real defect, no FB-092 conflict) · commit `7580ff32` | `testplan/2026-10-16-card161026100400-lo-le-chi-tiet-xe.md`; BE tsc 0 + tsx 133/133 (new pin 2/2 + board suites + create-path sweep); `qa/2026-10-16_card161026100400_*` |
| 141026230710 ops không khai được chi phí lô hàng (P1) | NOT IMPLEMENTED — FB-033 owner ruling, question below | facts below; `testplan/2026-10-16-lcl-cost-closed-loop.md` TC-B2 |
| 141026230720 ops khai chi phí tất cả + cảnh báo trùng | NOT IMPLEMENTED — same ruling; the duplicate-warning HALF is already on main | facts below |

## What landed

### 141026230700 — driver trip-end costs, 2 tables (rung ≤2: pins + service
integration; UI not driven in a browser)

Already on main before this wave (verified, not re-done): payer selector gone
(card 20261005), system rows locked (ROAD_ALLOWANCE + LIFT_DROP_ZONE: driver
cannot create, saved rows view-only), continuous draft-table add with one
"Lưu tất cả" save.

This wave: the section now renders TWO always-visible tables — "Chi phí lô
hàng" and "Tiền đường" (legacy rows without costGroup follow the write path's
TOLL/PARKING/PER_DIEM fallback); lot-cost draft rows carry two small toggle
buttons Hóa đơn / Phiếu thu (≤40px, house `btn--sm`) replacing the "Loại chứng
từ" dropdown; the typed Số/Ngày hóa đơn pair is GONE from the driver surface
(payload never sends it; the biên lai photo is the paper, kế toán reads
numbers at phơi phiếu); the biên lai photo is now MANDATORY for every lot
cost (FE blocks the save + reminder, BE refuses `DRIVER_SHIPMENT` rows
without `receiptStorageKey` — effective after the norm override so fee-norm
road rows stay exempt); the dead "Tiền tuyến đã thỏa thuận" option (BE 400s
driver-sent ROAD_ALLOWANCE since 20261005) left the picker. Contract note:
card 20260921_6/163's "invoiced types must carry a typed invoice number" is
superseded ON THE DRIVER PATH by this newer card — customer-charge semantics
unchanged; offline callers still sending a number keep it stored.

### 161026100400 — born-ready LCL lots were invisible (rung ≤2: service
integration; no UI change)

The card reports inconsistency, NOT an FB-092 conflict — FB-092's display law
(unassigned LCL row renders bare `Lẻ`) is what the card wants enforced, so
this was fixed, not closed. Root cause: `createShipmentTx` never decomposed
fulfillments, and a lot born READY_FOR_DISPATCH (dates at intake) never
passes the `becomesReady` branch where BUG 5 fixed decomposition; the detail
plan's fulfillment-less union branch inner-joins containers, and LCL lots own
none — so an undecomposed LCL lot was invisible until any later write
decomposed it. Fix mirrors becomesReady: born-ready LCL decomposes in the
create transaction. Documented residual (not fixed, next pass if owner wants):
PRE-FIX stuck LCL lots still need one write to surface (union branch is
FCL-only by the 9e design; extending it needs a shipment-keyed page-key arm);
FCL born-ready keeps the union-branch contract.

## FB-033 owner ruling — cards 141026230710 (P1) + 141026230720

NOT implemented; per TC-B2 these reopen an owner ruling. Facts on main
(`e717d2cb`) so the question is answerable without digging:

1. What the cards ask (710): "Ops khai được chi phí MỌI lô hàng (yêu cầu T3:
   không chia theo cá nhân/xe)". Repro blockers the card hit: (a) OPS opens
   `/shipments` → 403 "Bạn không có quyền truy cập trang này" — role OPS has
   deliberately NO shipments policy row (`backend/src/casbin/policy.csv`,
   comment "CUSTOMER/DRIVER/OPS are deliberately absent"); (b) the per-vehicle
   grant refusal inside the khai-chi-phí dialog ("Lô này không thuộc xe bạn
   phụ trách") is ALREADY GONE — landed with card 071026210510 / the
   20261005 batch; regression-pinned absent in
   `frontend/src/features/ops/OpsExpenseFormModal.containers.test.tsx`
   ("plan step 5 — open Ops scope").
2. What already works: `/ops/orders` ("Kế hoạch làm hàng", OPS-only) lists
   EVERY lot company-wide by expected delivery date — not per-vehicle — and
   every row has "Khai chi phí"; any Ops can save on any lot (open scope).
3. 720's duplicate-warning half is ALREADY on main since `2a64156f`
   (20261005 batch): picking a cont another Ops already declared shows
   "Cont {số} đã có {tên Ops} nhập trước — bạn vẫn tiếp tục nhập chứ." —
   warning-only, Lưu stays enabled; lot-wide fees (Phí chung lô, no cont)
   never warn by design (pinned in the same file).

**Ruling question for the owner:**
(a) Có cấp role OPS đọc `/api/shipments` (+ trang /shipments và
/shipments-detail để vào "kế hoạch công việc" của lô rồi bấm Khai chi phí
ngay trên lô), hay giữ FB-033 status quo — Ops khai chi phí chỉ qua
`/ops/orders` (Kế hoạch làm hàng), vốn đã là danh sách công ty không chia
xe? Việc cấp policy `read shipments` cho OPS là thay đổi RBAC ảnh hưởng mọi
màn đọc lô (dashboard, tìm kiếm, workboard) — không tự quyết được.
(b) 720 sau khi (a) được duyệt: phần "cảnh báo trùng" đã có sẵn per-CONT;
còn "chọn toàn bộ số cont" / Phí chung lô hiện KHÔNG cảnh báo theo thiết kế
— có cần nâng cảnh báo lên mức lô không, hay per-CONT là đủ?

Both Drive cards stay in `Kanban/TODO/` for the owner — do not dispatch them
again until (a) is answered.

## Gates run this wave (per commit, before each push)

- `fc72763a`: FE `npx tsc -b` = 0 · FE vitest 4 files 48/48 · BE
  `pnpm exec tsc --noEmit` = 0 · BE `pnpm exec tsx --test` 38/38 across
  card6/card164/m84/card7/card165 · pre-commit hook green.
- `7580ff32`: BE tsc 0 · BE tsx 133/133 (new pin 2/2, dispatch-detail-plan
  88, create-path consumers 43) · FE untouched.

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| 141026230700 two tables + ticks + mandatory biên lai + no typed invoice (FE) | CODE-READ + component tests (rung ≤2) | `qa/2026-10-16_card141026230700_fe-vitest.log` (48/48) | No browser drive at 390/768/1440; driver role only; upload path mocked in tests; error/rollback path (failed upload retry) not re-driven |
| 141026230700 BE lot-photo rule + invoiced-without-number accepted | DB/API VERIFIED | `qa/2026-10-16_card141026230700_be-test.log` (38/38, real DB) | Offline-queue caller not exercised; accounting surfaces untouched |
| 161026100400 born-ready LCL visible immediately | DB/API VERIFIED | `qa/2026-10-16_card161026100400_be-test.log` (pin 2/2: fulfillment row + board row + UNASSIGNED count) | UI not driven (no browser click on Kế hoạch Chi tiết Xe); pre-fix stuck lots not backfilled; staging not touched |
| 710/720 ruling facts (403, open modal scope, warning text) | CODE-READ ONLY | policy.csv, OpsExpenseFormModal.containers.test.tsx, HANDOFF refs | No staging re-drive this wave (TC-B2 2026-10-16 is the last rung-2 evidence) |
