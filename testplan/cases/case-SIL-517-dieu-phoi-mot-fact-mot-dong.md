# SIL-517 — cột ĐIỀU PHỐI: mỗi thông tin một dòng riêng, hết cắt "..."

- Ticket: SIL-517 (board SIL, id 579, Todo) — owner 26/10, ảnh đính kèm ticket
  (dòng "15E-0… · Nguyễn H… · 09849…" cắt giữa chừng).
- Surface: `/dispatch-detail` bảng (≥640px), cột ĐIỀU PHỐI — mọi role đọc bảng.

## Yêu cầu owner

1. Cột ĐIỀU PHỐI dồn nhiều thông tin vào MỘT dòng rồi cắt "…" — tách mỗi
   thông tin ra một dòng riêng.
2. Expected: dòng 1 nhà xe (SilverSea/ATS); dòng 2 biển số ĐỦ; dòng 3 tên tài
   xế ĐỦ; dòng 4 SĐT ĐỦ; dòng 5 trạng thái. Không thông tin nào ẩn sau "…".

## Case pin (expected sau thay đổi)

1. `.dispatch-assignment-cell__vehicle-group` là grid 1 cột — biển số, tên
   tài xế, SĐT mỗi cái một dòng riêng dưới dòng nhà xe.
2. Không separator `·` giữa các fact (separator chỉ tồn tại để dồn một dòng).
3. Giữ nguyên luật SIL-515: mọi fact wrap full (không nowrap/ellipsis) —
   giá trị dài wrap, không cắt.
4. Trạng thái (chip) vẫn dòng riêng cuối cell.

## Regression lock

- `DispatchPlanGrid.rowheights.styles.test.ts` pin `display: grid` + cấm
  `content: '·'` + cấm nowrap trong vehicle-group.
- `DispatchPlanEditorCell.test.tsx` — plate/driver/SĐT là sibling cùng group,
  mỗi cái một dòng (CSS pin trên chốt hình ảnh).

## Gates

- Scoped vitest: `npx vitest run src/features/dispatch/detailed-plan src/features/dispatch/components`.
- Typecheck: `npx tsgo --noEmit` (frontend).
- Rung-3: driver puppeteer @1440 trên `/dispatch-detail` — screenshot cột
  ĐIỀU PHỐI sau fix, assertion mỗi fact một dòng, không ellipsis.
