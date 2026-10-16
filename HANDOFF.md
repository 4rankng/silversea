# W5+W4 staging QA verify — DONE, pushed (2026-10-16 08:35Z)

Controller: this session (Paseo agent). Branch `qa/w5-w4-verify` (evidence
commit pushed). Ran on staging `5a139108` (gate per phase; two records-only
auto-ship re-cuts mid-morning were ride-throughs with 0 src-file diffs).
Verdicts: FB-009/043/048/057 PASS (rung 3), FB-061 PASS-in-scope, W4
tombstone BGX01-03 PASS (rung 3 + DB proof). **1 MAJOR finding (owner
decision):** Kiểm soát phơi phiếu still prints soft-deleted QA entities on 2
rows via unfiltered joins (`STG VERIFY NHA XE 09` on real lot EBKG18452303 —
customers id 23 deleted 2026-10-04, reached via trip_carrier_info id 28;
`QA0915 QA-138 Credit Customer` on the money-report table). Remedies: board
query deleted_at filter (behaviour change) or scrub trip_carrier_info id 28.
Record `testplan/2026-10-16-w5-w4-verify.md`; evidence `qa/2026-10-16_w5w4_*`;
drivers `testplan/qa/scripts/w5w4-*.mjs`. Fixtures: 12 pricing sentinels
tombstoned, 0 live; qapurge-dry census shows 53 pre-existing QA rows on other
surfaces (NOT purged — owner-gated). Staging was not re-cut by this run.

---

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

Gates: BE tsc 0 · BE unit 5/5 (new pin) · BE full suite (see qa log) ·
FE tsc 0 · FE scoped vitest 4/4 · root lint 0 errors · make build 0.
UI rung 3: create → delete → re-create same selector on
/config/pricing-tables as admin — SUCCESS; real duplicate still blocked;
screenshots + DOM + DB rows + driver log in qa/2026-10-16_bang-gia-tombstone_*.

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
- Backend full `pnpm test` needs >15 min (integration tier, concurrency 1).
