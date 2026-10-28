# case-2026-10-28-sil575 — Pin toggle /ops/orders làm rơi keyboard focus

- Ticket: SIL-575 (board id 653), lane `fix-sil-a11y`.
- Repro (live /ops/orders 1280): click/keyboard trên `button.ops-pin` (aria-label
  "Ghim …") → sau khi handleTogglePin resolve, rows re-sort (pinned lên đầu),
  button đang focus bị move/unmount → `document.activeElement = BODY`. Thêm nữa
  pass `disabled={pendingPinId !== null}` làm button rời tab order + blur
  mid-flight.
- Expected: pin/unpin bằng keyboard giữ focus trên đúng button của order đó ở
  vị trí mới; `aria-pressed` vẫn phản ánh state; trong lúc pending chỉ dùng
  `aria-disabled`/`aria-busy` (không `disabled`) để focus không rơi.
- Pin: `frontend/src/pages/OpsOrdersPage.test.tsx` — case mới: focus giữ sau
  re-sort (pin lẫn unpin), không có `disabled` attr, aria-busy mid-flight.
- Evidence: `qa/2026-10-28_sil575_tsc.log`, `qa/2026-10-28_sil575_vitest.log`.
