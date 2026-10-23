# Card 221026040542 (R32) — Báo giá UI vs `docs/prd/BaoGia.md`: đối chiếu field-by-field + QA re-check guide

QA verify-fail "không có UI báo giá" → **sai**: UI tồn tại và đủ mọi mục spec
trong checklist của card. Không có field nào thiếu nên **không sửa code FE/BE**
(card này là verify + evidence; lag field do lane song song sở hữu — xem §3).

- **URL chính xác:** `http://localhost:7175/config/quotations` (local dev);
  staging: `/config/quotations` trên host staging.
- **Vào bằng menu:** sidebar **Hệ thống → Cấu hình** (`/config`) → card
  **"Báo giá"** (icon pricing-rate, mô tả "Khung báo giá theo khách hàng…",
  status "N khung"). ADMIN/MANAGER đều thấy.
- **Tài khoản QA:** ADMIN (admin) hoặc ACCOUNTANT — trang guard
  `officeStaffOnly`; import/commit backend giới ACCOUNTANT+ADMIN.

## 1. Bảng đối chiếu spec → UI (đủ = CÓ)

| # | Mục BaoGia.md | Có? | QA thấy ở đâu (click path) | Bằng chứng |
|---|---|---|---|---|
| 1 | Khung giá — **tên mẫu** (§2) | ✅ | Nút **＋ Tạo báo giá** → dialog field "Tên mẫu báo giá" (bắt buộc, ≤120 ký tự); tên mẫu hiển thị ở từng dòng khung bên trái | `ui-03-create-dialog.png` · driver C "Tên mẫu báo giá" |
| 2 | Khung giá — **giá dầu tham chiếu** (§2) | ✅ | Chọn khung "Mẫu báo giá 1" → đầu mỗi block tuyến: "Giá dầu tham chiếu 17.843 ₫/lít" (sống từ Bảng điều kiện giá) | `ui-02-grid-10-classes.png` · driver B5 |
| 3 | Khung giá — **độ trễ áp giá dầu (lag)** (§2) | ✅ hiển thị · ⏳ field mới sắp có | Đầu mỗi block: "Trễ 1 ngày" + link "Sửa tham số giá dầu/lag tại Bảng điều kiện giá" (`/config/freight-rate-terms`). **KHÔNG đụng field này** — lane song song đang thêm `fuelPriceLagDays`, sẽ xuất hiện tại Bảng điều kiện giá | driver B6 "Trễ 1 ngày" · API cell `fuelLagDays=1` |
| 4 | Khung giá — **ngày hiệu lực** (§2) | ✅ | Dialog "Ngày hiệu lực" (date picker, bắt buộc); danh sách khung hiện ngày + badge "Đang hiệu lực / Chưa hiệu lực" | `ui-03-create-dialog.png` · driver C "Ngày hiệu lực" |
| 5 | Khung giá — **quy tắc làm tròn phụ phí** (§2, §5) | ✅ | Dialog "Làm tròn phụ phí dầu": Không làm tròn / Đến hàng nghìn / Đến hàng chục nghìn (NONE/THOUSAND/TEN_THOUSAND) | driver C2 |
| 6 | Lưới giá = **nhà máy × tuyến × hạng xe** (§2) | ✅ | Chọn khung → mỗi **block = 1 tuyến** (Hải Phòng-NEWEB, ASKEY, SUNRISE+ SJ) chứa bảng 10 dòng hạng; nhà máy ánh xạ tuyến ở bước import (D4) và Bảng điều kiện giá | `ui-02-grid-10-classes.png` · driver B1 |
| 7 | **Đủ 10 hạng**: 6 hạng lẻ 1.25T–10T + 4 hạng cont (§2) | ✅ | Mỗi block đủ 10 dòng: Xe 1.25T/2.5T/3.5T/5T/8T/10T (phụ đề "Hàng lẻ") + Cont20 <20t / Cont20 >20t / Cont40 nhẹ <20t / Cont40 nặng >20t (phụ đề "Hàng container") — nhãn từ `QUOTATION_GRID_COLUMNS` (shared) | driver B2/B3 · API 30 cell = 3 tuyến × 10 · DB 12 mã hạng chuẩn |
| 8 | Mỗi ô: **hệ số phụ phí** (§2, §5) | ✅ | Cột "Hệ số" = input sửa được mỗi ô (30 ô = 3 tuyến × 10), blur để lưu; hệ số lưu theo ô, riêng từng tuyến | driver B7 (30 inputs) |
| 9 | Mỗi ô: **tổng lít dầu/chuyến** (§2 — số dẫn xuất) | ✅ | Cột "Tổng lít dầu/chuyến" — chỉ đọc, suy từ km khứ hồi × định mức (không nhập tay) | driver B4 · API `liters` |
| 10 | Mỗi ô: **giá cos** (§2) | ✅ | Cột "Giá cos" (tiền); ô thiếu giá hiện đúng chữ **"Thiếu giá"**, không tự điền (ruling 2 — không light-fallback) | `ui-02-grid-10-classes.png` · driver B4 + API `missingPrice` |
| 11 | **Nhập Excel cước KH** (§4) — routes preview/commit | ✅ | Nút **"Nhập xlsx"** (thanh lọc, trên phải) → chọn file → khối **"Xem trước"** liệt kê ánh xạ nhà máy → tuyến, lỗi từng dòng, nút **"Ghi nhận nhập file"** (khoá khi có lỗi) + **"Huỷ"** | `ui-04-import-preview.png` · driver D1–D5 |
| 12 | Preview = lần ghi thật; Huỷ không để lại vết (§4) | ✅ | Bấm "Huỷ" → số khung không đổi (2 → 2 trong log) | driver D5 |
| 13 | **Xuất Excel** (§4) | ✅ | Nút **"Xuất xlsx"** (thanh lọc; cần chọn khung trước — có tooltip hướng dẫn khi chưa chọn) → tải `bao-gia-<id>.xlsx` (6.590 bytes, khớp byte-byte API export) | `ui-05-export-clicked.png` + `download/bao-gia-da-tai.xlsx` · driver E1/E2 |
| 14 | **Lịch sử phiên bản** (§7) + xuất bản cũ | ✅ | Cuối trang "Lịch sử phiên bản": bộ lọc Từ/Đến ngày, mỗi dòng "Phiên bản N" có **"Xem"** (payload chỉ đọc: Tuyến/Hạng/Hệ số/Lít/Giá cos/Phụ phí) + **"Xuất xlsx"** riêng cho đúng bản đó | `ui-06-version-history.png`, `ui-07-version-payload.png` · driver F1–F3 |

