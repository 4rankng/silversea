# case-SIL-608 (remainder) — picker Loại cont: bấm line phải mở ngay suggestion menu

- **Board:** SIL-608 (id 711) — điểm 3 "UX picker Loại cont lỗi UX (dropdown/render sai)".
- **Reported:** 2026-10-30, build 8f376365: bấm "Chọn loại" trong Thông tin hàng → dropdown không lên / cảm giác render sai.
- **Root (đã chứng minh bằng ui-drive):** `ShipmentCreateContainerRow` mở line LOẠI bằng `openGroupLine('type')` (openMenu=false) — floating card nổi lên với một ô combobox TRỐNG ("bare caret"); operator phải bấm lần nữa vào ô hoặc gõ mù mới thấy options. Nhánh Tab hand-off 272 lại mở menu (`openMenu=true`) — click chủ đích bị đối xử KÉM hơn Tab. Drawer đối soát đã giải cùng bài toán bằng click-to-open listbox (CusLotView: "the type-to-search combobox collapses to a bare caret inside this narrow panel"); create form giữ combobox vì "+ Thêm" (TC-CUS-CREATE-020) nên phải mở menu trên click.

## Repro (trước fix)

1. Mở `/shipments/new` (FCL), bấm line "Chọn loại" (dòng 1).
2. Floating card mở nhưng KHÔNG có danh sách options — ô combobox trống (evidence: qa/2026-10-30_sil608_picker_ui-01.png trước fix, driver log PICK-01 MENU-CLOSED).

## Expected (sau fix)

1. Một cú bấm line "Chọn loại" mở floating card VÀ suggestion menu cùng lúc (9 options, kênh `open()` của 272 hand-off); bare focus một mình vẫn KHÔNG mở (luật 21/09).
2. Gõ để filter (openOnType 20260921_1), "+ Thêm" vẫn trong menu, click option commit + đóng card — không hồi quy.
3. Menu popover đúng cap 224px, scroll nội bộ, nằm trọn viewport (đo `popoverRect` = scroll box, KHÔNG đo listbox con — rect của listbox vượt scroll lane là hành vi chuẩn của overflow clip, không phải lỗi).

## Date-first sweep (SIL-608 mục 2, verify-only)

- Main 92622b53 + 13066269: SplitDateTimeField/BufferedUuiDateInput + CombinedDateTimeSurface (picker mở ở nửa ngày, group click → `openPanel('date')`), CusQuickEdit, ScheduleEditor — ĐÃ date-first, KHÔNG đụng lại.
- `DispatchContainerDetailDrawer`: raw `type="date"` trước `type="time"` trong DOM — đã đúng, không sửa.
- CSS sweep: không còn `order`/`row-reverse` đảo visual order; mọi consumer kế thừa shared components.
- Gap duy nhất tìm thấy: `ShipmentCreateWorkspace.enter-save.test.tsx` còn pin join-text thứ tự GIỜ-trước ('16|30|22|11|2026' / '16|30|||') → fail trên main sau 92622b53 — đã cập nhật sang date-first ('22|11|2026|16|30' / '|||16|30'), ý pháp FB-002 giữ nguyên.

## Regression guards

- `frontend/src/features/shipments/create/ShipmentCreateContainerRow.sil552-floating.test.tsx` — "clicking the LOẠI line floats the combobox AND opens its menu — no bare caret".
- `testplan/qa/scripts/qa-2026-10-30-sil608-picker-loai-cont.mjs` — PICK-01..05 rung 3 (menu mở, filter, + Thêm, commit, viewport fit).
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.enter-save.test.tsx` — join-text date-first.
