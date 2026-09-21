# QA — Màn hình Ops + Phương án tính cước tự động (Kanban TODO docx) — 2026-09-20

Nguồn đặc tả:
- `2026.9.6_Man_hinh_ops.docx` (TODO) — MÀN HÌNH 1 `/ops/orders`, MÀN HÌNH 2 `/ops/fleet-tracking`, MÀN HÌNH 3 `/ops/wallet`.
- `Phương án tính cước tự động.docx` (TODO) — công thức cước, 4 nhóm tham số động, khóa cước tại Ngày vận chuyển, nhập đè trên bảng kê.

Môi trường: local dev (frontend `http://localhost:7175`, API `http://localhost:3002`), DB `silversea` (dev seed). Tài khoản theo `testplan/testaccounts.txt` (mật khẩu `Abc123`); trên local dùng `giaonhan` (OPS), `qaops2` (OPS thứ hai, tạo trong phiên QA), `ketoan` (ACCOUNTANT), `admin`, `cus`, `dieuvan` (DISPATCHER), `laixe` (DRIVER).

Bằng chứng phiên chạy: `qa/2026-09-20_ops-pricing-docx-qa/` (ảnh + `facts.json`), driver `qa/scripts/local-ops-pricing-docx-20260920.mjs`.

> Quy ước rung (AGENTS.md): **UI DRIVEN** = đã bấm trong browser thật và đọc DOM/DB sau khi bấm; **DB/API VERIFIED** = chỉ gọi API/DB, chưa bấm UI.

---

## 1. Ca đã chạy — kết quả

| Mã ca | Đặc tả | Rung | Kết quả | Bằng chứng |
|---|---|---|---|---|
| TC-OPS-DOCX-01 | Ops xem kế hoạch toàn công ty theo ngày; đổi ngày; tìm theo số container | UI DRIVEN | PASS | `01-ops-orders-today.png` (1 lô 20/9), `facts.json.steps[ops-orders-today]`; tìm `QATU1234569` → 1 lô, `ZZZ-NOPE` → 0 lô |
| TC-OPS-DOCX-02 | Ghim lệnh là sổ tay cá nhân: ghim → F5 giữ; Ops khác không thấy ghim | UI DRIVEN + API | PASS | nút đổi thành `Bỏ ghim SHP-2609-00020` sau F5; `GET /ops/orders?date=2026-09-20` với `qaops2` → `pinned:false` |
| TC-OPS-DOCX-03 | Khai báo chi phí: Số Bill/Cont tự điền; chọn loại phí; lưu → quỹ | UI DRIVEN | PASS (sau khi có phân công lô) | `02-ops-expense-out-of-scope-403.png`, POST `/api/ops/expenses` 201, khoản `id=2` 250.000đ nhóm `OPS_INCIDENTAL` |
| TC-OPS-DOCX-04 | Quỹ: số dư/đã ứng/đã trả lại/chi phí đã ghi; nhật ký + Smart Tag nợ chứng từ | UI DRIVEN | PASS | `03-ops-wallet-cards-history.png`, `facts.json.api.opsWallet` (16.000.000 − 400.000 = 15.600.000) |
| TC-OPS-DOCX-05 | Xin tạm ứng: lưu → `RECORDED`, số dư KHÔNG tăng tới khi có tiền thực giao | UI DRIVEN + API | PASS | POST 201 `status=RECORDED`, số dư giữ 15.850.000 tại thời điểm đó |
| TC-OPS-DOCX-06 | Phiếu quyết toán: gom theo lô, 2 rổ có/không hóa đơn, xuất XLSX | UI DRIVEN + API | PASS | `04-ops-settlement-sheet.png` (`OS-2609-0001`, “Có HĐ: 0 · Không HĐ: 150.000”); export 200 `application/vnd...sheet`, 7.166 bytes |
| TC-OPS-DOCX-07 | Theo dõi xe: chỉ xem, tự cập nhật; chuyến của xe được giao tự hiện; trạng thái theo thao tác lái xe | UI DRIVEN | PASS | `05-ops-fleet-tracking-live.png` (`15E-016.26 · TRP-202609-0001 · Đang vận chuyển (đã nhận lệnh)`), `06-driver-order-accepted.png` |
| TC-CUOC-DOCX-01 | Công thức cước + phụ phí dầu theo kỳ giá | DB/API VERIFIED | PASS | `facts.json.api.freightPreview`: 3.978.000 + 813.480 = 4.791.480, `billedKm 260`, `liters 83.2`, `fuelDelta 9.777,4074` |
| TC-CUOC-DOCX-02 | Ngưỡng kích hoạt: vượt ngưỡng mới đổi kỳ giá dầu (ratchet) | DB/API VERIFIED | PASS | Kỳ mới 28.000 (19/9) so kỳ trước 27.620 = +1,38% < ngưỡng 5% ⇒ engine vẫn dùng kỳ `id=2` |
| TC-CUOC-DOCX-03 | Cấu hình chỉ 1 dạng ngưỡng (%) HOẶC tuyệt đối | DB/API VERIFIED | PASS | `thresholdXor` → 400 “Chỉ chọn một dạng ngưỡng…” |
| TC-CUOC-DOCX-04 | Nhập kỳ giá dầu mới: 201; trùng `effective_from` 409; DRIVER 403 | DB/API VERIFIED | PASS (trừ `created_by`) | `201` id=5; trùng → 409; DRIVER → 403 |
| TC-CUOC-DOCX-05 | Nhập đè giá cuối trên bảng kê: bắt buộc lý do; OPS không có quyền; giữ giá hợp đồng | DB/API VERIFIED | PASS | lý do rỗng → 400; OPS → 403; ACCOUNTANT → 200 (`systemCalculatedFreight 4.791.480`, `finalDebitFreight 4.500.000`) |
| TC-CUOC-DOCX-06 | Cước đã khóa không hồi tố khi mở kỳ giá mới | DB/API VERIFIED | PASS | `GET /pricing/snapshots/5` vẫn 4.791.480 + override, dù kỳ 28.000 đã mở |
| TC-CUOC-DOCX-07 | Cấu hình UI: “Giá dầu theo kỳ”, “Điều khoản cước theo tuyến” (lag, ngưỡng, % chia sẻ) | UI DRIVEN | PASS | `09-config-fuel-price-periods.png`, `10-config-freight-rate-terms.png` |

