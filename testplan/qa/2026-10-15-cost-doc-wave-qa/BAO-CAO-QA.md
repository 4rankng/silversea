# BÁO CÁO QA — Đợt cost-doc hợp nhất (Ghostty + A/B/C/D + Timesheet)

| | |
|---|---|
| **Ngày** | 2026-10-15 |
| **Môi trường** | STAGING — https://vantai.tingting.vip |
| **buildHash đã xác minh** | `5d190665` — khớp đúng commit `merge: consolidated cost-doc wave` |
| **Vai trò đã dùng** | DRIVER (`bqhuong`), OPS (`hoangnh`, `hungld`), ACCOUNTANT (`hoapt`), DISPATCHER (`dungnv`) |
| **Phạm vi** | (A) Ghostty driver cost UX · (B) OPS all-containers / duplicate / phê duyệt tạm ứng / hoàn ứng · (C) Kế toán compact thêm khoản chi / NCC autofill / chốt debit / phơi phiếu · (D) Timesheet + hoàn cước |
| **Phạm vi công việc** | CHỈ BÁO CÁO — không sửa code, không deploy |
| **Kết quả** | **4 lỗi P0/P1 · 2 lỗi P2 · 4 lỗi P3** · 12 hạng mục đã kiểm chứng đạt |

> **Xác minh build (chống stale build):** `GET /api/health` → `{"status":"ok","buildHash":"5d190665"}`.
> Đối chiếu `git show 5d190665` → đúng merge "consolidated cost-doc wave — Ghostty Card-20261005 + waves A-D".
> **Không** dùng bản stale. Cả 4 vai trò đăng nhập thành công, 0 lỗi console / 0 lỗi mạng ở trang chủ.

---

## 1. Tóm tắt lỗi theo mức độ

| # | Mã | Mức | Khu vực | Tóm tắt |
|---|---|---|---|---|
| 1 | **A-01** | 🔴 **P0 — Nghiêm trọng** | A | Dòng chi phí mặc định của lái xe **luôn** lỗi 400 khi lưu |
| 2 | **B-01** | 🟠 **P1 — Cao** | B | Thiếu tuỳ chọn "chọn toàn bộ số cont" khi khai chi phí OPS |
| 3 | **C-01** | 🟠 **P1 — Cao** | C | Tự điền nhà cung cấp (NCC) **không bao giờ** chạy — sai khoá so khớp |
| 4 | **D-01** | 🟠 **P1 — Cao** | D | Module chấm công **không có UI chế độ lương** ở đâu cả |
| 5 | **B-02** | 🟡 **P2 — Trung bình** | B | Cảnh báo cont trùng là dải chữ, **không phải modal** xác nhận |
| 6 | **A-02** | 🟡 **P2 — Trung bình** | A | Tab "Tiền đường" vẫn có Ngày chi / Ghi chú / biên lai |
| 7 | C-02 | ⚪ P3 — Thấp | C | Ô "Cược Bill/Book" không có phản hồi khi không tìm thấy kết quả |
| 8 | A-03 | ⚪ P3 — Thấp | A | Nhãn "Người chi" đã gỡ đúng, nhưng dữ liệu cũ hiện "Chưa phân loại chứng từ" |
| 9 | D-02 | ⚪ P3 — Thấp | D | Nút "Thêm dòng" (thiết kế doc: "Thêm cược") |
| 10 | D-03 | ⚪ P3 — Thấp | D | `/timesheet`, `/timesheet/doi-chieu`, `/accounting/deposit-tracker` không có trong ô tìm kiếm |

---

## 2. Lỗi chi tiết

### 🔴 A-01 — P0: Dòng chi phí mặc định của lái xe luôn bị từ chối khi lưu

**Mức:** Nghiêm trọng · **Khu vực:** A · **Vai trò:** DRIVER

**Mô tả.** Mở form khai chi phí, dòng mới mặc định sẵn:

- `Loại chi phí` = **Phí nâng** (mã danh mục `LIFTING`)
- `Loại chứng từ` = **Phiếu thu**

Nhấn **Lưu tất cả (1 dòng)** (đã đính kèm ảnh biên lai) → server trả lỗi:

```
POST /api/driver/me/trips/123/incidental-costs/batch
400  {"error":"Dòng 1: Phí có hóa đơn phải kèm số hóa đơn."}
```

