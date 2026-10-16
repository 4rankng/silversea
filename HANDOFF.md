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