### Khác biệt đặc tả ↔ sản phẩm hiện hành (không phải lỗi)

- docx MÀN HÌNH 3 mô tả 4 thẻ `Số dư hiện tại / Đã duyệt / Chờ duyệt / Bị từ chối` và luồng Kế toán duyệt/từ chối. Sản phẩm hiện hành không còn luồng phê duyệt (`2026-09-17-no-approval-workflows.md`); ví hiển thị `SỐ DƯ HIỆN TẠI / Đã trả lại / Chi phí đã ghi nhận`. Giữ theo PRD hiện hành.
- docx §2 nói tham số động “theo từng khách hàng”; sản phẩm hiện hành gắn tham số theo **khách × tuyến** (`freight_rate_terms`: lag, ngưỡng, % chia sẻ) — khớp `testplan/flows/12-cuocphi-phuphi-dau.md`.

---

## 2. Ca lỗi (regression) — phải re-run sau khi sửa

### TC-OPS-BUG-01 — Ops không ghi được chi phí vì thiếu phân công lô (P0)

- **Repro:** đăng nhập `giaonhan` → `/ops/orders` → chọn lô bất kỳ **không** nằm trong danh sách phân công của user → `[Khai chi phí]` → chọn loại phí + số tiền → `[Lưu]`.
- **Hiện tại:** `POST /api/ops/expenses` → **403** `Bạn không còn được phân công lô hàng này.`; form giữ nguyên, toast đỏ. Bảng `user_shipment_links` chỉ được ghi bởi form người dùng (admin) và seed — không có đường nào sinh phân công từ điều vận/gán xe; dev seed để `giaonhan` có 0 dòng ⇒ **mọi** lô đều 403 dù UI hiện nút trên từng dòng.
- **Kỳ vọng:** nút chỉ hiện/hoạt động cho lô thuộc phạm vi, hoặc phân công lô phải được sinh từ luồng điều vận/gán xe; lưu thành công → khoản chi vào quỹ (đã xác nhận 201 sau khi admin gán lô).
- **Bằng chứng:** `02-ops-expense-out-of-scope-403.png`, `facts.json.steps[ops-expense-out-of-scope-403]`.

