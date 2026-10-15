# Cost UX theo tài liệu kế toán "Fix lại các chi phí của từng phân hệ" (regression cases)

Nguồn: docx kế toán 14/10/2026 ( Downloads/"Fix lại các chi phí của từng phân hệ.docx"),
mục Ops + Kế toán. Năm thay đổi, mỗi thay đổi một commit trên nhánh
`feat/cost-ux-accounting`.

## TC-COSTUX-01 — Mọi Ops đều khai chi phí được mọi lô

Doc: "Ops được phép điền tất cả các chi phí lô hàng (không chia cá nhân nào nhận
bao nhiêu xe, tất cả các Ops đều được điền chi phí)".

Repro (trước sửa): Ops B (không có link/assignment xe nào của lô X) mở "Khai báo
chi phí" của lô X → form chặn: "Lô này không thuộc xe bạn phụ trách…" (probe mở
form) và save bị 403.

Expected (sau sửa):
- Ops B mở form khai chi phí lô X: form dùng bình thường, không có từ chối mở.
- `POST /api/ops/expenses` của Ops B trên lô X tạo được khoản chi (201).
- Endpoint `GET /api/ops/expenses/write-scope` bị xóa cùng quyền hạn cũ (hợp
  đồng cũ rút khỏi client).
- Không đụng vào Casbin policy (quyền vai trò OPS không đổi).

## TC-COSTUX-02 — Cảnh báo cont đã có Ops khác nhập

Doc: "Khi 1 Ops đã điền chi phí, chọn toàn bộ số cont, nếu có Ops khác nhập,
hệ thống sẽ hiện cảnh báo: ĐÃ ĐƯỢC ID…. NHẬP TRƯỚC ĐÓ, BẠN VẪN TIẾP TỤC NHẬP
CHỨ, để các Ops kiểm tra lại tránh nhập trùng".

Repro (trước sửa): Ops A đã nhập chi phí cont "ABCU1234567" của lô X. Ops B mở
khai báo chi phí lô X, chọn cont đó (hoặc "Phí chung lô") và lưu → không có
cảnh báo nào, dễ nhập trùng.

Expected (sau sửa):
- Khi Ops B chọn scope có cont mà Ops khác (không phải B) đã có khoản chi chưa
  hủy, hệ thống hiện modal xác nhận với tiêu đề đúng chữ:
  "ĐÃ ĐƯỢC ID <tên> NHẬP TRƯỚC ĐÓ, BẠN VẪN TIẾP TỤC NHẬP CHỨ?" kèm danh sách
  cont xung đột và người đã nhập.
- "Hủy" → không lưu, giữ nguyên lựa chọn đang đứng.
- "Tiếp tục" → cho lưu trong phiên mở form này; đã ack thì không hỏi lại cùng
  bộ cont đó.
- Khoản chi do chính mình nhập không gây cảnh báo; khoản đã hủy (VOIDED) không
  gây cảnh báo.

## TC-COSTUX-03 — Thêm khoản chi (kiểm soát phơi phiếu) làm gọn

Doc: "Nhóm chi phí: Chỉ thể hiện : Tiền đường / Chi phí lô hàng…", "Nếu khi
chọn chi phí, chọn 'bên thực chi' sẽ hiện ra: 3 mục như phần mềm đang hiện.
Nếu chọn 'Nhà cung cấp', hệ thống mặc định ghi nhận là tên nhà xe đang chạy
tuyến đường đó", "Ở them khoản chi này làm gọn lại giúp em".

Expected (sau sửa) — panel "Thêm khoản chi" mở từ 2 dialog của màn kiểm soát
phơi phiếu (tiền đường + chi hộ):
- Nhóm chi phí chỉ có "Tiền đường" / "Chi phí lô hàng".
- Chọn "Nhân viên chi" (bên thực chi) → hiện "Người thực chi"; cặp "Số hóa
  đơn / Ngày hóa đơn" hiển thị sẵn, tùy chọn.
- Chọn "Nhà cung cấp" → select nhà cung cấp tự điền bằng nhà xe đang chạy
  chuyến (trip `carrierType='EXTERNAL', externalEntityType='SUPPLIER'` → khớp
  danh mục suppliers theo id, dự phòng theo tên); không có nhà xe ngoài thì
  để chọn tay.
- Form gọn: không còn "Ghi chú khoản chi"; "Loại phí" và "Ngày chi" vẫn còn vì
  hợp đồng lưu (`expenseAccountingCreateSchema`) bắt buộc cả hai.

## TC-COSTUX-04 — Nhập khoản chi liên tục

Doc: "Được phép tiếp tục them chi phí, không điền 1 chi phí rồi lưu, mất thời
gian".

Expected (sau sửa): lưu 1 khoản thành công → drawer KHÔNG đóng; các ô của từng
khoản (loại, tên, số tiền, thu khách, hóa đơn, nhà cung cấp) được làm trống để
nhập tiếp; nhóm chi phí / bên thực chi / ngày giữ nguyên; có dòng trạng thái
"Đã lưu khoản chi." Nút "Đóng" mới kết thúc phiên nhập.

## TC-COSTUX-05 — Chốt debit: chỉ chỉnh giao diện

Doc: "Kế toán chốt debit: Giao diện hiện đang không được đẹp mắt, fix lại giúp
em trước."

Expected (sau sửa) — màn `/accounting/chot-debit`:
- Ba vùng rõ: tổng hợp (SummaryRail) / chờ xác nhận (dòng PENDING) / tổng hợp
  công nợ (các đợt chốt).
- Trạng thái trong ô bảng vẫn là chữ thuần (luật nhà: data cells text-only,
  không pill), phân biệt bằng tone chữ + color-dot nhà.
- Không đổi logic nào: dữ liệu, nút, quyền, câu chữ nghiệp vụ giữ nguyên.
