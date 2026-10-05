# Card 2026-10-05_373 — Chi tiết chi phí: xác nhận / từ chối / sửa + Người thanh toán (regression case)

Case ID: TC-373-01
Feature: bảng chi tiết chi phí mở từ bảng tổng hợp phơi phiếu — `PhoiPhieuTienDuongDialog` (tiền đường) và `PhoiPhieuChiHoDialog` (chi hộ).

## Quyết định sản phẩm (owner đã giao agent, 2026-10-05)
- **"Tích xác nhận / từ chối" là ĐỐI CHIẾU giá trị lái xe đã nhập, KHÔNG phải phê duyệt nhiều cấp.** Cùng cách hiểu đã áp dụng cho #373 và đã ghi ở `docs/prd/README.md` §2.1. Không mở lại luồng phê duyệt.
- **Từ chối dùng lại trạng thái `VOIDED` sẵn có, KHÔNG thêm trạng thái `REJECTED` mới.** Lý do: hệ thống đã có `status: 'RECORDED' | 'VOIDED'` và đã có hàm huỷ ghi nhật ký; thêm trạng thái mới sẽ kéo theo migration và một trạng thái chỉ khác tên. `VOIDED` vốn đã mang nghĩa "khoản này không được dùng".
- **Bắt buộc có lý do khi từ chối**, ghi vào nhật ký thay đổi (đã có sẵn cơ chế `auditLogs.payload.reason`).
- **Xe ngoài**: giữ nguyên hành vi kế toán nhập/sửa trực tiếp như hiện tại.

## Kết quả đối chiếu mã nguồn — phần lớn thẻ ĐÃ CÓ SẴN
Đặc tả yêu cầu nhiều thứ đã được xây từ trước. Ghi lại để không làm lại hoặc làm hỏng:
- **Bước xác nhận của kế toán: ĐÃ CÓ.** `confirmAccountingExpenses` (`backend/src/services/expense-accounting-write.service.ts:183`) ghi `confirmedById`/`confirmedAt:212`, bắt buộc vai trò tài chính, chặn xác nhận trùng, và ghi bút toán phải trả. Dialog tiền đường đã nối đúng đường này (`PhoiPhieuTienDuongDialog.tsx:73` → `POST /expense-accounting/confirm`).
- **Sửa mà không mất giá trị gốc: ĐÃ CÓ.** `correctAccountingExpense` (`backend/src/services/expense-accounting-correction.service.ts:15`) là điều chỉnh bất biến — giữ bản ghi gốc và lịch sử tiền, chỉ đảo nghĩa vụ ròng rồi xác nhận bản thay thế.
- **Cột "Người thanh toán" ở bảng chi hộ: ĐÃ CÓ.** `PhoiPhieuChiHoDialog.tsx:191,215` render cột này, dữ liệu `payerName` đến từ `phoi-phieu-control.service.ts:629,692`; có test ghim đúng bộ cột tại `PhoiPhieuChiHoDialog.test.tsx:243`.
- **STT, Nội dung, Số tiền thu, Số tiền trả, tổng cộng, nút thêm dòng, ô tích "Nhập Thu và Trả bằng nhau" ở bảng chi hộ: ĐÃ CÓ** (`PhoiPhieuChiHoDialog.tsx:171,229,231-234`).
- **Không cần migration.** `payerUserId` được SUY RA lúc đọc (`expense-accounting-source.service.ts:72,83,183`), không phải cột lưu. Loại xe thì đọc từ `tripCarrierInfo` (quan hệ 1:1 theo chuyến, mặc định `OWN`); cột `trips.carrier_type` **đã bị bỏ** ở migration `0056_damp_bloodstorm.sql:50` và chỉ còn là phép chiếu của một view.

