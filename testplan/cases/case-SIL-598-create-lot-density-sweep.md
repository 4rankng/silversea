# SIL-598 (id 698) — Form tạo lô hàng có nhiều khoảng trắng lớn, bố cục quá thưa (quét toàn form)

- Ticket: SIL-598 (board SIL, id 698, priority MEDIUM, báo cáo 30/10/2026, ảnh telegram đính ticket).
- Surface: `/shipments/new` (ClerkShipmentCreatePage), mọi role có quyền tạo lô. QA đề xuất
  vai trò CUS (tiepvv); lane fix drive bằng ADMIN (form mở được, ghi rõ theo đề bài).
- Phạm vi: các khoảng trống CÒN LẠI sau khi SIL-596 (id 696) sửa chỗ chính — quét toàn form
  (mọi band/row) theo cùng doctrine §10.8.2 (không ô grid trống) + data-dense SIL-515.

## Bug (trạng thái sau fix 696, trước fix 698 — qa/2026-10-30_sil596-sil598-before)

1. Card "Loại hàng" bị kéo giãn cao bằng card Nhận diện lô (238px) nhưng chỉ có 1 dòng
   control (~60px nội dung) — khung vượt xa nội dung thực tế, ~154px mặt trống bên trong.
2. Band "Lịch & ghi chú": field "Ngày giờ đóng trả cho tất cả cont" ngồi một mình trong
   cột 1fr (~402px) với control ~150-260px → dải chết ~150-265px cạnh nó.
3. "Thông tin hàng": bảng container full-width, dày — không có vùng chết (đo, không sửa).

## Root cause

- (1) là hệ quả trực tiếp của fix SIL-596: mode card `align-self: stretch` để card cùng
  row cao bằng, nhưng không có nội dung dòng 2.
- (2) thừa hưởng từ SIL-499: bulk datetime + notes pair chia 1fr/2fr — cột bulk rộng gấp
  đôi control của nó.

## Expected sau thay đổi

1. Card mode có nội dung dòng 2 thật: field "Ngày giờ đóng trả cho tất cả cont" (FCL)
   chuyển lên nằm cạnh Loại hàng — đúng precedent SIL-587 (LCL datetime đã mở sẵn trong
   mode band, "everything trước mắt", cards 211026130215/30315). Gate giữ nguyên
   (`cargoMode === 'FCL' && emptyAppointmentCount >= 1`). Nội dung căn giữa card → air
   cân đối, không khung rỗng.
2. Band "Lịch & ghi chú" = notes pair full-width 1 hàng (bỏ tách 1fr/2fr + mọi placement
   pin của bulk) + chip copy-down giữ nguyên vị trí.
3. LCL: bulk ẩn (null), band route nguyên trạng. Mobile 390: bulk full-width như cũ
   (flex-grow trong mode row), thứ tự field lên đầu form theo doctrine SIL-587.
4. Ngân sách SIL-499: @1280×800 vẫn không scrollbar dọc.

## Regression lock

- `ShipmentCreateWorkspace.onescreen.styles.test.ts` pin mới: bulk block nằm trong mode
  band (slice giữa `csc-mode-band__row` và `<ShipmentCreateIdentitySection`), gate
  FCL + emptyAppointmentCount; cấm `#shipment-section-schedule .csc-bulk-appointment`
  và `#shipment-section-schedule { grid-template-columns:` hồi sinh; mode card pin
  `align-self: stretch; align-content: center`.
- Driver `qa/drivers/2026-10-30-sil596-whitespace-ui-drive.mjs` đo trước/sau @1280/1307/
  1440/768/390 + pass LCL (qa/2026-10-30_sil598_ui-driver-*.log, thư mục ảnh
  qa/2026-10-30_sil596-sil598-before|after).
