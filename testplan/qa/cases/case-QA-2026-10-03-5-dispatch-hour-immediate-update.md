# Case QA-2026-10-03-5 — Saved dispatch hour shows in the schedule column immediately (card 20261002_269)

- **Case ID:** QA-2026-10-03-5
- **Reported:** 2026-10-02, R34 (P1): editing the dispatch hour saves but the grid keeps the old time.
- **Root cause (verified, not the reported cache theory):** the detail-plan schedule cell derived from
  `time.runAt`/deliveryDate only — the saved `plannedEndAt` (Giờ trả hàng) was never rendered by the
  column; the PATCH persists correctly (DB row updated, verified).
- **Surface:** /dispatch-detail Kế hoạch Chi tiết — the Điều phối editor (DispatchPlanEditorCell) and
  the schedule cell of the same row.
- **Mutation surface:** mutates 1 fixture row via the editor's Lưu thay đổi (set → verify → restore);
  declare per-run: "mutates: 1 fixture row via Lưu thay đổi".
- **Status:** case PREPARED — fix landed (see card for sha); UI DRIVEN local rung captured on the card;
  staging rung owed at wave cut.

## Steps

1. Login `dungnv`/Abc123 → /dispatch-detail. Open a row's editor (Sửa ô điều phối), set Giờ trả hàng
   to a new time (e.g. 13:00 05/10/2026), Lưu thay đổi.
2. The row's schedule cell shows "13:00 05/10/2026" IMMEDIATELY (within ~1s, no reload).
3. Reload /dispatch-detail: still "13:00 05/10/2026" (the persisted plannedEndAt renders).
4. Rows without a plannedEndAt keep their prior shapes: appointment time, hour-int, date-alone
   (card 20261003_304), or the bare dash when fully unknown.

## Expected

- Editor, grid and database agree on the saved hour at every point; no stale-old-hour window.

## Local rung (2026-10-03)

- AC3 fresh load (persisted 13:00): cell = "13:00 05/10/2026".
- AC2 save 14:00: cell = "14:00 05/10/2026" within ~1s.
- Restore (segments cleared + save): cell back to "01/10/2026"; DB planned_end_at NULL.
