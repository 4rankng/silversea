# SIL form cluster (681 r2 · 688 · 690 · 691 · 692) — kế hoạch kiểm thử hồi quy

Năm ticket cùng vùng form/shipment, một lane, 5 commit riêng. Build gốc: `dcaa8295`.
Môi trường: local `make dev` (vite lane :7185 → backend :3002, DB dev `ss-prod-db`
silversea), role CUS `tiepvv` (+ ADMIN cho 688), 1440/768/390.

## SIL-681 r2 (id 789, regression) — Hãng tàu biến mất trên tab Hàng lẻ

- Repro: `/shipments/new` → tab Hàng lẻ → section Nhận diện lô. DOM scan toàn trang:
  0 phần tử chứa "Hãng tàu" (QA comment 3885 + baseline drive `qa/2026-11-06-lane-form/before/`).
- Nguyên nhân gốc (điều tra, KHÔNG phải do rebuild 681): gate `cargoMode === 'FCL'`
  trên cell hãng tàu có từ refactor 79ed4e03; payload root null-lập hãng tàu LCL từ
  0abff7aa (14/08/2026) — lỗi thiết kế cũ, QA chỉ nhìn thấy giờ vì tab LCL là mặt
  bằng mới được dùng.
- Expected: tab Hàng lẻ có ô Hãng tàu (SearchableField + trailing '✎' TRONG input,
  cùng chiều cao input — đúng pattern SIL-681), gõ MSC → option → Enter commit được;
  payload root giữ `shippingLineName` cho cả FCL và LCL. Trên FCL không đổi gì.
- Regression lock: `ShipmentCreateIdentitySection.sil681-trailing.test.tsx` (case LCL
  mới: cell + trailing button tồn tại, cùng pattern FCL), model test (root payload
  LCL mang shippingLineName).

## SIL-690 (FB-008) — mất bulk-apply "Ngày giờ đóng trả"

- Repro: FCL, thêm 2 container, nhập lịch dòng 1 → không có nút nào áp 1 lần cho
  tất cả; sửa dòng 1 không lan dòng đã có (baseline: applyAllButtons=0).
- Nguyên nhân gốc: KHÔNG phải rebuild — chip "Áp dụng cho N container" retired có
  chủ đích (SIL-511, 26/10), input bulk datetime retired (SIL-642, 31/10). Nút còn
  lại "Copy giờ hẹn xuống cont trống" chỉ điền dòng TRỐNG (source `copySourceRow`
  + `emptyAppointmentKeys`), không đổi được lịch đã nhập. SIL-690 (owner 06/11)
  là chỉ thị mới khôi phục bulk-apply → supersede 2 ruling đó ở phạm vi này.
- Expected: nút "Áp dụng cho N container" dưới bảng container (FCL), lấy lịch của
  dòng đầu tiên có lịch, ghi vào MỌI dòng khác (trống + đã có), toast xác nhận;
  lịch vẫn sống duy nhất ở cột NGÀY GIỜ ĐÓNG TRẢ (không tái sinh input datetime
  thứ hai của SIL-642).
- Regression lock: `ShipmentCreateWorkspace.copy-appointment.test.tsx` viết lại
  (bulk-apply đè cả dòng đã có, toast, giữ copy per-row/clipboard).

## SIL-691 (FB-007) — nhà máy không hiện SĐT

- Repro: chọn khách LONG MINH, gõ ASKEY vào Nhà máy → gợi ý chỉ có tên (baseline
  `anyPhone=false`); popup "Xem chi tiết" thiếu dòng SĐT. DB: 4 site ASKEY đều
  `contact_phone=NULL` (SQL bookend trong driver log).
- Expected: (a) gợi ý Nhà máy (LCL) hiện supportingText SĐT như picker FCL đã làm
  ở FB-007 r16 + tìm được theo SĐT (searchText); (b) popup chi tiết hiện SĐT khi
  dữ liệu có (dialog `OperationalSiteDetailsDialog` đã render `Số điện thoại` từ
  trước — DRI-01). Dữ liệu trống → không hàng SĐT (không chế số): phần SĐT ASKEY
  cần sửa master-data; lane chỉ chứng minh FE hiển thị khi có giá trị (seed local
  `0912345678` cho ASKEY-Xưởng 1, đã query verify).
- Regression lock: test component picker LCL (supportingText + searchText có SĐT).

## SIL-692 (FB-129) — nút Lưu dòng container bị "Ghi chú" đè

- Repro (đã tái hiện rung-2, `qa/2026-11-06-lane-form/before/`): form FCL, mở
  editor trọng lượng chưa mở — card `.csc-fline__card` ở trạng thái rest
  (absolute, opacity 0, pointer-events none) vẫn có hình học: nút Lưu nằm tại
  (512,715) đúng vùng tiêu đề `#shipment-section-notes .csc-section__heading`;
  elementFromPoint trả heading → click(selector) timeout 30s như QA báo. Trạng
  thái mở: card fixed z-400, nút Lưu hit đúng (đã đo).
- Expected: editor đang mở → nút Lưu luôn bấm được (hit = nút) bất kể trọng lượng
  trống hay đã điền, tại mọi width 390/768/1440; trạng thái rest không còn hộp
  bóng đè lên vùng khác (visibility hidden), không đổi keyboard walk mở editor.
- Regression lock: `ClerkShipmentCreatePage.styles.test.ts` case SIL-552 mở rộng
  (rest visibility hidden; open visibility visible + các pin cũ giữ nguyên).

## SIL-688 — không có nút "Xóa lô" trên UI

- Repro: `/shipments/:id` chỉ có Quay lại/Sửa/Tạo mới (baseline xoaLoButtons=0);
  `/shipments-debit` menu dòng không có xóa. BE đã có: `DELETE
  /api/shipments/cus-workspace/:id` (`requireRoles(CUS, ADMIN)`, body version +
  reason; lô đã phát lệnh → 409 "Chỉ xóa được khi mọi container chưa phát lệnh").
  Danh sách lô: drawer header đã có thùng rác Xóa lô (gate `role CUS/ADMIN`) —
  QA passo vai tiepvv nên không thấy; admin còn path này.
- Expected: chi tiết lô (/shipments/:id) có "Xóa lô" (giọng danger, gate CUS/ADMIN,
  xác nhận + lý do bắt buộc, gọi đúng flow BE `deleteCusShipment`, toast "Đã xóa
  lô hàng.", về danh sách); lô đã phát lệnh → nút tắt kèm lý do. /shipments-debit
  menu "…" thêm mục "Xóa lô" cùng flow. Chỉ xóa lô thả tự lane tạo, không đụng lot
  QA 835/836/846/847/828 trên staging.
- Regression lock: test view actions (Xóa lô render theo prop + lock state) + test
  debit menu entry.

## Gates chung

- Scoped vitest: `npx vitest run src/features/shipments/create src/pages/clerk` trong
  frontend — gồm file sil681/sil660/copy-appointment (phải giữ pass).
- `npx tsc -b` 0 lỗi; `make build` thành công.
- Rung-3 driver sau-fix cho từng ticket + screenshot `qa/2026-11-06-lane-form/after/`.