### TC-CUOC-BUG-01 — Lô FCL tạo từ màn CUS không bao giờ khóa cước (P0)

- **Repro:** `cus` tạo lô FCL có tuyến trên container + ngày giờ đóng trả → `dieuvan` phân bổ nhà xe + gán xe → `[Phát lệnh]`.
- **Hiện tại:** `shipments.route_id` = `null` với mọi lô FCL tạo từ UI (model tạo chỉ gửi `routeId` cho LCL); `lockShipmentFreightRate()` thoát sớm khi `shipment.routeId == null` ⇒ không có dòng `freight_rate_snapshots` ở bước tạo, ở bước sửa container, và ở bước phát lệnh. Chỉ sau khi set `route_id` **và** đổi Ngày giao dự kiến mới sinh snapshot (`snapshotCount 0 → 1`).
- **Kỳ vọng:** lô FCL có tuyến (trên container) + Ngày vận chuyển phải khóa cước ngay (docx §3, `TC-CUOC-009`).
- **Bằng chứng:** `facts.json.api.shipment298` (`snapshotCount` sau chuỗi thao tác), log API `PATCH .../plan`, `POST /shipments/298/dispatch` 201.

### TC-CUOC-BUG-02 — L1 “CƯỚC VẬN TẢI (AUTO)” cộng dồn mọi snapshot (P0, tiền)

- **Repro:** lô có ≥ 2 dòng `freight_rate_snapshots` (ví dụ khóa lúc nhập + khóa lại khi phát lệnh), mở `/shipments-debit` → chọn khách → đọc cột `CƯỚC VẬN TẢI (AUTO)`.
- **Hiện tại:** `shipment-debit-summary.service.ts` dùng `sum(freight_rate_snapshots.total_amount)` theo lô ⇒ 3 snapshot × 4.791.480 = **14.374.440** trong khi Lớp 2/Bảng 2.1 hiển thị đúng **4.791.480**; `receivableTotal` = 14.624.440 (đã cộng thêm 250.000 chi phí Ops).
- **Kỳ vọng:** mỗi container/chuyến chỉ lấy **bản chốt mới nhất** (supersede = INSERT, không cộng lịch sử).
- **Bằng chứng:** `07-debit-l1-list.png`, `facts.json.api.debitSummary` + `debitDetail`.

### TC-CUOC-BUG-03 — Bảng 2.3 “Phí HQGS / Phí Phát sinh” hard-code “Chưa xác định” (P0)

- **Repro:** Ops ghi khoản “Phí phục vụ kiểm hóa / Ship Lạch Huyện” (250.000đ) cho lô → mở Lớp 2 của lô ở `/shipments-debit`.
- **Hiện tại:** `PayablesTable` render cứng `Chưa xác định` cho `Cước trả / Phí HQGS / Phí Phát sinh / Ghi chú`, dù API đã trả `payables.hqgsFee = 250000`, `opsExpenseTotal = 250000`.
- **Kỳ vọng:** Bảng 2.3 hiển thị đúng số Ops/điều vận đã nhập (`TC-DN-18-04`).
- **Bằng chứng:** `08-debit-l2-tables.png`, `facts.json.api.debitDetail.payables`.

### TC-CUOC-BUG-04 — “TỔNG PHẢI THU KHÁCH” cộng chi phí Ops dù số thu khách = 0 (P0, tiền)

