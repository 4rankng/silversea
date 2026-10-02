# Case QA-2026-09-28-11 — Chi phí lái xe vào lô hàng: ô "Số hóa đơn" theo ĐÚNG phân loại danh mục

- **Case ID:** QA-2026-09-28-11
- **Cards:** `20260928_163` (AC1/AC3 — phí có hóa đơn đi kèm số hóa đơn) và `20260928_164`
  (AC1/AC2 — 7 mục không hóa đơn không được chạm phải thu khách hàng).
- **Yêu cầu nguyên văn (PM, `20260928_chi-phi-PM-spec.txt`):**
  > "Phí nâng: nếu có -> nhảy vào phải thu khách hàng + số hóa đơn (khi KT phơi phiếu tích xác nhận)"
  > "Phí khác có hóa đơn: Phí vệ sinh, phí lưu bãi, phí lưu kho (nếu có) -> nhảy vào phải thu khách hàng - phí khác (mục có hóa đơn)"
  > "Chi công nhân tại kho, hàn cont, cân lốp, đảo vỏ, đóng/trả 2 điểm, đảo hàng, phí xe nâng hạ đăng khoa (có phiếu thu)
  > — lái xe tự điền -> không thu khách -> kế toán phơi phiếu tích xác nhận và thanh toán"
- **Liên quan trực tiếp:** `case-QA-2026-09-25-01` mục 3 (dropdown "Loại phí" của OPS chỉ hiện mỗi nhãn MỘT
  lần) — hai mã trùng nhãn `SANITATION`/`STORAGE_FEE` đã được retirement bằng migration
  `20260928202603_retire_duplicate_fee_codes`; case này giữ phần đó khỏi tái phát ở tầng dữ liệu.

## Phạm vi

Frontend (form chi phí lái xe + payload gửi lên) và dữ liệu danh mục `forwarder_expense_types`.
KHÔNG đổi schema, KHÔNG đổi công thức tiền, KHÔNG đổi RBAC.

- Phân loại "có hóa đơn / không hóa đơn" phải lấy từ **danh mục** (`requires_invoice` của `forwarder_expense_types`),
  không phải từ việc lái xe có gõ số hóa đơn hay không.
- Ô "Số hóa đơn" chỉ được hiện với mục có hóa đơn; mục không hóa đơn KHÔNG hiện ô đó và KHÔNG gửi số nào lên API.
- Đây là case cho một bất biến cấp trường: nếu nó vỡ, dòng không hóa đơn lại chảy vào phải thu khách hàng mà
  không ai thấy (không có màn hình nào báo).

## Bề mặt & fixture

- Màn: `http://localhost:7175/my-trips/<tripId>` (role DRIVER) → nút **"Thêm chi phí"** → tab **"Chi phí lô hàng"**
  (component `frontend/src/components/trip/ShipmentCostEntryForm.tsx`).
- Fixture local (dev-seed): trip `1` — `TRP-202608-0001`, IN_TRANSIT, lái xe `pho` (Nguyễn Văn Phố), shipment `5`.
- Đăng nhập: `pho` / `Abc123` (`testplan/testaccounts.txt`).
- Nửa thứ hai (dropdown OPS): `/ops` → "Khai báo chi phí" → combobox **"Loại chi phí"**, tài khoản OPS `giaonhan` / `Abc123`.

## Mutation surface (khai báo trước)

`mutates: 2 dòng chi phí MỚI trên trip 1 (một mục có hóa đơn, một mục không hóa đơn) qua 'Lưu chi phí'`,
trên DB local dev. Mỗi lần chỉ MỘT tap lưu, trên một mục đã đọc kỹ nhãn trước khi tap. Không sửa/xoá dòng nào
có sẵn, không chạm fixture của lane khác. Nửa dropdown OPS là read-only (mở combobox, đếm nhãn, đóng bằng Esc/Cancel).

## Steps

1. Login `pho` / `Abc123` → mở `http://localhost:7175/my-trips/1`.
2. Bấm **"Thêm chi phí"** → tab **"Chi phí lô hàng"** đang chọn sẵn.
3. Combobox **"Loại chi phí"** → chọn **"Phí nâng"**. Quan sát: có ô **"Số hóa đơn"** và **"Ngày hóa đơn"**;
   nhập Thực chi `50000`, số hóa đơn `QA-163-HD`, bấm **"Lưu chi phí"** → dòng lưu được, danh sách hiện "HĐ QA-163-HD".
