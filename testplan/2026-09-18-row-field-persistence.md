# Lưu giữ giá trị trường cấp dòng — form tạo lô (ruling/testplan 2026-09-18)

Nguồn: USER báo 2026-09-18 kèm 3 ảnh /shipments/new — gõ/chọn NHÀ MÁY ở cột
NHÀ MÁY (bảng container) không giữ lại sau khi chọn; field trả về placeholder.
Bài học quy trình: pin unit cấp dòng bị hoãn và rung staging dùng fixture LCL
(không có dòng container) nên tầng dòng chưa từng được gõ trong trình duyệt.
Bộ case này chốt tầng dòng KHÔNG được bỏ qua nữa — unit pin cấp dòng là ĐIỀU
KIỆN DEV COMPLETED của mọi fix liên quan (harness phải dựng được trạng thái
dòng, không chấp nhận "defer sang rung browser").

## Phạm vi

Trường cấp dòng trong bảng container của /shipments/new: NHÀ MÁY, TUYẾN ĐƯỜNG
(và mọi trường dòng thêm sau này cùng cơ chế chọn-lập-tục/gõ-riêng). Hai chế
độ: toggle "Lệnh chạy ngoài" ON (nhập riêng được phép) và OFF (chỉ danh mục).

## Bộ case

### TC-ROW-PERSIST-01 — Nhà máy cấp dòng, gõ riêng (adhoc ON)

- Vai trò: cus (thanhdc). Mức: P0.
- Bước: /shipments/new → thêm ≥2 dòng container → bật Lệnh chạy ngoài → dòng 1
  gõ tên nhà máy không có trong danh mục (vd "fadsf") → blur (bấm sang ô khác).
- Pass: text NGUYÊN VẸN còn trong ô (không placeholder, không xoá); lưu lô →
  payload mang tên nhà máy thô của đúng dòng, id danh mục null; dòng 2 không
  bị ảnh hưởng.
- Fail nếu: ô trả về "Chọn nhà máy"; toast lỗi tải danh sách; mất text.

### TC-ROW-PERSIST-02 — Tuyến cấp dòng, gõ riêng (adhoc ON)

- Như TC-01 với TUYẾN ĐƯỜNG cấp dòng: gõ tuyến riêng → blur giữ nguyên; lưu
  mang tuyến thô của đúng dòng; không đè tuyến auto-fill của dòng khác.

### TC-ROW-PERSIST-03 — Nhà máy cấp dòng, chọn danh mục (toggle OFF)

- Chọn khách hàng → chọn nhà máy danh mục ở dòng 1 → blur/chọn dòng khác.
- Pass: lựa chọn DANH MỤC vẫn giữ nguyên sau blur (quan hệ khách–nhà máy hợp
  lệ, tuyến auto-fill theo nhà máy vẫn điền); lưu mang id đúng.
- Fail nếu: chọn xong quay về placeholder (lỗi đang tồn tại ở tầng dòng).

### TC-ROW-PERSIST-04 — Chọn danh mục khi adhoc ON

- Toggle ON → chọn nhà máy TỪ DANH MỤC ở dòng → giữ nguyên id đường đi danh
  mục; gõ riêng ở dòng khác vẫn lưu thô. Hai kiểu nhập cùng tồn tại trong một
  lô không làm sai quan hệ dòng.

### TC-ROW-PERSIST-05 — Pin unit cấp dòng (điều kiện DEV COMPLETED)

- Suite workspace phải có pin cấp dòng: render form CÓ dòng container → gõ
  vào ô Nhà máy dòng → blur → giá trị còn; payload thô + id null. Pin chạy ĐỎ
  trước fix (bằng chứng gắn card) và XANH sau fix.
- Harness phải dựng được trạng thái dòng — không chấp nhận hoãn pin cấp dòng
  sang rung browser (bài học 2026-09-18).

### TC-ROW-PERSIST-06 — Không hồi quy auto-fill tuyến dòng

- Chọn khách/nhà máy danh mục → tuyến dòng tự điền (vd KCN Quế Võ) vẫn hoạt
  động như cũ; sửa dòng này không đổi tuyến các dòng khác.

### TC-ROW-PERSIST-07 — Bàn phím và màn hẹp

- 390px/cảm ứng: ô dòng chạm được, Enter commit, blur bằng cách sang ô khác
  vẫn giữ giá trị; focus-within không làm mất nội dung.

## Ghi chú thực thi

- Case 01–04, 06, 07: UI DRIVEN trên staging (bấm thật, ảnh từng case).
- Case 05: TEST VERIFIED — pin unit trong suite workspace, số đếm thật gắn
  thẻ; rung browser vẫn chạy song song, không thay thế nhau.
- Liên quan: testplan/2026-09-18-adhoc-definition.md (định nghĩa lệnh chạy
  ngoài), card 20260918_8 (fix tầng dòng), 20260916_3 (đã QA PASSED mức lô).
