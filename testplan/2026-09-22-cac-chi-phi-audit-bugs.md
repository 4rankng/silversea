# Regression Test Plan — Audit tài liệu các chi phí.pdf

**Ngày cập nhật:** 2026-09-23 (Phiên re-test toàn diện đợt 2)  
**Mục tiêu:** Kiểm thử thực tế toàn bộ các yêu cầu trong tài liệu `/Users/dev/Downloads/các chi phí.pdf` trên môi trường local dev (`http://localhost:7175`, API `:3002`, DB `:5441`).  
**Tài khoản sử dụng:** `ketoan` (Kế toán), `giaonhan` (OPS Giao nhận), `laixe` (Lái xe) — Mật khẩu: `Abc123` (theo `testplan/testaccounts.txt`).  
**Thư mục bằng chứng:** `qa/2026-09-23_cac-chi-phi-comprehensive/` và `qa/2026-09-22_cac-chi-phi-audit/`  
**Kanban Tickets tương ứng:**
- `20260922_67` (trước là 51): Popup phơi phiếu vẽ ngoài màn hình -> **ĐÃ FIX & PASS** (Đã chuyển `QA_PASSED/`)
- `20260922_54`: Header "Thông số container" ngắt CONTAINE / R -> **ĐÃ FIX & PASS** (Đã chuyển `QA_PASSED/`)
- `20260922_52`: Bảng hóa đơn kết hợp 14 cột chồng chữ -> **FAIL / OPEN** (Trong `TODO/`). Rework v2 (2026-09-23): verdict QA_PASSED cũ bị REVOKED — xem `TC-CCP-02a` / `TC-CCP-02b` dưới đây.
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

---

## 3. Rework v2 — card `20260922_52` (2026-09-23, sau khi Director REVOKE)

Ảnh operator 23/09 chứng minh chữ vẫn tràn đè cột kế bên ở cột 3 (thông tin lô hàng) và cột 7 (thông tin hđ), kèm regression chuỗi `INV-EMPTY-<id nội bộ>` lộ ra UI. Hai case dưới đây là ca hồi quy bắt buộc cho card này.

### `TC-CCP-02a` — Không cell nào được vẽ ra ngoài biên cột (cột 3 + cột 7)

| Mục | Nội dung |
|---|---|
| Màn hình | `/accounting/invoice-tracking` (vai `ketoan` / ADMIN, layout 14 cột) |
| Mức độ | **P1 (High)** |
| Repro | Nạp bảng với dòng dữ liệu thật: cột 3 = mã lô + tên khách pháp lý dài (`CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH`), cột 7 = `Số hóa đơn: <số HĐ>` + `Số tiền`. Đo ở 1280 / 1440 / 1920 / 2560. |
| Expected | Với **mọi** `td`: `scrollWidth <= clientWidth + 1`. Cột chứa token dài (mã lô, số hóa đơn) được **nở rộng theo nội dung** (design law §4 — token EXPAND), cột chứa văn bản **wrap** (`overflow-wrap: anywhere`); bảng nở ra và `.table-scroll` cuộn ngang. Tuyệt đối không clip/ellipsis trên cell dữ liệu. Cột tiền (`Số tiền trả`, `Chênh lệch`) căn phải, có phân cách hàng nghìn. |
| Hiện trạng (before) | **FAIL (REPRODUCED)**: CSS HEAD `table-layout: fixed` → cột 3 `scrollWidth 240 / clientWidth 176` (tràn 64px sang Cont), cột 7 `scrollWidth 338 / clientWidth 184` (tràn 154px sang Số tiền trả). |
| Kết quả sau fix | **PASS**: `spillCount = 0` tại cả 4 chiều rộng, cho cả dòng rò rỉ nguyên bản lẫn dòng có số hóa đơn 50 ký tự (max schema). |
| Bằng chứng | `qa/2026-09-23_c52-invoice-tracking/layout-measurements.json`, `layout-before-fixed-1440.png`, `layout-after-contentsizing-1440.png`, `layout-after-guarded-2560.png`, harness `qa/2026-09-23_c52-invoice-tracking/layout-harness.mjs` |
| Regression pin | `frontend/src/pages/AccountingInvoiceTrackingPage.styles.test.ts` (hợp đồng CSS) + `frontend/src/pages/AccountingInvoiceTrackingPage.render.test.tsx` |
| Chưa phủ | Chưa drive UI thật trên staging/local (card yêu cầu KHÔNG browser QA); số đo lấy từ harness nạp đúng stylesheet + font self-hosted, không phải app đang chạy. |

### `TC-CCP-02b` — Chuỗi `INV-EMPTY-*` / id nội bộ KHÔNG được render ra UI