4. Mở lại **"Thêm chi phí"** → chọn **"Đảo vỏ"**. Quan sát: **KHÔNG có ô "Số hóa đơn"**. Nhập Thực chi `90000`,
   bấm **"Lưu chi phí"** → dòng lưu được với nhãn "Đảo vỏ", không có "HĐ …".
5. Với dòng "Đảo vỏ" vừa lưu: mở màn quyết toán của lô (`/shipments/5` → tab Chi phí - Quyết toán, tài khoản
   `ketoan` / `Abc123`) và màn P3 phơi phiếu → dòng này KHÔNG xuất hiện ở phía phải thu khách hàng.
6. Cùng lô, dòng "Phí nâng": trước khi KT tích xác nhận thì cũng CHƯA vào phải thu; sau khi KT tích
   (`/accounting/phoi-phieu` → chi tiết chuyến → tick xác nhận) thì khoản mới vào phải thu kèm số hóa đơn.
7. Đăng nhập `giaonhan` / `Abc123` → `/ops` → "Khai báo chi phí" → mở combobox **"Loại chi phí"** → mỗi nhãn
   xuất hiện đúng MỘT lần: không còn hai dòng "Phí vệ sinh" và không còn hai dòng "Phí lưu kho"; các mục
   "Đảo vỏ", "Hàn cont", "Cân lốp", "Đóng/trả 2 điểm", "Đảo hàng", "Phí xe nâng hạ đăng khoa",
   "Chi công nhân tại kho" vẫn còn chọn được.
8. (Full-page) Chụp toàn trang `/my-trips/1` ở trạng thái có cả hai dòng chi phí, và toàn trang màn quyết toán
   lô 5 ở bước 5 — 1280/1440/1920/2560.

## Expected behavior

| # | Kỳ vọng |
|---|---|
| 1 | Mục thuộc nhóm có hóa đơn ("Phí nâng", "Phí hạ", "Phí vệ sinh", "Phí lưu bãi", "Phí lưu kho") hiện ô "Số hóa đơn" + "Ngày hóa đơn"; lưu thiếu số hóa đơn bị API từ chối kèm thông báo "Phí có hóa đơn phải kèm số hóa đơn." |
| 2 | Mục không hóa đơn ("Đảo vỏ", "Hàn cont", "Cân lốp", "Đóng/trả 2 điểm", "Đảo hàng", "Xe nâng / hạ", "Công nhân tại kho") **không có** ô "Số hóa đơn"; payload gửi lên không mang `invoiceNumber`/`invoiceDate`. |
| 3 | Dòng không hóa đơn không bao giờ xuất hiện ở phía phải thu khách hàng (màn quyết toán lô và P3 phơi phiếu); nó vào nhóm chi phí tính doanh thu xe, và chỉ thanh toán được sau khi KT tích xác nhận. |
| 4 | Dòng có hóa đơn chỉ vào phải thu sau khi KT tích xác nhận, và khoản vào phải thu mang đúng số hóa đơn đã nhập. |
| 5 | Dropdown "Loại chi phí" của OPS: mỗi nhãn đúng một lần (không còn cặp `SANITATION`/`FEE_CLEANING` hay `STORAGE_FEE`/`FEE_WAREHOUSE` cùng nhãn); dòng lịch sử trỏ mã đã ngừng hiệu lực vẫn hiện đúng tên của nó. |
| 6 | Không có màn hình nào hiển thị mã nội bộ (`SANITATION`, `CONTAINER_SWAP`) cho người dùng. |

## Regression pin (tự động)

- `backend/src/tests/card6-driver-lot-cost-classification.test.ts` — bảng phân loại của danh mục được ghim theo
  dòng sống; ba loại dòng (nâng / hạ / phí khác có HĐ) chạy CÙNG một test table-driven; hai mã trùng nhãn phải
  ở trạng thái đã retirement; không có hai dòng ACTIVE nào trong họ trùng nhãn.
- `backend/src/tests/card164-driver-no-invoice-lot-cost.test.ts` — cả 7 mục không hóa đơn: số hóa đơn gõ vào bị bỏ,
  phải thu luôn 0, chi phí xe tăng đúng bằng số tiền sau khi xác nhận.
- `frontend/src/components/trip/ShipmentCostEntryForm.test.tsx` — hai test mới: mục có hóa đơn hiện ô số hóa đơn
  và gửi kèm mã danh mục; mục không hóa đơn KHÔNG hiện ô đó và không gửi `invoiceNumber`.
- Case này chạy lại ở mỗi wave QA; bất kỳ bất biến nào ở bảng "Expected behavior" vỡ thì re-route về BE/FE như
  một defect mới (không "sửa" bằng cách nới test).
