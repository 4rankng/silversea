# SIL-755 (id 875) — /dispatch-detail: responsive cột Thao tác và chống cắt header/nút ở 1440px

- Ticket: SIL-755 (board SIL, id 875, tạo 08/11/2026).
- Surface: `/dispatch-detail` — Bảng Kế hoạch Chi tiết Xe (`DetailedPlanGrid.tsx`, `DetailedPlanGrid.css`).

## Bug (kết quả thực tế trước fix)

Tại viewport 1440px (container content ~1144px sau trừ sidebar 248px), bảng điều vận chi tiết tràn ngang, cột sticky-right "THAO TÁC" bị cắt cụt tiêu đề thành "THAO T…" và nút menu `⋯` bị ép sát mép/cắt cụt do column share chỉ có 3.15% (~48px) và CSS fix cứng `max-width: 48px; width: 48px;`.

## Nguyên nhân

Commit trước đó (SIL-713) ép cột Thao tác xuống `width: 48px; min-width: 44px; max-width: 48px;` và giảm share xuống `3.15%` để ép 2 nút xếp dọc. Tuy nhiên:
1. Chuỗi header "THAO TÁC" (8 ký tự in hoa) ở font 11px cần ~60-64px + padding 8px = ~70px. Ở 48px, chữ bị cắt thành "THAO T…".
2. Bề rộng 48px trừ padding và border chỉ còn 39px content, khiến nút `⋯` (30px) bị dính sát đường biên cột và dễ bị clipping khi trình duyệt căn chỉnh subpixel.

## Thay đổi (fix)

1. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css`:
   - Tái cân bằng share cột: `.detailed-plan-grid__col--actions { width: 5.5%; }` (~83.6px tại floor 1520px), điều chỉnh `.detailed-plan-grid__col--notes { width: 12%; }` (vẫn đạt 182px ≥ 160px floor quy định). Tổng shares giữ tròn 100%.
   - Cập nhật `.detailed-plan-grid th.detailed-plan-grid__th--actions` và `td.detailed-plan-grid__cell--actions`: chuyển `width: 72px; min-width: 68px; max-width: 88px;` vừa khít trọn vẹn nhãn "THAO TÁC" không bị truncate.
   - Cập nhật `--dpg-actions-reserve: 72px;` đảm bảo nội dung cuộn bên dưới cột Ghi chú không bị đè bởi cột Thao tác sticky.
2. Cập nhật các test style pins (`DetailedPlanGrid.rowheights.styles.test.ts`, `DetailedPlanGrid.sil572.verify.styles.test.ts`).

## Regression evidence

- Vitest: `DetailedPlanGrid.rowheights.styles.test.ts`, `DetailedPlanGrid.sil572.verify.styles.test.ts` (13/13 passed).
- Component tests: `DetailedPlanGrid.test.tsx`, `DetailedPlanGrid.container-port-weight.test.tsx` (81/81 passed).
- Frontend typecheck: clean.
