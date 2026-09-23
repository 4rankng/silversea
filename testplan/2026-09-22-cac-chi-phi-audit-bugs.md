# Regression Test Plan — Audit tài liệu các chi phí.pdf

**Ngày cập nhật:** 2026-09-23 (Phiên re-test toàn diện đợt 2)  
**Mục tiêu:** Kiểm thử thực tế toàn bộ các yêu cầu trong tài liệu `/Users/dev/Downloads/các chi phí.pdf` trên môi trường local dev (`http://localhost:7175`, API `:3002`, DB `:5441`).  
**Tài khoản sử dụng:** `ketoan` (Kế toán), `giaonhan` (OPS Giao nhận), `laixe` (Lái xe) — Mật khẩu: `Abc123` (theo `testplan/testaccounts.txt`).  
**Thư mục bằng chứng:** `qa/2026-09-23_cac-chi-phi-comprehensive/` và `qa/2026-09-22_cac-chi-phi-audit/`  
**Kanban Tickets tương ứng:**
- `20260922_67` (trước là 51): Popup phơi phiếu vẽ ngoài màn hình -> **ĐÃ FIX & PASS** (Đã chuyển `QA_PASSED/`)
- `20260922_54`: Header "Thông số container" ngắt CONTAINE / R -> **ĐÃ FIX & PASS** (Đã chuyển `QA_PASSED/`)
- `20260922_52`: Bảng hóa đơn kết hợp 14 cột chồng chữ -> **FAIL / OPEN** (Trong `TODO/`)
- `20260922_53`: Bảng hoàn cược xén nút & gãy token ngày -> **PARTIAL / OPEN** (Token ngày đã fix, nút ở x=1655px cần cuộn ngang trên màn 1440px)

---

## 1. Danh sách các Case hồi quy (Regression Test Cases)

| Case ID | Card Kanban | Màn hình | Mức độ | Hiện trạng đợt 1 | Kết quả Re-test đợt 2 (2026-09-23) | Bằng chứng đợt 2 |
|---|---|---|---|---|---|---|
| `TC-CCP-01` | `20260922_67` | `/accounting/phoi-phieu` | **P0 (Blocker)** | Bấm "Xem chi tiết" popup render ở `top: 21,588px` ngoài màn hình | **PASS (FIXED)**: Đã bọc `OpsModalBackdrop`, popup mở ngay viewport center (`top: 0px`, `zIndex: 300`), có phím Esc/đóng | `qa/2026-09-23_cac-chi-phi-comprehensive/m1-03-chi-ho-dialog.png`, `m1-04-tien-duong-dialog.png` |
| `TC-CCP-02` | `20260922_52` | `/accounting/invoice-tracking` | **P1 (High)** | Bảng 14 cột `table-layout: fixed` chia đều 80.6px khiến text tràn 35–60px đè cột kế bên | **FAIL (REPRODUCED)**: Chữ Cột 3 tràn 82.6px sang Cột 4; Cột 7 tràn 59.4px sang Cột 8. Tổng tràn đo được 158.1px | `qa/2026-09-23_cac-chi-phi-comprehensive/m2-02-invoice-table-crop.png` |
| `TC-CCP-03` | `20260922_53` | `/accounting/deposit-tracker` | **P1 (High)** | Nút "Đã hoàn cược" bị xén cụt viền phải; token ngày gãy đôi dòng | **PARTIAL**: Token ngày hiển thị 1 dòng (PASS); Nút "Đã hoàn cược" nằm tại toạ độ x=1655px trên viewport 1440px (yêu cầu cuộn ngang) | `qa/2026-09-23_cac-chi-phi-comprehensive/m3-02-deposit-table-crop.png`, `m3-07-refund-completed-verified.png` |
| `TC-CCP-04` | `20260922_54` | `/accounting/phoi-phieu` | **P2 (Medium)** | Header "Thông số container" bị ngắt thành `CONTAINE` / `R` | **PASS (FIXED)**: Hiển thị trọn vẹn `THÔNG SỐ CONTAINER` (rộng 94.1px), không còn chữ cái R đơn lẻ | `qa/2026-09-23_cac-chi-phi-comprehensive/m1-02-header-container-crop.png` |

---

## 2. Kết quả Kiểm thử Nghiệp vụ Toàn diện 7 Phân hệ (§1 - §5)

### Phân hệ 1: Kế toán — Bảng Kiểm soát Phơi phiếu (`/accounting/phoi-phieu`)
- **Tải trang & Hiển thị (`TC-M1.1`):** **PASS**. Bảng `ppc-board` tải đầy đủ 100+ dòng, phân trang, thông tin container kèm trọng tải (`cargoWeightKg`), thông tin xe gộp biển số liên tiếp.
- **Header Thông số container (`TC-CCP-04`):** **PASS**. Text chuẩn `THÔNG SỐ CONTAINER`.
- **Xem chi tiết Chi hộ (`TC-CCP-01a` / `TC-M1.3b`):** **PASS**. Popup mở ngay trong viewport, có đầy đủ:
  - Checkbox "Tích để nhập Thu và Trả phơi bằng nhau" (tự động đồng bộ số tiền).
  - Bảng kê phí chi hộ từng dòng (STT, Nội dung phí, Hóa đơn, Số tiền thu/trả, Người thanh toán).
  - Ô nhập Ngày lấy phơi & Trạng thái lấy phơi.