Kết luận: **14/14 mục checklist CÓ** — không thiếu mục nào của BaoGia.md trong
phạm vi card. Không có chỗ sửa nên không có cặp screenshot trước/sau; toàn bộ
screenshot là trạng thái hiện tại của màn hình (bằng chứng "đang có").

## 2. QA re-check nhanh (3 phút)

1. Đăng nhập ADMIN → `http://localhost:7175/config/quotations` (hoặc
   `/config` → card "Báo giá").
2. Thấy 2 khung: "Mẫu báo giá 1" (LONG MINH) / "Mẫu LOG COM" + 3 nút
   Nhập xlsx · Xuất xlsx · ＋ Tạo báo giá. → mục 1–4 (khung), 11–13 (nút).
3. Bấm dòng "Mẫu báo giá 1" → 3 block tuyến × 10 dòng hạng, đầu block có
   "Giá dầu tham chiếu … · Trễ 1 ngày". → mục 2, 3, 6, 7.
4. Mỗi block: cột Hệ số (input) · Tổng lít dầu/chuyến · Giá cos · Phụ phí ·
   Tổng. → mục 8–10.
5. Bấm "＋ Tạo báo giá" → đủ 5 field → bấm "Hủy". → mục 1, 4, 5.
6. Bấm "Nhập xlsx" → chọn `testplan/fixtures/2026-09-23_bao-gia-mau-synthetic.xlsx`
   → xem bảng ánh xạ → bấm "Huỷ". → mục 11–12.
7. Đang chọn khung → bấm "Xuất xlsx" → file `bao-gia-1.xlsx` về máy. → mục 13.
8. Cuộn xuống "Lịch sử phiên bản" → "Xem" phiên bản 1 → bảng chỉ đọc. → mục 14.

