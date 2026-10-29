# Case: SIL-572 (board id 650) — pager controls clear the pinned rail band at every scroll offset

- **Route:** `/dispatch-detail` (Kế hoạch Chi tiết) — table mode (≥768px)
- **Roles:** Điều vận (dieuvan), quản trị; bất kỳ data set có số dòng vượt chiều cao pane (50 dòng/trang)
- **Related:** SIL-584 (same family @768), card 20260921_22 (pager in flow)

## Bug (QA round 3, build c2d740c5)

Trigger ⋯ (kebab) của các dòng bị ẩn dưới fold của bounded pane có bounding
rect đi thẳng qua dải pager ngay sau pane — đo được giao nhau kebab ∩ nút
"Trang sau" tại **mọi vị trí cuộn**: 1280 → 30×14 / 30×5 / 30×30; 1440 cùng
mẫu; 1920 → 30×27 / 30×4 / 30×28. Click tâm vùng giao rơi vào pager (bề mặt
đục thắng click theo round 2) → kebab không dùng được tại offset đó.

Root cause: `getBoundingClientRect()` bỏ qua clip `overflow: auto` của pane —
rect của row ngoài màn hình vẫn báo đầy đủ; dòng ẩn kế tiếp luôn bắt đầu tại
cạnh dưới pane nên rect của nó quét qua dải pager tại gần như mọi offset.
Kebeb nằm trong rail Thao tác sticky (3.7% band, dải phải) — trùng x-band với
cụm nút pager căn phải.

## Expected behavior

- Tại **mọi** scroll offset (rest → mid → full), **không** rect của bất kỳ
  rail trigger (⋯ / Phát lệnh) nào giao bất kỳ control nào của pager.
- Pager vẫn in-flow (card 20260921_22), vẫn surface đục nâng z (round 2).
- Kebab dòng nhìn thấy mở menu dòng khi click.

## Fix contract (round 3)

Pager reserve ngang đúng rail share: `padding-inline-end: calc(max(1340px,
100%) * 0.037 + var(--space-sm))` trên
`.dispatch-plan-page__workspace > .ds-pagination` — dải control pager kết
thúc trước band rail ở mọi canvas → ix = 0 cấu trúc, mọi engine, mọi offset.

## Verify

- Driver: `qa/scripts/ui-sil572-pager-clearance-verify-20261030.mjs` — sweep
  11 offset × {1280, 1440, 1920, 768} × mọi rail trigger: 0 giao nhau; band
  gap ≥ 7.9px tại mọi offset; surface contract giữ nguyên; kebab click mở
  menu. Log: `qa/2026-10-30_sil572_ui-driver-round3.log`.
- Pins: `DetailedPlanGrid.sil572.verify.styles.test.ts` (reserve + surface),
  `DetailedPlanGrid.sil584-pager-separation.styles.test.ts`,
  `DispatchPlanPage.test.tsx` (in-flow contract).
