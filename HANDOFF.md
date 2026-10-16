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