**Vì sao đây là lỗi (không phải hành vi đúng).** `LIFTING` thuộc lớp **có hóa đơn** (`shared/src/constants/index.ts:251` → `{ code: 'LIFTING', invoiced: true }`), nhưng form **không** tự chọn và **không khóa** `Loại chứng từ` theo lớp danh mục. Ô chọn vẫn mở cả hai lựa chọn và mặc định là `Phiếu thu`. Ô "Số hóa đơn" chỉ hiện khi đổi sang `Hóa đơn`, nên ở trạng thái mặc định form **không hề gợi ý** rằng sẽ cần số hóa đơn.

Điểm này trái vụ đích `testplan/2026-10-14-driver-cost-ux-redesign.md` §DCUX-02:
> *"Pick 'Phí nâng' (catalog INVOICED): selector preselects and locks 'Hóa đơn'."*

**Tác động nghiệp vụ.** Đây là khoản chi phổ biến nhất của lái xe. Lái xe ngoài hiện trường chỉ có biên lai tay, không có hoá đơn VAT của nhà vận tải → bị chặn. Muốn lưu được buộc phải đổi sang `Hóa đơn` và nhập số hoá đơn. Lần lưu đầu tiên của mọi lái xe với khoản chi có hoá đơn đều thất bại.

**Đường vòng qua (xác minh hoạt động).** Đổi `Loại chứng từ` → `Hóa đơn`, nhập `Số hóa đơn` = `HD-TEST-001` → lưu thành công, dòng hiện `Phí nâng container · 120.000 ₫ · HĐ HD-TEST-001`. Vì vậy lỗi **có** đường vòng, nhưng form vẫn hỏng ở đường mặc định.

**Bằng chứng:**
- `A-01-form-mac-dinh.png` — form mặc định trước khi lưu
- `A-02-loi-phai-co-so-hoa-don.png` — dải lỗi đỏ ngay trên form (`Loại chi phí = Phí nâng`, `Loại chứng từ = Phiếu thu`)
- `A-04-error-evidence.json` — 400 response + DOM banner `.shipment-cost-entry__banner--error`
- `A8_invoice_escape_hatch.png` — lần lưu thành công sau khi đổi sang Hóa đơn

**Gợi ý (không thuộc phạm vi sửa):** truyền `invoiceClass` vào `ExpenseEvidenceFields` để chọn sẵn + khóa `Hóa đơn` cho hạng mục `invoiced`, và hiện "Số hóa đơn" luôn khi thuộc lớp có hoá đơn.

---

### 🟠 B-01 — P1: Không có tuỳ chọn "chọn toàn bộ số cont" khi khai chi phí OPS

**Mức:** Cao · **Khu vực:** B · **Vai trò:** OPS

**Mô tả.** Tại `/ops/orders` → **Khai chi phí**, trường **Số Cont** chỉ có:

```
Phí chung lô
MSDU1245780
TGBU3190086
```

Không có lựa chọn "tất cả container" / chọn nhiều cont một lượt. Lô 2 container buộc phải khai **hai dòng riêng biệt**.

**Vì sao đây là lỗi.** Tài liệu kế toán (mục Ops, `testplan/2026-10-14-cost-ux-accounting-five-features.md` §TC-COSTUX-02) yêu cầu rõ:
> *"Khi 1 Ops đã điền chi phí, **chọn toàn bộ số cont**, nếu có Ops khác nhập, hệ thống sẽ hiện cảnh báo"*

Cơ chế cảnh báo trùng (B-02) chỉ hoạt động khi bạn chọn **từng cont**, nghĩa là thiết kế hiện tại **không thể** thực hiện đúng luồng mà tài liệu mô tả. Nguyên nhân kỹ thuật: `opsContainerId()` ánh xạ `LOT → null` và chỉ nhận `shipmentContainerId` đơn lẻ.

**Bằng chứng:** `B1_ops_expense_modal_container_scope.png` — dropdown Số Cont chỉ 3 lựa chọn nêu trên (lô `DNKM13336`, 2 container).

---

### 🟠 C-01 — P1: Tự điền nhà cung cấp (NCC) không bao giờ chạy

**Mức:** Cao · **Khu vực:** C · **Vai trò:** ACCOUNTANT