- **Xem chi tiết Tiền đường (`TC-CCP-01b`):** **PASS**. Popup tiền đường mở trong viewport với backdrop cố định.
- **Báo cáo tháng Thu/Trả & Phân công xe (`TC-M1.5`):** **PASS**. Đầy đủ 2 bảng báo cáo tháng và bảng `PhoiPhieuTruckAssignments`.

### Phân hệ 2: Kế toán — Theo dõi Hóa đơn kết hợp (`/accounting/invoice-tracking`)
- **Bố cục 14 cột (`TC-CCP-02`):** **FAIL**. Bảng bị ép co lại 80.6px/cột kết hợp `white-space: nowrap` không ẩn overflow khiến chữ tràn sang đè cột kế bên (đo được tràn tới 158.1px).
- **Thêm chi phí lô hàng (`TC-M2.2`):** **PASS**. Nút "+ Thêm chi phí lô hàng" mở modal với đầy đủ trường Lô hàng, Container, Số hóa đơn, Ngày hóa đơn, Số tiền, Thuế VAT, NCC, Ghi chú.
- **Xóa hóa đơn có lý do bắt buộc (`TC-M2.3` - Q10):** **PASS**. Nút xóa kích hoạt `useReasonPrompt` yêu cầu nhập lý do bắt buộc trước khi soft-void.

### Phân hệ 3: Kế toán — Theo dõi Hoàn cược container (`/accounting/deposit-tracker`)
- **Hiển thị & Nút thao tác (`TC-CCP-03`):** Bảng có tổng chiều rộng 1397px trên khung chứa 1127px. Token ngày hiển thị chuẩn không bị gãy dòng. Cột Thao tác nằm ở cuối bảng có thanh cuộn ngang.
- **Thêm dòng cược (`TC-M3.2`):** **PASS**. Nút "+ Thêm dòng" mở modal nhập cược vỏ container.
- **Cập nhật Ngày CV (`TC-M3.3`):** **PASS**. Nút "Ngày CV / số tiền" mở modal cập nhật ngày giấy mượn container / biên lai CV.
- **Thao tác Hoàn cược & Ghi nhận Sổ quỹ (`TC-M3.4`):** **PASS (Rung 3)**. Bấm "Đã hoàn cược" -> hiện confirm dialog -> xác nhận -> CSDL ghi nhận bản ghi `treasury_movements` (id=62, quỹ ACB id=1, hướng IN, số tiền 1.000.000đ, ref `HOAN-CUOC-12-DUE1`).

### Phân hệ 4: Kế toán — Chốt Debit & Khóa đơn giá (`/accounting/chot-debit`)
- **Bảng điều động tổng hợp 18+ cột (`TC-M4.1`):** **PASS**. Bảng có 20 cột, hiển thị 558 dòng lô hàng/container với lịch trình, đơn giá biểu phí, thỏa thuận, phụ phí, chi hộ.
- **Chốt Debit (`TC-M4.2`):** **PASS**. Chọn checkbox dòng và bấm "Xác nhận đối soát" mở dialog chốt debit, khóa sửa đổi đơn giá (HTTP 409 khi cố tình sửa).

### Phân hệ 5: Kế toán — Duyệt chi phí OPS (`/accounting/expenses?view=ops`)
- **Danh sách chi phí OPS (`TC-M5.1`):** **PASS**. Màn hình "Chi phí và đối chiếu" tải 25+ dòng chi phí do giao nhận khai báo chờ kế toán duyệt.

### Phân hệ 6: OPS Giao nhận — Khai chi phí & Ví tạm ứng (`giaonhan`)
- **Khai chi phí trên đơn hàng (`TC-M6.1`):** **PASS**. Mở modal "+ Khai chi phí" trên `/ops/orders`:
  - Phân loại rõ ràng Thực chi (tiền bỏ ra) và Thực thu (tiền thu khách).
  - Checkbox "Khách trả" (tự động tick theo cấu hình).
  - Trường upload chứng từ ảnh hóa đơn / biên lai.
- **Ví tạm ứng OPS (`TC-M6.2`):** **PASS**. Trang `/ops/wallet` hiển thị số dư ví tạm ứng, các khoản đã tạm ứng/hoàn ứng, nút "Yêu cầu tạm ứng" hoạt động.

### Phân hệ 7: Lái xe — Chuyến hàng, Tiền đường & Chi phí (`laixe`)
- **Danh sách chuyến (`/my-trips`):** **PASS**. Tab "Đang chạy", "Đã nhận", "Hoàn thành" hiển thị các chuyến hàng.
- **Chi tiết chuyến (`/my-trips/195` - `TC-M7.1`):** **PASS**. Có riêng section **"Chi phí lô hàng & tiền đường"**, nút **"Thêm chi phí"** mở form với các trường:
  - Loại chi phí (Phí nâng, bốc xếp, vá vỏ, cầu đường...).
  - Số tiền phát sinh thực tế.
  - Người trả / Phương thức thanh toán.
  - Ngày phát sinh & Số hóa đơn (nếu có).
  - Nút upload ảnh biên lai viết tay / hóa đơn.
