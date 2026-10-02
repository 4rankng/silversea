# Bảng duyệt chi phí OPS thiếu ô "Chọn tất cả" trên tiêu đề cột duyệt (2026-09-22)

## Nguyên nhân và Phạm vi

QA audit tài liệu "các chi phí.pdf" mục 3.a (card Kanban-PROD `20260922_7-duyet-ops-thieu-chon-tat-ca`,
ảnh đính kèm trong card): tại tab duyệt chi phí OPS (`/accounting/expenses?view=ops`) người dùng chỉ tích
được từng dòng; thiếu ô "Chọn tất cả" ở tiêu đề cột để chọn/duyệt đồng loạt.

Nguyên nhân gốc (HEAD `c9eb7756`): `ExpenseRegisterRows` render tiêu đề cột chọn dạng text
(`<th>Chọn</th>`) không có checkbox; thao tác chọn loạt chỉ có ở toolbar ("Chọn trang này" /
"Chọn tất cả N kết quả").

Ánh xạ cột (ghi nhận để không mất công đối chiếu về sau): "cột 'Ngày duyệt'" trong tài liệu khách =
cột tích chọn của bảng (nhãn hiện tại "Chọn"); ngày xác nhận hiển thị ở cột "Đối chiếu". Thẻ chỉ yêu cầu
**thêm** checkbox nên nhãn cột giữ nguyên — đổi nhãn là quyết định sản phẩm riêng.

Phạm vi sửa: thêm checkbox "Chọn tất cả" vào tiêu đề cột tích của bảng OPS + trạng thái indeterminate;
giữ nguyên ô tích lẻ, giữ nguyên các nút toolbar cũ. Semantics: tích header = chọn mọi dòng hợp lệ
(`status = RECORDED`) **đang hiển thị** (giữ lựa chọn trang khác); bỏ tích header = bỏ chọn toàn bộ
(giống nút "Bỏ chọn (N)"). Hai host khác của cùng bảng (work drawer, shipment panel) không truyền prop
→ không đổi hành vi.

## Bộ case

**mutates: các dòng fixture tự tạo (mã QA-2026-09-22-BATCH-*) qua một lần bấm "Đối chiếu chi phí" —
không lặp bấm thao tác đổi dữ liệu trên dòng lạ; đối chứng dương đóng bằng "Hủy"/bỏ chọn, đường không
đổi dữ liệu.**

### TC-OPSSEL-01 — Header "Chọn tất cả" chọn mọi dòng hợp lệ đang hiển thị

- **Vai trò:** `ketoan` (Kế toán) — local dev, password `Abc123`
- **Mức độ:** P0
- **Các bước:** mở `/accounting/expenses?view=ops` với 2 dòng fixture `QA-2026-09-22-BATCH-05/06`
  (trạng thái "Chưa đối chiếu"). Lưu ý fixture: loại phí `LOWERING` yêu cầu hóa đơn nên fixture phải kèm
  số + ngày hóa đơn — thiếu thì API từ chối đối chiếu 409 "Bổ sung số và ngày hóa đơn trước khi đối chiếu"
  (xác minh 2026-09-22). → click checkbox "Chọn tất cả" ở tiêu đề cột tích.
- **Kết quả mong đợi (Pass):** mọi dòng hợp lệ trên bảng được tích; bộ đếm "N khoản đã chọn" khớp số
  dòng; dòng `Đã hủy`/không hợp lệ (nếu có) không được tích và ô dòng đó vẫn disabled.
- **Kỳ vọng sai (Fail nếu):** chỉ chọn một phần, chọn lẫn dòng không hợp lệ, hoặc bộ đếm sai.

### TC-OPSSEL-02 — Bỏ tích header bỏ chọn toàn bộ

- **Vai trò:** `ketoan` (Kế toán)
- **Mức độ:** P0
- **Các bước:** sau TC-OPSSEL-01 → click lại checkbox "Chọn tất cả" để bỏ tích.
- **Kết quả mong đợi (Pass):** tất cả dòng được bỏ chọn, bộ đếm "N khoản đã chọn" biến mất, thanh thao
  tác đã chọn không còn hiển thị.
- **Kỳ vọng sai (Fail nếu):** còn dòng được chọn hoặc UI thao tác đã chọn vẫn còn.

### TC-OPSSEL-03 — Trạng thái indeterminate khi chọn một phần + chọn lẻ còn dùng được

- **Vai trò:** `ketoan` (Kế toán)
- **Mức độ:** P1
- **Các bước:** bỏ chọn hết → tích đúng 1 dòng lẻ (fixture `QA-2026-09-22-BATCH-05`).
- **Kết quả mong đợi (Pass):** checkbox header ở trạng thái mixed (indeterminate), không phải checked;
  tích/bỏ từng dòng vẫn hoạt động bình thường.
- **Kỳ vọng sai (Fail nếu):** header hiện checked đầy đủ khi chỉ chọn một phần, hoặc chọn lẻ hỏng.

### TC-OPSSEL-04 — Duyệt toàn bộ dòng đã chọn bằng 1 thao tác

- **Vai trò:** `ketoan` (Kế toán)
- **Mức độ:** P0
- **mutates: 2 dòng fixture `QA-2026-09-22-BATCH-05/06` — một lần bấm "Đối chiếu chi phí"**
- **Các bước:** dùng TC-OPSSEL-01 chọn 2 dòng fixture → bấm "Đối chiếu chi phí" đúng một lần.
- **Kết quả mong đợi (Pass):** 2 dòng chuyển sang "Đã đối chiếu" kèm ngày; xác minh phía dữ liệu
  (API/DB) cho đúng 2 dòng fixture đó có dấu đã đối chiếu; không dòng nào khác bị đổi.
- **Kỳ vọng sai (Fail nếu):** phải bấm từng dòng, chỉ một phần được xác nhận, hoặc dòng ngoài fixture bị
  đổi.
