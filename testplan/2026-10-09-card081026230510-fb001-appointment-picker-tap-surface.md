# Card 081026230510 — FB-001: ô NGÀY GIỜ ĐÓNG TRẢ không mở picker khi click (retest round 8)

Ngày: 2026-10-09 · lane Agent-MiniMax · ưu tiên P2

## Vấn đề đã báo

Round 7 (~15:00 08/10): click ô "NGÀY GIỜ ĐÓNG TRẢ" trên form tạo lô (CUS) mở picker
ngày+giờ kết hợp ("Chọn ngày giờ") — pass. Round 8 (~22:30): click đơn/đúp vào ô chỉ
focus vào segment nhập tay (HH:mm + DD/MM/YYYY), không picker/dialog nào mở ra.

## Điều tra (đã xác minh bằng probe UI thật ở HEAD)

- Khung hồi quy 8897e3f2..371f297f KHÔNG có commit nào đụng forms/create-page — wiring
  picker nguyên vẹn từ trước round 7 (đã `git log` kiểm chứng từng file).
- Luật owner hiện hành (card 061026172803): click SEGMENT = caret click, KHÔNG mở
  picker; picker mở từ KHUNG nhóm. Sau 443f5c14 (siết width segment + padding-inline 0)
  vùng khung trong nhóm chỉ còn ~3px slack + 2 dấu ngăn cách.
- Cell appointment rộng 240px, lưới fields là `fit-content` (~196px) → phần còn lại của
  ô là dead-space ngoài các nhóm segment, không có handler — click không có gì xảy ra.
- Round 7 pass = tester trúng khung/ngăn cách; round 8 fail = tester bấm segment hoặc
  dead-space. Defect: hành vi "click ô phải mở picker" không còn đạt được bằng click
  thường ở HEAD (probe 3 đường: segment → không mở; khung 3px → mở; đúp segment → không mở).

## Cách sửa

`SplitDateTimeField.tsx` chế độ `combinedPicker` (đúng cụm tap-surface card
051026230627): click vùng trống của thân field (ngoài nhóm segment, không phải INPUT)
mở picker; click segment giữ nguyên caret. Host không combinedPicker giữ nguyên.

## Phạm vi hồi quy trước khi sửa

| # | Khu vực | Rủi ro | Kiểm bằng |
|---|---|---|---|
| R1 | Click segment phải caret, không picker | Sửa mở picker cả trên segment — vi phạm luật 061026172803 | Pin test segment-click (suite combined + DateTimeSegments.test) |
| R2 | Host per-part popup (dispatch editor, filter bar) | Root handler làm reopen sai part | Gate: toàn bộ suite design-system forms xanh; handler chỉ bật khi combinedPicker |
| R3 | Pick hoạt động bình thường sau khi mở | Root handler phá popup/ESC | Suite combined + escape + parent-dismissal xanh |
| R4 | 3 field lot-level khác dùng combinedPicker | Cùng cụm phải hưởng fix giống nhau | Cùng component — UI rung 1 field đại diện + test component |

## Case ID

- **FB001-R8**: click thân ô ngoài segment (dead-space trong cell 240px) phải mở dialog
  "Chọn ngày giờ" (có cả DatePanel + TimePanel); đúp cũng mở.
- Control: click segment HH vẫn chỉ focus/caret, không mở picker.