| Mục | Nội dung |
|---|---|
| Màn hình | `/accounting/invoice-tracking`, cột 3 + cột 7 + prompt xóa |
| Mức độ | **P1 (High)** — vi phạm luật internal-ids-never-render (card `20260919_38`, design law §8) |
| Repro | Trong DB có dòng `invoice_tracking` với `invoice_number = 'INV-EMPTY-<epoch>-q10-<rand>'`, `shipment_code = 'Q10-<epoch>-q10-<rand>-<n>'`, `deleted_at IS NULL` (dòng fixture do test q10 để lại — xem §4). Mở bảng trong kỳ chứa `expense_date` của dòng đó. |
| Expected | Không một chuỗi `INV-EMPTY`, `-q10-`, hay id/fixture nội bộ nào xuất hiện trong DOM hiển thị; cell hiển thị token rỗng của nhà (`—`). Giá trị nghiệp vụ thật (`HD-C18-01`, `SHP-2609-00020`, tên khách hàng thật) giữ nguyên. |
| Hiện trạng (before) | **FAIL (REPRODUCED)**: DOM render `Số hóa đơn: INV-EMPTY-1790165053059-q10-8h9x64`, lặp nhiều dòng. |
| Kết quả sau fix | **PASS**: `document.body.textContent` không còn `INV-EMPTY` / `q10` / `1790165053059`; cell hiển thị `—`. |
| Bằng chứng | `frontend/src/pages/AccountingInvoiceTrackingPage.render.test.tsx` (`qa/2026-09-23_c52-invoice-tracking/frontend-vitest.log`) |
| Regression pin | `frontend/src/lib/format.test.ts` → `formatBusinessRef` |
| Chưa phủ | Dòng đã rò rỉ sẵn trong DB staging vẫn tồn tại (chỉ được hiển thị là `—`); xem §4 để dọn dữ liệu. |

---

## 4. Nguồn gốc placeholder `INV-EMPTY` (điều tra & fix tại nguồn)

- Placeholder **không** do code production sinh ra: `git log -S "INV-EMPTY"` chỉ trả về một commit (`5a193598`), và toàn repo chỉ có một chỗ ghi chuỗi này — `backend/src/tests/q10-soft-delete.test.ts` (fixture `INV-EMPTY-${suffix}`, `suffix = ${Date.now()}-q10-${random}`).
- Test đó ghi thẳng vào **DB ứng dụng** (`backend/src/db` dùng `DATABASE_URL` của dev/staging). Hook `after()` xoá `trip_expenses` **trước** `invoice_tracking`, nhưng `invoice_tracking.expense_id` là FK `NO ACTION` → câu DELETE đầu tiên bị từ chối, `catch {}` nuốt lỗi, **toàn bộ batch cleanup không chạy**. Hệ quả: **mỗi lần chạy test đều để lại 1 dòng tracker `deleted_at NULL`** (cộng shipment/customer/user/route) → hiện lên bảng.
- Đã sửa: thứ tự xoá theo FK (tracker → expense → trip → fulfillment → `ops_expense_entries` → shipment → route → customer → user), bổ sung track `ops_expense_entries`, và lỗi cleanup được `console.error` thay vì nuốt im lặng.
- Bằng chứng: `qa/2026-09-23_c52-invoice-tracking/backend-leak-proof.log` — chạy test xong, mọi counter (`invoice_tracking`, `q10_users`, `q10_shipments`, `q10_customers`, `ops_expense_entries`) không đổi.
- Dọn dữ liệu đã rò rỉ (chạy tay trên từng DB, KHÔNG tự động):
  ```sql
  -- kiểm tra trước
  SELECT count(*) FROM invoice_tracking WHERE deleted_at IS NULL AND invoice_number ~ '^INV-EMPTY-[0-9]{13}-q10-';
  -- xoá đúng chữ ký fixture q10 (13 chữ số epoch + marker -q10-)
  DELETE FROM invoice_tracking WHERE invoice_number ~ '^(INV|INV-EMPTY)-[0-9]{13}-q10-[a-z0-9]{6}$';
  DELETE FROM ops_expense_entries WHERE shipment_id IN (SELECT id FROM shipments WHERE shipment_code ~ '^Q10-[0-9]{13}-q10-[a-z0-9]{6}-[0-9]+$');
  DELETE FROM trips    WHERE trip_code ~ '^Q10-T-[0-9]{13}-q10-[a-z0-9]{6}-[0-9]+$';
  DELETE FROM shipments WHERE shipment_code ~ '^Q10-[0-9]{13}-q10-[a-z0-9]{6}-[0-9]+$';
  DELETE FROM routes    WHERE name ~ '^Q10 route [0-9]{13}-q10-[a-z0-9]{6}$';
  DELETE FROM customers WHERE name ~ '^Q10 customer [0-9]{13}-q10-[a-z0-9]{6} [0-9]+$';
  DELETE FROM users     WHERE username ~ '^q10(-ops)?-[0-9]{13}-q10-[a-z0-9]{6}-[0-9]+$';
  ```
  Ghi chú: sau khi fix, các dòng này đã render là `—` nên không còn lộ id nội bộ; việc xoá chỉ để dọn dữ liệu rác.
