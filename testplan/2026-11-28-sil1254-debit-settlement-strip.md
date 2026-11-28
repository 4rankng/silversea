# SIL-1254 (id 1531) — /shipments-debit: dải tổng 630 cột (#1–#628 trống), trang rộng ~3.450px (regression case)

Case ID: TC-SIL1254-01
Feature: /shipments-debit (Chi phí - Quyết toán, `ShipmentDebitPage` + `DebitLotSettlementSummary` lớp tổng + `DebitMergeGrid` Ghép bộ Debit).

## Đặc tả (nguồn: thẻ SIL-1254, build 61999831, staging 28/11/2026, vai Chứng từ/tiepvv = Role.CUS, viewport 1440)
- Trước fix: dải tổng đầu trang = bảng 630 ô `th` (2 tiêu đề + 628 row-header "#1"–"#628"), 628 dòng rỗng ("đều trống"), bản thân dải bị kéo rộng 3.156px (min-content chain từ bảng chính ~3.2k) nên tiêu đề "TỔNG PHẢI THU KHÁCH" bị cắt ở mép phải; cả trang cuộn ngang ~3.450px (`.app-body` là rail) — muốn tới cột TRẠNG THÁI phải cuộn ngang ~2.000px TOÀN TRANG.
- Mong đợi: trang vừa màn hình 1440px, không cuộn ngang toàn trang; dải tổng chỉ hiện [dòng] có số liệu.

## Nguyên nhân (chẩn đoán 28/11)
- `settlementEntries = rows.map(...)` (ShipmentDebitPage.tsx:189-196) sinh MỘT DÒNG MỖI LÔ trong bộ lọc (628 lô) — phần lớn không có summary item → cả ba mặt '—' (item:null → `moneyCell` '—'), tạo bức tường "#N" trống (2 thead th + 628 row th = 630 "cột tiêu đề").
- Dải bị kéo ngang vì implicit grid track (`.shipment-debit-page` / `.shipment-debit-workspace` / `.debit-merge`) lấy min-content của bảng tiền ~3.2k (lớp lỗi SIL-1218 — chỉ sửa ≤768px); `.debit-settlement-band table { width: 100% }` kéo theo.
- Cuộn ngang TOÀN TRANG do `.app-body:has(.debit-merge__pane) { overflow-x: auto }` (DebitMergeGrid.css, gộp scroll context theo SIL-1179) — trang thành rail thay vì khung bảng.
- Latent: `.debit-settlement-band__money { text-align: right }` (0-1-0) thua `.debit-settlement-band th, td { text-align: left }` (0-1-1) → ô tiền + tiêu đề ngang hàng trái, cộng hưởng với việc dải bị kéo rộng làm tiêu đề rơi ra mép màn hình.

## Thiết kế đã chọn
- **A — dải tổng chỉ hiện dòng có số liệu**: một dòng chỉ render khi CÓ ÍT NHẤT MỘT mặt tiền hiển thị đã xác định (known/0 — "0 là giá trị", card 20261002_293); mặt còn thiếu trong dòng được giữ '—'. CUS (hideCost) chỉ nhìn mặt thu → dòng chỉ-có-giá-vốn biến mất. Số thứ tự "#N" GIỮ vị trí trong thứ tự lưới (entry index) để ánh xạ về dòng lưới #N — không đánh lại dense.
- **B — cắt min-content chain ở base scope**: `.debit-merge { grid-template-columns: minmax(0, 1fr) }` ở mọi breakpoint (thay placement band ≤768 của SIL-1218) — dải/toolbar không còn bị bảng tiền kéo giãn.
- **C — bảng tự chứa rail ngang (không cuộn ngang toàn trang)**: `.debit-merge__pane` là horizontal scroll box (overflow-x: auto — pattern "explicit scroll box" design-guidelines 2026-09-29, như master-plan wrapper "The wrapper is the HORIZONTAL rail only"); xóa `.app-body:has(.debit-merge__pane)` (SIL-1254 supersede SIL-1179 cho surface này). Document = single vertical scroller; dock ngang (data-sticky) neo vào pane ✓. Pin dọc của thead (SIL-897/1179) trôi theo bảng (doctrine "ONE scrollbar, NO sticky header" — master-plan 10/11) — ghi nhận trade trong verdict.
- **D — money right-align thắng specificity**: `.debit-settlement-band th|td.debit-settlement-band__money` (0-2-1) đè base th/td (0-1-1).

## Automated pins
- `frontend/src/pages/ShipmentDebitPage.test.tsx` (trong khối SIL-1238): dòng không có số liệu không render (all-'—' wall biến mất); "0 là giá trị" (dòng 0 giữ, dòng chỉ-có-payable trên mặt CUS ẩn); "#N" giữ ordinal lưới (ẩn dòng #1 → dòng giữ đọc '#2').
- `frontend/src/pages/ShipmentDebitPage.styles.test.ts` (mới): rule `.debit-settlement-band__money` out-specify base th/td.
- `frontend/src/features/accounting/DebitMergeGrid.test.tsx` (mới, SIL-1254): pane mang `overflow-x: auto` (rail nằm ở khung bảng); KHÔNG còn rule `.app-body:has(.debit-merge__pane)`; minmax(0,1fr) ở base scope (cập nhật pin SIL-1218 theo placement mới).
- Kế cận (re-run): DebitMergePage.* (sibling /accounting/ghep-bo-debit dùng chung grid).

## Quy tắc hiển thị (shipmate-uiux doctrine)
- §5 "A column with no value is not a column — absence is not data" (2026-09-29, autoHideWhenEmpty) — dải tổng là band tiền: dòng rỗng không hiện.
- §4 "Horizontal scroll is reserved for token tables" + design-guidelines 2026-09-29 "A board too wide for the canvas scrolls ON PURPOSE" (explicit scroll box) — bảng cuộn trong khung của nó, trang (document) không cuộn ngang.
- `0` là số liệu (D02/card 20261002_293), `—` (pending) thì không.

## Not covered bởi hồ sơ này
- Rung 3 UI DRIVEN (px + scrollWidth trên staging) thuộc cột QA theo chỉ đạo lane "Scoped tests + tsc" (kỳ vọng đo: `document.documentElement.scrollWidth ≤ 1440`; dải tổng chỉ còn các dòng có số liệu).
- Pin dọc sticky thead của SIL-897/1179 chủ động trôi theo bảng trong scroll hosting mới (trade đã nêu trong verdict) — nếu QA muốn giữ pin dọc thì cần bounded-pane lane riêng (pattern đã bị QA 10/11 từ chối trên master-plan: hai thanh cuộn + thead nổi).
