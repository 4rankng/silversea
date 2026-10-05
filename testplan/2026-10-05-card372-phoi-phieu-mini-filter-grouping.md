# Card 2026-10-05_372 — Bảng 1.1.1 tổng hợp phơi phiếu: mini-filter cột, trọng tải / ghi chú lái xe, quy tắc nhóm xe–container (regression case)

Case ID: TC-372-01
Feature: Bảng kiểm soát phơi phiếu (/accounting/phoi-phieu) — bộ lọc mini trên cột, trạng thái + ngày nhận phơi, và thứ tự nhóm xe / container liên tiếp.

## Đặc tả khách hàng (nguồn: thẻ #372, đặc tả 5.10 gửi 05/10/2026)
- Cột Khách hàng và Thông tin xe có bộ lọc mini dạng popup: ô tìm nhanh, nút "Bỏ lọc" và "Lọc".
- Thông số container có trọng tải; có cột ghi chú lái xe; ghi chú vận tải gom cus note + điều vận.
- Trạng thái: đã nhận phơi / chưa nhận phơi; Ngày = ngày tích chọn nhận phơi trên desktop.
- Ưu tiên xếp các dòng cùng số xe liên tiếp, cùng số container liên tiếp (xe nhà tiện thanh toán tiền đường, xe ngoài tiện theo dõi phơi phiếu).

## Lưu ý đối chiếu hiện trạng
Thẻ ghi hiện trạng là `AccountingTransportRegister.tsx`; đối chiếu mã nguồn thực tế: route `/accounting/phoi-phieu` render `PhoiPhieuControlPage.tsx` (bảng đúng đặc tả 1.1.1 — cột "Thông tin xe", "Chi hộ", "Ghi chú vận tải", "Ghi chú lái xe"). Trọng tải container (20260928_172) và ghi chú lái xe đã có trên bảng từ trước. Triển khai mới nhắm đúng bảng này.

## Automated pins
- `frontend/src/design-system/ColumnMiniFilter.test.tsx` — component dùng chung: trigger giữ nguyên nhãn cột; popover portal ra `document.body`; gõ + Enter hoặc nút "Lọc" áp dụng (trim); "Bỏ lọc" xóa và đóng; Escape đóng và trả focus về trigger; mở lại hiển thị giá trị đang áp dụng + chấm trạng thái.
- `frontend/src/pages/accounting/PhoiPhieuControlPage.selection.test.tsx` (describe "register board — column mini-filters, phoi state, grouping"):
  - lọc cột Khách hàng khớp không dấu khoảng cách ("kh binh" tìm "KH Bình"); "Bỏ lọc" trả lại đủ dòng;
  - lọc cột Thông tin xe khớp biển số (case-fold "51a") và nhà xe ("gaya"); thứ tự nhóm từ máy chủ (cùng biển liền kề) KHÔNG bị xáo trộn sau lọc;
  - dòng có ngày lấy phơi hiện `Phơi: Đã nhận phơi · <trạng thái lấy>` và `Nhận phơi: dd/mm/yyyy`; dòng chưa có hiện `Phơi: Chưa nhận phơi`;
  - lọc về 0 dòng: hiện "Không có dòng nào khớp bộ lọc cột." + nút "Bỏ lọc cột"; dòng bị ẩn không thể vào phiếu chi.
- `backend/src/tests/phoi-phieu-control.test.ts`:
  - "same container number lands adjacent within a truck group" — trong cùng nhóm biển số, cặp dòng chung số container nằm liền kề và đứng trước; `sortBy=date` vẫn ghi đè;
  - "rows carry the phoi-take state and date the register renders" — `phoiTakenDate` / `phoiTakeStatus` về tới dòng bảng.

## Quy tắc nhóm ở tầng dữ liệu
Gom nhóm là display sort trên cửa sổ 300 dòng đã chọn theo ngày (không đổi tập dòng giữa hai chế độ — pin cũ "grouping never changes the row SET" giữ nguyên). Khóa: biển số → số container → thứ tự ngày (ổn định) trong nhóm nhỏ nhất bằng nhau.

## Not covered bởi hồ sơ này
- Bằng chứng UI DRIVEN (rung 3) trên app thật: do lane chính chạy sau deploy staging (đúng phân công thẻ).
- Bộ lọc nhiều giá trị cùng lúc: thẻ để mở câu hỏi "Cần chốt với khách hàng" — hiện tại mỗi cột một giá trị "chứa".
- Áp dụng quy tắc nhóm cho các bảng chi tiết bên dưới: chưa thuộc phạm vi thẻ.