- **Repro:** lô có khoản Ops không hóa đơn, `customer_charge_amount = 0` (nhóm `OPS_INCIDENTAL`, loại phí category `HQGS`) → xem Lớp 1.
- **Hiện tại:** `receivableValue` cộng `hqgsByLot` (tổng `ops_expense_entries.amount` theo loại phí `category='HQGS'`) bất kể số thu khách ⇒ 4.791.480 + 250.000 (và ×3 do BUG-02).
- **Kỳ vọng:** debit khách dùng **số thu khách** (mặc định 0 với khoản Ops không hóa đơn) — PRD `AC-CP-OPS-02/03`.
- **Bằng chứng:** `07-debit-l1-list.png`, `facts.json.api.debitSummary.receivableTotal`, `expenseAccounting[].customerChargeAmount = 0`.

### TC-CUOC-BUG-05 — Kỳ giá dầu nhập mới không lưu người nhập (P2, truy vết)

- **Repro:** `ketoan` `POST /api/config/fuel-price-periods` → đọc bản ghi.
- **Hiện tại:** 201 nhưng `created_by = null` (và `GET /fuel-price-periods` trả `createdBy: null`) ⇒ không truy vết được ai nhập giá dầu.
- **Kỳ vọng:** `created_by = ACCOUNTANT.id` (`TC-CUOC-020`).
- **Bằng chứng:** `facts.json.api.fuelDuplicate` (đối chứng 409) + bản ghi `id=5` trong `fuel_price_periods`.

### TC-OPS-BUG-02 — Nút ghim mất định danh khi lô chưa có mã lô (P2, a11y)

- **Repro:** mở `/ops/orders` ở ngày có lô `shipment_code = null` (phần lớn lô bulk) → đọc `aria-label` nút ghim.
- **Hiện tại:** `aria-label = "Ghim "` (thiếu mã lô) ⇒ trình đọc màn hình không phân biệt được dòng nào.
- **Kỳ vọng:** nhãn kèm định danh lô (Bill/Booking khi chưa có mã lô).
- **Bằng chứng:** DOM dump nút `.ops-pin` (xem RUN-SUMMARY mục “DOM dumps”).

### TC-QA-ENV-01 — Hợp đồng môi trường QA lệch giữa tài liệu và checkout (P2)

- **Repro:** theo `AGENTS.md`/`testaccounts.txt` mở `http://localhost:7174` và API `:3001` trên checkout này.
- **Hiện tại:** cổng thật là frontend `:7175`, backend `:3002` (`Makefile`); mục `local.users` trong `testaccounts.txt` liệt kê user của bản `make stgdb` (`thanhdc`, `hoangnh`, `dungnv`…) không tồn tại trong DB dev-seed (13 user demo) ⇒ harness `env.mjs` tự chọn user sai và fail login cho tới khi QA đặt `QA_USER_*`.
- **Kỳ vọng:** một nguồn sự thật cho cổng local; `testaccounts.txt` tách rõ dev-seed ↔ prod-mirror (hoặc `env.mjs` fallback `demoUsers`); `node testplan/qa/scripts/smoke.mjs` PASS trên local dev-seed không cần biến thủ công.
- **Bằng chứng:** `curl :7174` → 000 / `:7175` → 200; `:3002/api/health` → `{"status":"ok","buildHash":"dev"}`; `select username, role from users` → 13 dòng demo.

---

## 3. Phạm vi chưa chạy

- Mobile 390px / tablet 820px cho cả ba màn Ops (chỉ chạy 1440×900).
- Vai trò `DRIVER` khác và `MANAGER`; luồng CUS↔Kế toán trên **staging** (toàn bộ phiên này chạy local dev).
- Luồng ảnh biên lai (upload/nén/xem ảnh) và đối chiếu kế toán trực tiếp (`/expenses` board).
- Parity 48/48 với file Excel `18.7 - BG Long Minh T7.xlsx` (file gốc không có trong đầu vào).
- Ghi chú môi trường: dev seed chỉ có rơ-moóc 40FT ⇒ không có tổ hợp xe kéo được cont 20' cho tới khi QA thêm rơ-moóc 20FT cho xe `15E-016.26`; xe `60C-12345` còn vướng chuyến seed `BULK-TR-0011` (đã đóng trong phiên QA để chạy tiếp luồng lái xe).
