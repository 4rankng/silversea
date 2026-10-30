# SIL-607 — Thông tin hàng: lỗi "chọn ngày giờ đóng/trả" render TRÙNG 2 dòng + xác minh luật CUS-03

- Ticket: SIL-607 (board SIL, id 710) — reported 30/10, build 8f376365 staging.
- Role/flow: shipmentCreatorOnly, /shipments/new, FCL, bảng "Thông tin hàng",
  cột "NGÀY GIỜ ĐÓNG TRẢ".

## Triệu chứng

1. Sau submit thiếu lịch, ô "Ngày giờ đóng/trả" của container 1 hiển thị
   **2 dòng đỏ giống hệt** "Container 1: chọn ngày giờ đóng/trả." chồng nhau.
2. Lỗi vẫn hiện khi band "Ngày giờ đóng trả cho tất cả cont" đã có giá trị
   (08:00 29/10/2026).

## Nghi gốc (xác minh)

- Trùng render: ô appointment nạp message vào **2 tầng** —
  `ShipmentContainerCell` (`.csc-container-cell__error`, luôn thấy) và
  `SplitDateTimeField` bên trong (`<small class="split-datetime__error">`,
  đợt 687 — lộ khi editor reveal: submit-fail focus ⇒ `:focus-within`,
  hoặc ≤620px where editors show continuously). Luật nhà dòng 42 của
  `ShipmentContainerCell.css` đã ẩn error span tầng trong cho UUI fields,
  nhưng `<small>` của split-datetime thoát selector đó.
- Band có giá trị mà vẫn lỗi: ĐÚNG luật hiện hành — band bulk là **nguồn
  clipboard only** (owner 26/10: SIL-511 retire chip "Áp dụng cho N
  container", SIL-513 retire chip copy-ALL; typed value không bao giờ ghi vào
  rows). Per-container vẫn bắt buộc (payload truth — FCL schedule derive từ
  container rows phía BE). CUS-03 "copy-all thỏa per-container" được thỏa
  bởi đường copy-down ("Copy giờ hẹn xuống cont trống") ghi giá trị vào từng
  row; validation đọc rows.

## Expected sau fix

1. Mỗi container render ĐÚNG 1 dòng lỗi visible (cell owns the line); bản copy
   của field bên trong bị display:none bên trong container cell (a11y
   aria-invalid + aria-describedby giữ nguyên).
2. Band có giá trị nhưng rows trống ⇒ vẫn lỗi per-container, đúng 1 dòng.
3. Copy-all (copy-down) fill hết rows trống ⇒ không còn lỗi appointment nào.
4. Không đụng 687 (LCL `shipment-lcl-closing-at` — ngoài container cell) và
   604 (CUS quick-edit — không qua `ShipmentContainerCell`).

## Regression lock

- CSS law: `ShipmentContainerCell.error-dedupe.styles.test.ts` — pin rule
  `.csc-container-cell__editor .split-datetime__error { display: none; }`
  (verify-fail: bỏ rule ⇒ test fail).
- DOM pin: `ShipmentCreateWorkspace.sil607-appointment-error.test.tsx` —
  3 case (dedupe sau submit; band-alone ⇒ đúng 1 dòng; copy-all ⇒ hết lỗi).
- Model pin: `shipment-create-model.test.ts` — đúng 1 issue per container,
  không message trùng; fill-all ⇒ 0 appointment issue.

## Lịch sử

- 30/10: fix 1 dòng CSS + 3 file test; scoped vitest create+clerk+ds-forms
  73 file (624 test, 1 flake timeout solo-rerun 20/20 PASS) + tsc 0 +
  eslint 0 (qa/2026-10-30_sil607_*). UI chưa drive trong lane này (task scope:
  scoped vitest + tsc; QA drive ở cột QA).