**Mô tả.** Tại **Thêm khoản chi** → **Bên thực chi** = *Nhà cung cấp*, ô **Nhà cung cấp** luôn trống và hiện cảnh báo:

> "Chưa có nhà xe trên tuyến này — chọn thủ công."

Kiểm chứng trên **hai** lô có tuyến thật (`DNKM13336` → *Hải Phòng-NEWEB*; và lô E2E-BILL-001) — kết quả **giống hệt**.

**Nguyên nhân gốc.** `frontend/src/features/expense-accounting/ExpenseCreateDrawer.tsx:104-105`:

```ts
const carrier = catalog.carriers.find(item => item.routeName != null && work.shipmentCode != null
  && item.routeName.trim().toLocaleLowerCase('vi') === work.shipmentCode.trim().toLocaleLowerCase('vi'));
```

So khớp **`routeName` của nhà xe với `shipmentCode` của lô** — hai trường thuộc hai miền khác nhau. Đối chiếu dữ liệu thật trên staging (`GET /api/expense-accounting/catalog`):

```json
{"id":10,"name":"CÔNG TY TNHH DỊCH VỤ XNK VÀ VẬN TẢI ĐĂNG QUÂN","routeName":"KCN Quế Võ, Nam Sơn, Bắc Ninh"}
```

`routeName` chứa **địa điểm tuyến**, không bao giờ chứa mã lô (`SHP-2610-001xx` hay số Bill/Booking). Điều kiện so khớp vì vậy **không bao giờ đúng** — đây là code chết, không phải thiếu dữ liệu.

Lưu ý: `work` được khai báo là `Pick<ExpenseWorkRow, 'tripId' | 'shipmentId' | 'shipmentCode' | 'containerNumber'>` — **không có** `routeName`, nên không thể sửa bằng cách dùng lại dữ liệu sẵn có.

**Vì sao đây là lỗi.** Tài liệu yêu cầu:
> *"Nếu chọn 'Nhà cung cấp', hệ thống mặc định ghi nhận là tên nhà xe đang chạy tuyến đường đó"*

Tính năng không bao giờ chạy → mỗi dòng chi phí kêu nhà cung cấp đều phải chọn tay, tăng sai sót và làm chậm đối chiếu.

**Bằng chứng:** `C2_ncc_autofill.png`, `C2_ncc_autofill_ship175.png`, `C2_ncc_autofill_ship312.png` — cả ba đều trống + cảnh báo.

---

### 🟠 D-01 — P1: Module chấm công không có UI chế độ lương

**Mức:** Cao · **Khu vực:** D · **Vai trò:** ACCOUNTANT, DISPATCHER

**Mô tả.** Bảng chấm công tháng 10/2026 của lái xe Bùi Quang Hường **đã tồn tại** và có dữ liệu thật (`GET /api/timesheet/months`):

```json
{"id":1,"driverId":11,"salaryMode":"PER_TRIP","dailyBase":200000,"flatAmount":null,"status":"OPEN"}
```

Nhưng quét toàn văn bản của **cả hai** trang:

| Trang | Tìm thấy `PER_TRIP` / `FLAT_MONTHLY` / "Khoán chuyến" / "Lương cứng" / "Chế độ lương" |
|---|---|
| `/timesheet` (điều vận) | **0 kết quả** |
| `/timesheet/doi-chieu` (kế toán) | **0 kết quả** |

Không có nút tạo bảng chấm công, không có nút đổi chế độ lương. `createTimesheetMonth` và `updateTimesheetMode` tồn tại trong `frontend/src/api/timesheetClient.ts` nhưng **không component nào import**.

**Vì sao đây là lỗi.**
1. Lệch tài liệu thiết kế `docs/timesheet-design-2026-10-14.md` §6, mô tả cột "chế độ lương (read-only ở đây)" trên lưới.
2. Module **không dùng được từ đầu đến cuối**: nếu chưa có bảng chấm công, điều vận chỉ thấy dòng *"Lái xe này chưa có bảng chấm công tháng MM/YYYY. Kế toán mở bảng trước…"* mà **không có nút nào để kế toán mở bảng**. Chỉ tạo được bằng gọi API tay.
3. Kế toán nhìn thấy tổng lương (2.700.000 ₫) nhưng không biết con số đó đến từ công thức nào, và không đổi được chế độ khi chuyển sang lương cứng.