## Khoảng cách thật sự — 4 việc còn thiếu
1. **Từ chối khoản lái xe nhập: ĐANG THIẾU.** `voidPhoiPhieuRow` (`backend/src/services/phoi-phieu-control.service.ts:776`) lọc cứng `sourceKind = 'OPS'`, nên một dòng do LÁI XE nhập mà kế toán không đồng ý thì không thể từ chối được. Ngoài ra dòng đã đối chiếu cũng bị chặn (`:784` 409) — cần chốt xử lý.
2. **Bảng tiền đường thiếu cột "Người thanh toán".** `PhoiPhieuTienDuongRow` (`phoi-phieu-control.service.ts:805-844`) không trả trường người trả nào cả, khác với bảng chi hộ.
3. **Chưa ràng xe nhà / xe ngoài.** Loại xe đã có sẵn ở `tripCarrierInfo` (1:1/chuyến, mặc định `OWN`) nhưng truy vấn cũ không lấy, nên chưa thể áp luật "chỉ xe nhà mới xác nhận/từ chối". **Đã làm cho đường từ chối** (chặn 409 khi chuyến là xe ngoài). Phần chặn trên đường XÁC NHẬN chưa làm — xem mục chưa phủ.
4. **Cột "Nội dung" ở bảng chi hộ thiếu mã đơn** mà đặc tả nêu ("kèm mã đơn"); hiện chỉ có `feeName`.

## Một lỗi do thẻ này làm lộ — đã sửa
`zone-surcharge.service.ts` cộng `driver_incidental_costs.amount` cho bậc `LIFT_DROP_ZONE` mà KHÔNG nối bảng nguồn và không lọc trạng thái, trong khi bậc `OVERRIDE` ngay phía trên thì có. Trước thẻ này điều này vô hại, vì một dòng lái xe nhập không bao giờ bị từ chối được. Thẻ này mở ra trạng thái đó, nên một khoản nâng/hạ ĐÃ BỊ TỪ CHỐI vẫn tiếp tục biện minh cho phụ cấu vùng. Đã sửa: nối `expenseAccountingSources` (kind `DRIVER`) và lọc `VOIDED`, y hệt cách `getPhoiPhieuTienDuong` đang làm, vẫn giữ nhánh null để chi phí legacy chưa gắn nguồn vẫn được tính.

## Repro
1. Đăng nhập kế toán → Kiểm soát phơi phiếu → chọn một chuyến có dòng tiền đường do lái xe nhập.
2. Mở bảng chi tiết 'Tiền đường'. Quan sát: có cột "Kế toán duyệt" nhưng KHÔNG có cột "Người thanh toán"; không có nút từ chối dòng lái xe nhập.
3. Mở bảng chi tiết 'Chi hộ'. Quan sát: CÓ cột "Người thanh toán", nhưng cột "Nội dung phí" không kèm mã đơn.

## Expected
- Dòng lái xe nhập: kế toán được từ chối, bắt buộc nhập lý do, dòng không được dùng để lập phiếu, và việc từ chối được ghi nhật ký.
- Bảng tiền đường có cột "Người thanh toán" hiện đúng người thực sự thanh toán, giống bảng chi hộ.
- Quy tắc xe nhà / xe ngoài được áp dụng: xác nhận / từ chối / sửa chỉ dành cho xe nhà; xe ngoài giữ nguyên hành vi kế toán nhập trực tiếp.
- Bảng chi hộ hiện Nội dung kèm mã đơn.
- Bảng tổng hợp vẫn CHỈ hiện nguồn chi phí; lập phiếu thu/chi vẫn chỉ xảy ra ở bảng chi tiết.
- Mọi đường cũ vẫn mở được; không đổi route.

## Not covered ở hồ sơ này
- Bằng chứng UI rung 3: xem bảng coverage trong thẻ.
- Câu hỏi tiền thật còn treo: sau khi kế toán xác nhận, tiền chi trừ vào tạm ứng lái xe hay tạo phải trả riêng. Hệ thống hiện đã hỗ trợ cả hai qua `allocatedAdvanceAmount`; thẻ này KHÔNG đổi cách ghi tiền, chỉ ghi nhận điểm này để LEAD/khách hàng chốt.
