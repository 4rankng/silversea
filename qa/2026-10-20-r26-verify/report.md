# QA R26 re-drive trên staging d39ee741 — FB-014 (primary) + spot FB-113/FB-093

- **Ngày**: 2026-10-20 · **Base**: https://vantai.tingting.vip · **Rung**: UI DRIVEN (§9 rung 3) cho TỪNG check dưới đây.
- **Build gate (chạy trước mọi drive)**: `GET /api/health` → `{"status":"ok","buildHash":"d39ee741"}` ✅ khớp d39ee741 → mới drive. Log: `fb014-ui-driver.log` / `fb113-ui-driver.log` / `fb093-ui-driver.log` (entry `build_gate`).
- **Role drive**: dieuvan (DISPATCHER) · cus (CUS) · ketoan (ACCOUNTANT) — login qua `POST /api/auth/login {identifier,password}`, token pre-inject localStorage (`evaluateOnNewDocument`) trước lần navigate đầu.
- **Driver**: `fb014-ui-driver.mjs`, `fb113-ui-driver.mjs`, `fb093-ui-driver.mjs`, recon `recon-lots.mjs` (chạy lại bằng đúng code sẽ commit để log/ảnh khớp script). Password staging đọc lúc runtime qua `creds.mjs` từ `testplan/testaccounts.txt` — không nhúng account trong artifact (luật repo). QA-ONLY: **không sửa source, không ghi data** (editor bấm Hủy, dialog bấm Hủy — không Lưu, không ghép).
- Mọi PNG có stamp URL + build + clock ở góc trên trái (headless không có browser chrome, stamp thay cho ảnh URL bar).

## 1. FB-014 (PRIMARY — fix 37838c06) — **PASS 3/3**

### 1a. Lô TRONG tháng topbar — **PASS**
- Trước: `https://vantai.tingting.vip/dispatch` → screenshot `fb014-01-inmonth-before.png`.
- Click **row body** (ô KHÁCH HÀNG & LỘ TRÌNH, không nút; hit-test `DIV.master-plan-grid__line--strong`, row class `master-plan-grid__row master-plan-grid__row--detail-link`, tabIndex 0) của lô **Bill R15B3-FCL-01 / SHP-2610-00132**.
- Sau: **`/dispatch-detail?q=R15B3-FCL-01&date=2026-10-12`** → screenshot `fb014-01-inmonth-after-row-click.png`, DOM `fb014-01-inmonth-dom.txt`.
- Bảng **"Kế hoạch Chi tiết Xe"** (`h1.detailed-plan-header__title`) populated: **2 dòng** `tbody tr` (dòng 1: `08:00 12/10/2026 … Bill: R15B3-FCL-01 … 15H-118.47 … Đã điều xe`) — không trắng.
- Scope ngày seed đúng: 6 segment của `[aria-label="Khoảng ngày vận chuyển"]` = `12/10/2026` (Từ = Đến = ngày lô); quick search `input[aria-label="Tìm nhanh"]` = `R15B3-FCL-01`.
- Wire: `GET /api/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=R15B3-FCL-01&date=2026-10-12`.

### 1b. Lô NGOÀI tháng topbar — **PASS** (đây là mấu chốt `date` thắng month bounds)
- Trước: `https://vantai.tingting.vip/dispatch` → `fb014-02-outmonth-before.png`.
- Click row body lô **Bill JJCTCHPDY260305 / SHP-2609-00004**.
- Sau: **`/dispatch-detail?q=JJCTCHPDY260305&date=2026-09-07`** → `fb014-02-outmonth-after-row-click.png`, `fb014-02-outmonth-dom.txt`.
- Bảng "Kế hoạch Chi tiết Xe" populated **2 dòng** (08:00 và 11:22 `07/09/2026`, Bill JJCTCHPDY260305, cont TWCU8170772 / UETU5787415, VÂN LAN 15C-123456).
- Topbar vẫn đọc **`Tháng 10/2026 · 01/10 – 31/10`** trong khi scope filter đọc **`Từ 07/09/2026 → Đến 07/09/2026`** → `date` deep-link đã thay month bounds, lô tháng 9 không bị loại.
- Wire: `…/dispatch-detail-plan-rows?page=1&limit=50&q=JJCTCHPDY260305&date=2026-09-07`.

### 1c. Quick-view giữ nguyên trên trigger riêng — **PASS**
- Từ `/dispatch`, click `.master-plan-grid__container-detail-trigger` (aria-label `Xem chi tiết container của R27E2E-001`) → drawer `.dispatch-container-detail-drawer` mở, title **"Chi tiết container"** (`R27E2E-001 · LONG MINH · 1 cont`), **URL vẫn `/dispatch`** → `fb014-03-quickview-drawer.png`.
- Không có `pageerror` nào trong cả 3 bước (`consoleErrors: []`).