**Bằng chứng:** `D1_timesheet_grid.png`, `D4_timesheet_reconciliation.png`, `D5_deposit_tracker.png`, và log quét `salary-mode text hits: null` cho cả hai trang.

---

### 🟡 B-02 — P2: Cảnh báo cont trùng không phải modal xác nhận

**Mức:** Trung bình · **Khu vực:** B · **Vai trò:** OPS

**Mô tả.** Tính năng **có hoạt động** — kiểm chứng đầy đủ:

1. OPS `hoangnh` khai 500.000 ₫ (Phí công nhân) trên cont `MSDU1245780` → lưu thành công (201).
2. OPS `hungld` mở cùng lô, chọn `MSDU1245780`.
3. `GET /api/ops/expenses/cont-claimants` → `[{"containerId":145,"containerNumber":"MSDU1245780","paidByName":"Nguyễn Huy Hoàng"}]`
4. Hiện cảnh báo: *"Cont MSDU1245780 đã có Nguyễn Huy Hoàng nhập trước — bạn vẫn tiếp tục nhập chứ."*

Nhưng đây là **dải cảnh báo màu hổ phách nằm ngay trong modal đang mở** (`div.ops-modal__warning`, `role="alert"`), **không phải modal xác nhận riêng**. Đếm `document.querySelectorAll('[role=dialog]')` = **1** (chỉ modal "Khai báo chi phí"). Nút **Lưu** vẫn bật, không có bước **Hủy / Tiếp tục**.

**Vì sao đây là lỗi.** `TC-COSTUX-02` yêu cầu:
> *"hệ thống hiện modal xác nhận với tiêu đề đúng chữ: 'ĐÃ ĐƯỢC ID <tên> NHẬP TRƯỚC ĐÓ, BẠN VẪN TIẾP TỤC NHẬP CHỨ?' … 'Hủy' → không lưu … 'Tiếp tục' → cho lưu; đã ack thì không hỏi lại cùng bộ cont đó."*

Hiện tại không có "ack", nên mỗi lần chọn lại cùng cont đều phải đọc lại cảnh báo, và người dùng có thể lưu ngay mà không có bước xác nhận có chủ đích — đúng cái rủi ro trùng mà cảnh báo sinh ra để chặn.

**Bằng chứng:** `B5_dup_warning_second_ops.png` — dải cảnh báo nằm trong modal, không có modal chồng.

---

### 🟡 A-02 — P2: Tab "Tiền đường" vẫn có Ngày chi / Ghi chú / biên lai

**Mức:** Trung bình · **Khu vực:** A · **Vai trò:** DRIVER

**Mô tả.** Trong form khai chi phí, tab **Tiền đường** hiện các trường: `Loại chi phí`, `Tên khoản chi`, **`Thực chi (VND) *`**, **`Ngày chi *`**, **`Ghi chú khoản chi`**, **`Chụp / chọn biên lai`**.

`DCUX-04` yêu cầu: *"Driver road entry offers **ONLY** Loại chi phí + Thực chi (**no date, note, payer, photo, invoice controls**)."*

**Vì sao đây là lỗi.** Ba trường thừa (Ngày chi bắt buộc, Ghi chú, ảnh biên lai) làm form tiền đường nặng hơn và trái thiết kế. `Ngày chi` còn là **required**, tức lái xe bắt buộc nhập ngày cho một khoản mà hệ thống tự ghi nhận.

**Bằng chứng:** `A9_road_tab_fields.png` — trạng thái tab Tiền đường sau khi bấm "Thêm chi phí".

---

### ⚪ Lỗi mức thấp

| Mã | Mô tả | Bằng chứng |
|---|---|---|
| **C-02** | Ô "Cược Bill/Book" (`/accounting/phoi-phieu`): nhập `1234` không ra danh sách **và không có thông báo "không tìm thấy"** — giao diện im lặng. Ngược lại màn **hoàn cước** (`/accounting/deposit-tracker`) lại có thông báo rõ ràng, không nhất quán giữa hai nơi. | `C6_billsearch_1234.png` |
| **A-03** | Dòng tiền đường cũ hiển thị **"Chưa phân loại chứng từ"** (dữ liệu trước wave chưa có `evidenceKind`). Là hành vi có chủ đích theo schema nhưng gây nhiễu khi đọc bảng chi phí. | `A1_trip_detail_full.png` |
| **D-02** | Màn hoàn cước dùng nút **"Thêm dòng"**, tài liệu thiết kế §1.3 ghi **"Thêm cược"**. | `D5_deposit_tracker.png` |
| **D-03** | `/timesheet`, `/timesheet/doi-chieu`, `/accounting/deposit-tracker` không có trong `searchRegistry` → không tìm được qua ô tìm kiếm. | Log kiểm tra registry |