## 3. Ghi chú

- **Lag (mục 3):** hiển thị "Trễ N ngày" đọc từ `freight_rate_terms.fuelLagDays`;
  chỉnh tại `/config/freight-rate-terms`. Lane song song đang thêm
  `fuelPriceLagDays` — card này không đụng, khi lane đó land sẽ cập nhật guide.
- Hạng cont nặng (Cont20 >20t, Cont40 nặng >20t): Giá cos để trống là **ruling 2
  (Mẫu 1)** — hiện "Thiếu giá" + phụ phí tính theo tham số hạng nhẹ, KHÔNG phải
  lỗi thiếu spec (PRD §3 "kế thừa hạng nhẹ" bị ruling 2026-09-22 thay thế).
- `he_so_rows=0` ở khung 1 trong DB proof là đúng thiết kế: hệ số mặc định 1
  không lưu dòng (sparse overrides).

## 4. Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Trang `/config/quotations` load, đủ 3 nút Excel/tạo | UI DRIVEN | `../2026-10-22-quote-ui_ui-driver.log` (A1–A5) + `ui-01-page-frames.png` | viewport 390/768 (chỉ chốt 1440); role MANAGER/ACCOUNTANT chỉ thấy qua guard `officeStaffOnly` + code-read |
| Lưới đủ 10 hạng × 3 tuyến, phụ đề lẻ/cont | UI DRIVEN | driver B1–B3 + `ui-02-grid-10-classes.png` + `../2026-10-22-quote-ui_db-proof.txt` (12 mã hạng) | khung LOG COM (không có terms → EmptyState, chủ đích); staging |
| Mỗi ô đủ Hệ số (input) · Lít · Giá cos (+Phụ phí/Tổng) | UI DRIVEN | driver B4/B7 (30 inputs, 5 nhãn cột) + API identity trong log | sửa hệ số + lưu (đã có test vitest `QuotationConfigPage.test.tsx` chạy riêng); mobile |
| Khung giá: tên mẫu/giá dầu/lag/ngày hiệu lực/làm tròn | UI DRIVEN | driver B5/B6/C1–C2 + `ui-02`, `ui-03` | submit tạo khung mới (không tạo dữ liệu QA thừa); lag mới `fuelPriceLagDays` của lane song song |
| Import: preview + Ghi nhận/Huỷ, Huỷ không ghi vết | UI DRIVEN | driver D1–D5 + `ui-04-import-preview.png` + D5 frames 2→2 | nhánh commit thật (tạo khung mới — đã cover bởi `QuotationConfigPage.import.test.tsx` TC-BG + API test); file lỗi ánh xạ |
| Export xlsx từ UI | UI DRIVEN | driver E1/E2 + `ui-05-export-clicked.png` + `download/bao-gia-da-tai.xlsx` (6590B = API) | export bản cũ qua nút phiên bản (cover code-read + API `:version`) |
| Phiên bản: Xem payload chỉ đọc | UI DRIVEN | driver F1–F3 + `ui-06`, `ui-07` | lọc khoảng ngày phiên bản; xuất xlsx phiên bản |

Môi trường: LOCAL dev (`make dev` stack: FE :7175 → API :3002 → Postgres :5441),
tài khoản ADMIN `admin`, dữ liệu khung 1 = LONG MINH "Mẫu báo giá 1" (3 tuyến:
Hải Phòng-NEWEB, ASKEY, SUNRISE+ SJ). Ngày chạy: 2026-10-22.

## 5. Artifacts

- Driver: `qa/drivers/2026-10-22-quote-ui-drive.mjs` (29 check, 29 PASS).
- Log: `qa/2026-10-22-quote-ui_ui-driver.log` (exit 0).
- DB/API: `qa/2026-10-22-quote-ui_db-proof.txt`.
- Screenshots: `ui-01`…`ui-07` (trong thư mục này) + xlsx đã tải
  `download/bao-gia-da-tai.xlsx`.
- Regression cases: `testplan/2026-10-22-card221026040542-quote-ui-spec.md`
  (QA-BG-UI-1…5).
