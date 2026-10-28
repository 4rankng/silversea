# case-2026-10-29-sil577 — Escape suite đỏ trên main: mock Toast cũ sau merge SIL-555/629

- Ticket: SIL-577 — regression gate RED tại main (merge 4ecf5957 gộp fix-sil-a11y
  vào sau khi 6bcc4b78 đã lên main).
- Repro: `cd frontend && pnpm exec vitest run src/features/dispatch/dispatch-overlays.escape.test.tsx`
  → FAIL "container drawer: Escape closes the drawer shell" (5/6 case còn lại PASS).
- Root cause: test viết trên nhánh `fix-sil-a11y` (branch-off TRƯỚC 6bcc4b78) mock
  `../../components/shared/Toast` chỉ có `useToast`; SIL-555/629 đưa
  `useToastOptional()` vào DispatchContainerDetailDrawer (tsx:641 + 3 subcomponent
  inline edit) → render crash `No "useToastOptional" export is defined on the mock`.
  Cùng defect class với phần 6bcc4b78 đã tự sửa ở 3 file MasterPlanPage* (Toast
  mock thiếu useToastOptional khi drawer mount) — file test escape chưa tồn tại
  trên main lúc sweep nên bị lọt. Impl KHÔNG thiếu handler: `Drawer`
  (components/UI.tsx) giữ nguyên `useConfirmShortcuts` window-level +
  `useShellEscape` root handler, drawer vẫn truyền `openerRef` → Esc đóng shell +
  focus trả về trigger (SIL-576) intact.
- Fix: cập nhật mock trong test theo convention 629
  (`useToastOptional: () => ({ toast: vi.fn() })`), không đụng product code →
  hành vi XÓA CONT (SIL-555/629) giữ nguyên.
- Pin: `frontend/src/features/dispatch/dispatch-overlays.escape.test.tsx` (6 case:
  Escape đóng cả 3 overlay, token-trap discriminating, inner-edit contract, focus
  về opener).
- Evidence: `qa/2026-10-29_sil577-escape_vitest-baseline.log` (trước fix),
  `qa/2026-10-29_sil577-escape_vitest-final.log` (sau fix), tsc log cùng ngày.