---

## 3. Các hạng mục ĐÃ kiểm chứng ĐẠT

Không phải mọi thứ trong đợt wave đều lỗi. Những mục sau đã chạy thật trên staging và đạt:

| Hạng mục | Bằng chứng thực thi |
|---|---|
| **A-01 ✅ Không còn cột "Người chi"** | Form lái xe không có control nào mang nhãn "Người chi" (dump toàn bộ input/select) |
| **A-02 ✅ Bộ chọn Hóa đơn / Phiếu thu** | Trường "Loại chứng từ" hiện đủ 2 lựa chọn; chọn `Hóa đơn` thì hiện Số + Ngày hoá đơn |
| **A-03 ✅ Ảnh biên lai bắt buộc khi chọn Phiếu thu** | Bấm Lưu khi chưa chụp → **không gửi request** nào, form chặn đúng với dòng nhắc *"Chọn Phiếu thu thì phải chụp biên lai trước khi lưu."* |
| **A-05 ✅ Nhập liên tục nhiều dòng** | Có `+ Thêm dòng`, `Khoản N`, `Xóa dòng`, `Lưu N khoản chi`; lưu 1 lần cho 1 dòng |
| **B-03 ✅ Phê duyệt tạm ứng chạy trọn vẹn** | OPS xin 250.000 ₫ → kế toán thấy trong tab "Tạm ứng chờ duyệt" → `POST /api/advance-requests/16/approve` → hàng biến mất khỏi hàng đợi, hiện *"Chưa có yêu cầu tạm ứng nào chờ phê duyệt."* |
| **B-04 ✅ Số dư âm hiển thị đúng** | Sổ quỹ: `Số dư cuối sổ: -960.000 ₫` · `Còn phải hoàn ứng (theo kế toán): 1.050.000 ₫` · `Chưa khớp — cần đối chiếu với kế toán` |
| **C-03 ✅ Chốt debit** | `/accounting/chot-debit` render đủ: `Xác nhận đối soát (139)`, `Chọn Debit (0 dòng)`, `Chọn tất cả 30 lô đủ điều kiện`, `Đối soát`, `Hoàn táo`; 0 lỗi console/mạng |
| **C-04 ✅ Tìm Bill/Book trên phơi phiếu** | Nhập `99` → gọi `/api/shipments/bill-book-search` (200) → trả gợi ý `SEAB-2609-778899 · CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH` |
| **D-04 ✅ Ký hiệu K/Q/Đ/L/N/P** | Legend đầy đủ nhãn: *K Kẹp 2 cont (1 chuyến) · Q Quay đầu (2 chuyến) · Đ Chạy đơn (1 chuyến) · L Lưu ca (0 chuyến) · N Nghỉ (0 chuyến) · P Nghỉ phép (xe hư) (0 chuyến)* |
| **D-05 ✅ Gõ ký hiệu + lưu lưới** | Gõ `k` → ô nhận `K`, **tự nhảy sang ô kế tiếp** (`Ngày 2026-10-02`); `Lưu lưới` → `PUT /api/timesheet/months/1/days`, 0 lỗi |
| **D-06 ✅ Quy tắc Chủ nhật** | `aria-label` ô Chủ nhật hiện *"Ngày 2026-10-11 — Chạy đơn (Chủ nhật)"* — ghi chuyến nhưng không tính ngày công |
| **D-07 ✅ Tra cứu Bill 4 số ở hoàn cước** | `7788` → `/api/accounting/deposits/bill-suggestions` (200); gõ thêm số thứ 5 bị chặn (giá trị giữ nguyên `7788`); khi rỗng hiện đúng *"Không có lô hàng nào kết thúc bằng 7788. Nhập tay bên dưới."* |

---

## 4. Bảng phủ mức kiểm thử (rung 0–3)

