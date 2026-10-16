# Kanban wave 1016c — same five cards: re-run evidence, one commit per card (2026-10-16)

- Controller: this session (Paseo agent). Branch `feat/kanban-wave-1016c`, cut
  from origin/main @ `ae419e3d`. Five commits (one per card), pushed after each
  green one — the batching death of the two prior 1016c lanes is why. No code
  changes: every card's behavior was already on main (see 1016b below and each
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
