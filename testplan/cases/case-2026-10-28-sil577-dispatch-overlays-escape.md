# case-2026-10-28-sil577 — Dispatch overlays không đóng bằng Escape

- Ticket: SIL-577 (board id 655), lane `fix-sil-a11y`.
- Repro (live, dungnv @1280/320): 3 overlay mang role=dialog + aria-modal +
  focus moves in nhưng Escape ×3 không đóng (Hủy/close vẫn chạy):
  `/dispatch` container drawer (DispatchContainerDetailDrawer) — Escape handlers
  chỉ ở INNER inputs (revert inline edit), shell không có đường Escape;
  `/dispatch-detail` Phân xe lại (AssignTruckGroupDialog); `/dispatch` Phân bổ
  nhà xe (DispatchAllocationLclDialog). CUS /shipments lot drawer vẫn đúng.
- Root cause class: đường Escape shell đi qua `useConfirmShortcuts` window-level
  — nó yield khi token của overlay KHÔNG ở top stack (page layer mounted giữ
  token trên nó) → shell mất Escape hoàn toàn; inner editors dùng
  `preventDefault()` trên Escape (đúng ý đồ revert-first).
- Fix: `useShellEscape` gắn ở root role=dialog của Modal + Drawer (bubble trước
  window listeners) — đóng shell deterministically; guard giữ nguyên hợp đồng
  inner: `defaultPrevented` (inline-edit revert) + open picker /
  `[data-escape-boundary]` tự giữ Escape trước. Wire `openerRef` (T654) qua 3
  overlay + 2 trang dispatch (allocation/container/assign triggers) để focus
  trả về opener.
- Pin: `frontend/src/features/dispatch/dispatch-overlays.escape.test.tsx`
  (Escape đóng cả 3; token-trap discriminating; inner-edit contract; focus về
  opener).
- Evidence: `qa/2026-10-28_sil577_tsc.log`, `qa/2026-10-28_sil577_vitest.log`.