Theo AGENTS.md §9.

| Claim / bug | Rung | Bằng chứng | Chưa phủ |
|---|---|---|---|
| A-01 Dòng mặc định lỗi 400 | **UI DRIVEN** | `A-01-form-mac-dinh.png`, `A-02-loi-phai-co-so-hoa-don.png`, `A-04-error-evidence.json` | Chưa thử trên app lái xe offline |
| A-01 Lối vòng bằng Hóa đơn | **UI DRIVEN** | `A8_invoice_escape_hatch.png` | — |
| B-01 Thiếu chọn toàn bộ cont | **UI DRIVEN** | `B1_ops_expense_modal_container_scope.png` | Chỉ thử lô 2 container; lô ≥3 cont chưa thử |
| B-02 Cảnh báo trùng không phải modal | **UI DRIVEN** | `B5_dup_warning_second_ops.png` + payload `cont-claimants` | Chưa thử trường hợp khoản đã VOID (kỳ vọng không cảnh báo) |
| B-03 Phê duyệt tạm ứng | **UI DRIVEN** | `B8_ops_advance_request.png`, `B9_ops_advance_filled.png`, `B6_pending_advances_queue.png`, `B12_after_approve_mine.png` | Chưa thử nhánh **Từ chối** + bắt buộc lý do |
| B-04 Số dư âm | **UI DRIVEN** | `B7_ops_wallet.png`, `B8_ops_wallet_full.png` | **Chưa** thực hiện giao dịch hoàn ứng thật — xem mục 5 |
| C-01 NCC autofill không chạy | **UI DRIVEN + đọc code** | `C2_ncc_autofill*.png` ×3, `ExpenseCreateDrawer.tsx:104-105`, payload catalog | — |
| C-03 Chốt debit | **UI DRIVEN** | `C3_chot_debit.png` | Chưa bấm `Chốt` (sẽ ghi sổ) |
| C-04 Tìm Bill/Book | **UI DRIVEN** | `C6_billsearch_99.png`, `C6_billsearch_1234.png` | — |
| D-01 Không có UI chế độ lương | **UI DRIVEN + đọc code** | `D1_timesheet_grid.png`, `D4_timesheet_reconciliation.png`, log quét văn bản | — |
| D-05 Gõ ký hiệu + lưu | **UI DRIVEN** | `D2_timesheet_symbol_entry.png`, `D3_timesheet_saved.png` | Chưa thử đối chiếu/mở lại (409 khi sửa bảng đã seal) |
| D-07 Tra cứu Bill 4 số | **UI DRIVEN** | `D6_bill_lookup.png`, `D7_bill_lookup_5digit.png` | — |

---

## 5. Phần CHƯA phủ (giới hạn thật)

1. **Hai dòng hệ thống chỉ đọc của "Tiền đường"** (`Tiền đường` = `total_road_allowance` và `Nâng/Hạ Lạch Huyện`) — **không kiểm chứng được**. Mọi chuyến của cả 4 lái xe trên staging đều có `totalRoadAllowance = "0"`, nên không có chuyến nào để mở. Đây là hạng mục DCUX-04, **trạng thái: CHƯA KIỂM CHỨNG** (không phải đạt, cũng không phải lỗi).
2. **Nút "Thu hoàn ứng" / drawer hoàn ứng** — **không tìm thấy** ở `/ops/wallet`, `/accounting/hoan-ung`, `/advances?view=settlements`. Chỉ thấy số dư âm và danh sách phiếu. Chưa xác định được điều kiện hiển thị nút, nên **luồng ghi hoàn ứng chưa kiểm chứng**.
3. **Phản hồi lỗi rỗng** (bill search không có kết quả, `C-02`) — chỉ kiểm chứng ở `/accounting/phoi-phieu`; chưa thử ở `Chi tiết chi hộ`.
4. **Responsive 390/768/1440** — chưa chạy trong đợt này (chạy 1440×900).
5. **Các vai trò khác** (ADMIN, CUS, MANAGER) — không thuộc phạm vi yêu cầu.

---

## 6. Dữ liệu QA đã ghi trên staging (cần biết)

Báo cáo này **đã tạo dữ liệu thật** trên staging. Liệt kê để người khác không nhầm là dữ liệu thật của khách hàng:

| Loại | Nội dung |
|---|---|
| Chi phí OPS | `DNKM13336` / cont `MSDU1245780` — *Phí công nhân* 500.000 ₫, ghi chú *"QA dupe test 1"* (OPS `hoangnh`) |
| Yêu cầu tạm ứng | 250.000 ₫ — *"QA 20261015 cost-doc wave — kiem thu Phe duyet tam ung"* (id 16, **đã phê duyệt**) |
| Chi phí lái xe | Chuyến `E2E-BILL-001` — *Phí nâng* 120.000 ₫, `HĐ HD-TEST-001` (lái xe `bqhuong`) |
| Chấm công | Lái xe Bùi Quang Hường, ngày 01/10/2026 ghi ký hiệu `K` |

> ⚠️ **Cần lưu ý — kết quả ngoài dự kiến.** Trong lúc chọn đúng hàng "của tôi" trong hàng đợi phê duyệt, script của tôi đã nhấn nhầm nút **Phê duyệt** của hàng ngay phía trên. Kết quả: yêu cầu tạm ứng **id 15 — 300.000 ₫ — *"QA 20261015 — kiểm thử TỪ CHỐI tạm ứng (sẽ bị từ chối)"*** (của bộ phận QA khác) đã bị chuyển từ `PENDING` sang `RECORDED`. **Đây là dữ liệu kiểm thử, không phải dữ liệu khách hàng**, nhưng nếu bộ phận QA kia còn cần hàng đó ở trạng thái chờ duyệt thì cần tạo lại. Lỗi nằm ở script chọn phạm vi của tôi, không phải lỗi ứng dụng — sau đó tôi đã sửa cách chọn và phê duyệt đúng hàng của mình (id 16) thành công.

Ngoài ra, **một bộ phận QA khác đang song song thao tác trên staging** trong cùng khung giờ (thấy các mục *"QA 20261015 — kiểm thử PHÊ DUYỆT TẠM ỨNG"* và *"kiểm thử TỪ CHỐI tạm ứng"*). Số liệu trong báo cáo này chụp tại các thời điểm khác nhau trong ngày.

---

## 7. Phương pháp và tái lập

- **Trình duyệt:** Playwright Chromium (bản global), viewport 1440×900, session chèn JWT vào `localStorage` trước khi điều hướng.
- **Vì sao không dùng `node`:** `fetch` của Node v25 không ổn định với TLS của vantai (`fetch failed` xen kẽ, trong khi `GET /api/health` lại thành công). Toàn bộ driver chạy bằng **Bun 1.3.14**.
- **Kịch bản** trong thư mục này (chạy lại: `bun <file>` từ repo root):

| File | Phạm vi |
|---|---|
| `qa-lib.mjs` | Thư viện dùng chung: login, session, chụp màn hình, đọc DOM |
| `A-driver.mjs`, `A-driver2.mjs`, `A-driver3.mjs` | Khu vực A — form chi phí lái xe |
| `A-save.mjs`, `A-save-evidence.mjs`, `A-error-shot.mjs` | Khu vực A — chứng minh lỗi A-01 |
| `B-ops.mjs`, `B-dup.mjs`, `B-advance.mjs`, `B-approve.mjs` | Khu vực B |
| `C-accounting.mjs`, `C-chotdebit.mjs` | Khu vực C |
| `D-timesheet.mjs`, `D-recon.mjs` | Khu vực D |
| `probe-login.mjs` | Xác minh buildHash + đăng nhập 4 vai trò |

Tài khoản dùng lấy từ `testplan/testaccounts.txt` (chỉ staging, mật khẩu chung theo quy ước repo).

---

## 8. Đề xuất thứ tự xử lý

1. **A-01** — ảnh hưởng trực tiếp lái xe ngoài hiện trường, mỗi lần lưu đều thất bại ở đường mặc định.
2. **C-01** — sửa một dòng điều kiện (`routeName` vs `route`) để tính năng thật sự chạy.
3. **B-01 + B-02** — hai lỗi cùng luồng "khai chi phí nhiều cont"; nên xử lý chung với tài liệu Ops.
4. **D-01** — cần quyết định của owner: có bổ sung UI chế độ lương, hay sửa tài liệu để bỏ yêu cầu.
5. **A-02** và các lỗi P3 — theo nhóm.