## 2. FB-113 spot-check (verdict ba9981c2) — **PASS 2/2**

### 2a. Header `/shipments/:id` — **PASS**
- **`https://vantai.tingting.vip/shipments/176`** (cus → nav "Tổng quan lô hàng", H1 = `DNKM13337`) → `fb113-01-header-shipments-id.png`, `fb113-01-header-dom.txt`.
- Card `.shipment-detail__header` / `.shipment-detail__fields` có **`<dt>Số tờ khai</dt>` = `102250318903`** (đúng số trong API `declarations[0]`).
- Thứ tự trong card (DOM order, đã assert index): `Khách hàng → Số Bill / Số Booking (DNKM13337) → Số tờ khai (102250318903) → Xuất / Nhập (Xuất) → Hãng tàu (ONE) → …` ✅.

### 2b. Ledger 4 cột chứng từ + nút Sửa inline — **PASS**
- **`https://vantai.tingting.vip/shipments-detail?dateScope=all&searchSuffix=DNKM13337`** (cùng tên nav **"Chi tiết lô hàng"**; page KHÔNG render ledger — xem mục "Ghi chú surface") → `fb113-02-ledger-4-columns.png`, `fb113-02-ledger-dom.txt`.
- Cột `td[data-label]` của dòng container MAGU2468720 theo đúng thứ tự: **`Bill/Booking` (DNKM13337) → `Số tờ khai` (102250318903) → `Nhập/Xuất` (XUẤT) → `Hãng tàu` (ONE)** → các cột còn lại (`Thông số container`, `Nâng / hạ`, `Lịch trình`, `Phân xe`, `Trạng thái`).
- **Nút Sửa inline** nằm trong ô `Số tờ khai`: button `aria-label="Sửa tờ khai container MAGU2468720"` (text `Sửa`) — không mở, chỉ xác nhận hiện diện.

## 3. FB-093 spot-check (fix 3651d0d0, cards 191026100833 a/b) — **PASS 2/2**

### 3a. Badge "Báo khách (Ảo)" là button → mở panel sửa BKS — **PASS**
- **`https://vantai.tingting.vip/accounting/chot-debit`** (ketoan), search `GAP-TEST` → 3 dòng (`GAP-TEST-01/02/03`, kỳ `2026-10-01 – 2026-10-20`).
- Bước thực tế phải làm trước: bảng mở theo bộ cột ESSENTIAL nên cột **Phân xe** đang ẩn (trigger `button[aria-label="Cột hiển thị, đang ẩn 12 cột"]` → panel `[role="dialog"][aria-label="Cột hiển thị"]` → tick `Phân xe`) → badge xuất hiện. Ảnh: `fb093-01-board-bks-and-merge-button.png`.
- Badge **là `<button type="button">`** (không còn `<span>`): `aria-label="Sửa BKS báo khách: 15C-99999"`, `title="Sửa BKS báo khách"`, text `Báo khách (Ảo): 15C-99999`; dòng còn ghi `— · Thực: 15C-11111` (BKS Ảo ≠ BKS thực).
- Click (hit-test `BUTTON.debit-billing-badge`) → panel **`section[aria-label="Sửa BKS báo khách — GAP-TEST-01"]`** mở, input **seeded `15C-99999`**, có `Lưu BKS báo khách` + `Hủy BKS báo khách`, badge chuyển `aria-expanded="true"` → `fb093-02-bks-editor-panel.png`.
- Đóng bằng **Hủy** (không Lưu) → panel đóng, không có request ghi.

### 3b. Nút "Ghép cước thu khách" hiện và mở được dialog — **PASS**
- Nút `Ghép cước thu khách` có mặt trên FilterBar actions; mặc định `aria-disabled="true"` kèm lý do `Chọn ít nhất 2 lô lẻ chưa ghép cước để ghép.`
- Chọn 2 dòng bằng click row body: `GAP-TEST-01` + `GAP-TEST-03` (cùng LONG MINH, chưa ghép) → strip `Đã chọn 2 lô`, `tr[data-selected]` = 2, nút mất `aria-disabled`.
- Click → dialog `[role="dialog"]` **"Ghép cước thu khách"** mở với subtitle `2 lô lẻ · Lô 1 giữ 100% CƯỚC VẬN TẢI (Auto), các lô còn lại 0₫`, list `Lô 1 · GAP-TEST-01 — LONG MINH` / `Lô 2 · GAP-TEST-03 — LONG MINH`, `Loại xe tính cước thu khách`, `BKS báo khách (ảo) chung nhóm` → `fb093-03-merge-dialog.png`.
- Đóng bằng **Hủy** (không ghép) → dialog đóng.

## Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| FB-014 row-click → /dispatch-detail, q+date seed, board populated (lô trong tháng) | UI DRIVEN | `fb014-01-inmonth-{before,after-row-click}.png`, `fb014-01-inmonth-dom.txt`, `fb014-ui-driver.log`, wire `…q=R15B3-FCL-01&date=2026-10-12` | keyboard Enter/Space trên row; ADMIN/MANAGER; viewport <1440; vai trò khác dieuvan |
| FB-014 date seeding thắng topbar month (lô 07/09 trong tháng 10) | UI DRIVEN | `fb014-02-outmonth-*.png`, `fb014-02-outmonth-dom.txt`, topbar `Tháng 10/2026` vs scope `07/09/2026` | lô không có Bill/Booking (fallback mã lô); `date` không đúng YYYY-MM-DD (bị bỏ qua, giữ month bounds) |
| FB-014 quick-view vẫn trên trigger 'Chi tiết' | UI DRIVEN | `fb014-03-quickview-drawer.png`, log `quick_view_after_click` | trigger trên dòng không có container (nút không render); mobile |
| FB-113 header /shipments/:id có Số tờ khai + đúng thứ tự | UI DRIVEN | `fb113-01-header-shipments-id.png`, `fb113-01-header-dom.txt` | role khác CUS; lot không có tờ khai (hiển thị `—`); portal (cố ý không đổi) |
| FB-113 ledger 4 cột + nút Sửa inline | UI DRIVEN | `fb113-02-ledger-4-columns.png`, `fb113-02-ledger-dom.txt`, URL `…/shipments-detail?dateScope=all&searchSuffix=DNKM13337` | KHÔNG click mở inline editor (tránh ghi data); bill có nhiều tờ khai; card-mode (mobile ≤760); role khác CUS |
| FB-093-a badge là button + panel sửa BKS seeded | UI DRIVEN | `fb093-01-board-bks-and-merge-button.png`, `fb093-02-bks-editor-panel.png`, `fb093-02-bks-editor-dom.txt` | KHÔNG bấm Lưu (tránh đổi BKS thật); lô đã khóa chi phí (đường lỗi server); cột Phân xe mặc định đang ẩn |
| FB-093-b nút Ghép cước thu khách mở dialog | UI DRIVEN | `fb093-03-merge-dialog.png`, `fb093-03-merge-dialog-dom.txt`, log `merge_dialog` | KHÔNG bấm xác nhận ghép (tránh đổi data); 2 lô khác khách hàng (dialog báo xung đột); mobile; 2 lô đã ghép (đúng là bị chặn — đã thấy với CL5B-L02/L03) |
| Không có pageerror console trong 3 drive | UI DRIVEN | `consoleErrors: []` ở 3 log | network error/403 không sinh pageerror (không chủ động kill API) |

## Ghi chú / quan sát (không phải FAIL)

1. **Surface FB-113**: `ShipmentContainerLedger` (bảng 4 cột) chỉ nằm ở `/shipments-detail`; `/shipments/:id` (`ShipmentDetailPage`) là card header, KHÔNG render bảng ledger. Cả hai cùng nav "Chi tiết lô hàng", cùng lấy số tờ khai từ `declarations[]` — drive cả hai, ghi URL riêng từng surface.
2. **Để thấy badge FB-093** phải bật cột `Phân xe` qua nút `Cột` (bảng mở theo bộ ESSENTIAL ẩn 12 cột). Không bật thì badge không có trong DOM — đây là hành vi hiển thị mặc định, không phải defect.
3. **Cổng ghép** yêu cầu ≥2 lô lẻ `ghépCùngRef == null`: `CL5B-L02/L03` đã ghép cùng `CL5B-L01` nên bị vô hiệu — đúng luật; dùng `GAP-TEST-01/03` (chưa ghép) để mở dialog.
4. **Ledger `/shipments-detail` mặc định scope theo tháng topbar** (01/10–31/10): lô 176 (container tháng 8) phải bấm preset `Tất cả` trước khi search — đã làm, `dateScope=all`.
5. Các lần chạy probe trước (badge chưa bật cột, CL5B bị chặn) chỉ là recon hành vi, không để ảnh hưởng kết luận; log cuối cùng của mỗi driver là log trúng.
