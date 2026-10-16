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

- Controller: this session (Paseo agent). Branch `feat/kanban-wave-1016b`,
  cut from origin/main @ `1e2beebe`. One commit: `8374666c` (FB-083 label
  pin). Pushed. Backend not touched (BE tsc 0 recorded anyway).
- Headline finding: ALL FIVE cards' features were already merged to
  origin/main by their original per-card dispatch branches (13–14/10) —
  the prior "lost" wave agent's work was not needed. The IN_PROGRESS
  folder was stale; that is why the wave was re-dispatched.
  - QA2-005 search: ShipmentsPage search box + server-side
    `cusRecordSearchCondition` (bill/booking/mã lô/cont/tờ khai/customer).
    Pins: ShipmentsPage.test.tsx + backend cus-shipment-workspace.test.ts.
  - FB-066 quick-add: TripInfoCard `+ Thêm nhanh` on Xe đầu kéo/Lái xe
    (owner ruling 2026-10-14, commit b51d063b via e2dc48a6). Pin:
    TripInfoCard.quick-add.test.tsx.
  - FB-083 label: "Ngày giao hàng" (69708174). Was unpinned → this wave
    added the label pin (8374666c).
  - FB-084 CBM optional: FE unmarked + BE intake not enforced (69708174).
    Pins: asterisk-contract test + backend shipment-intake-lcl-cargo.test
    (3/3 green; needs `pnpm --dir shared build` first in a fresh worktree).
  - FB-085 per-cont tờ khai: schema + migration 20261013210105/06 backfill
    + ledger UI + copy + divergence (5ef12393, b47fffc5). Pins: 61 FE tests
    incl. the four mandated scenarios (per-cont edit, copy propagation,
    diverge-after-copy, single-cont lot unchanged).
- Board hygiene: all five card .docx moved IN_PROGRESS → DEV_COMPLETED on
  the Google Drive Kanban board (dev-done lane; QA lane is next).
- Gates this wave: FE tsc 0 · scoped vitest asterisk-contract 5/5 ·
  ledger+declarations 61/61 · trip quick-add 9/9 · BE tsc 0 · BE intake
  3/3. Logs: qa/2026-10-16_kanban-wave-fb083_*.log.
- UI rung: ≤2 for every card — code-read + executed pins; no browser drive
  this session (features carry their own landed rung-3 evidence in qa/
  from their original dispatches). Auto-ship merges + deploys main; the
  only delta is the FB-083 test pin.
