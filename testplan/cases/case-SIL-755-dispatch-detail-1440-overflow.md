# SIL-755 (id 875) — /dispatch-detail: responsive cột Thao tác và chống cắt header/nút ở 1440px

- Ticket: SIL-755 (board SIL, id 875, tạo 08/11/2026, re-opened round 2 sau build e6db602f).
- Surface: `/dispatch-detail` — Bảng Kế hoạch Chi tiết Xe (`DetailedPlanGrid.tsx`, `DetailedPlanGrid.css`).

## Bug (kết quả thực tế trước fix)

### Round 1
Tại viewport 1440px (container content ~1144px sau trừ sidebar 248px), cột sticky-right "THAO TÁC" bị cắt cụt tiêu đề thành "THAO T…" và nút menu `⋯` bị ép sát mép/cắt cụt do column share chỉ có 3.15% (~48px) và CSS fix cứng `max-width: 48px; width: 48px;`.

### Round 2 (Sau build e6db602f)
QA kiểm tra trên build `e6db602f`: Bảng vẫn có chiều rộng thực tế 1.580px - 1.592px và bị tràn ngang ~391px - 449px ở viewport 1440px. Nút menu `⋯` ở cột Thao tác bị đẩy ra ngoài vùng nhìn thấy, phải cuộn ngang mới thấy được.
Nguyên nhân: `.detailed-plan-grid` có rule `min-width: 1520px;` cố định, ngăn bảng co giãn theo container cha (~1129px).

## Thay đổi (Fix Round 2)

1. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css`:
   - Bỏ `min-width: 1520px;` trên `.detailed-plan-grid`. Đặt `width: 100%; max-width: 100%; table-layout: fixed;`.
   - Tái cân bằng share các cột (tổng tròn 100%):
     - Schedule: 11.5%
     - Route: 12%
     - Ports: 8% (2 cột Cảng = 16%)
     - Documents: 7.5%
     - Container: 6.5%
     - Declaration: 6.5%
     - Assignment: 14.5%
     - Classification: 6%
     - Notes: 12%
     - Actions: 7.5%
   - Cột Thao tác: `width: 78px; min-width: 74px; max-width: 88px; white-space: nowrap;`.
   - Actions reserve: `--dpg-actions-reserve: 78px;`.
2. Cập nhật unit test và style test:
   - `DetailedPlanGrid.rowheights.styles.test.ts`
   - `DetailedPlanGrid.sil572.verify.styles.test.ts`
   - `DetailedPlanGrid.test.tsx`

## Đo đạc thực tế tại viewport 1440px (Puppeteer / Rung 3 UI DRIVEN)

Đo bằng script `qa/measure_after_755.mjs` trên live UI với tài khoản `dungnv` (DISPATCHER):

| Chỉ số đo | Trước fix (build e6db602f) | Sau fix (Round 2) | Yêu cầu | Đạt? |
|---|---|---|---|---|
| `wrapper.clientWidth` | 1.129px | 1.129px | Container content | — |
| `wrapper.scrollWidth` | 1.520px | 1.129px | `scrollWidth <= clientWidth` | ĐẠT |
| `overflowAmount` | +391px (tràn ngang) | 0px (không tràn) | = 0 | ĐẠT |
| `table.offsetWidth` | 1.520px | 1.129px | Co trọn vẹn trong container | ĐẠT |
| Tiêu đề "Thao tác" | 83.6px (tràn) | 84.75px, `isTruncated: false` | Không bị cắt cụt | ĐẠT |
| Nút menu `⋯` | x > 1440 (ngoài viewport) | width: 30px, right: 1374px, `isVisible: true` | Nằm trong khung nhìn, không bị cắt | ĐẠT |

### Bằng chứng ảnh
- Trước fix: `qa/SIL-755_before_1440.png`
- Sau fix: `qa/SIL-755_after_1440.png`
- Script đo: `qa/measure_after_755.mjs`

## Regression evidence
- Vitest: `pnpm test src/features/dispatch/detailed-plan/` (93/93 passed).
- Frontend typecheck: `cd frontend && npx tsc -b` (0 errors).
