# SIL-1214 (id 1395) — /shipments-detail 390px: dải tóm tắt đọc trọn vẹn (regression case)

Case ID: TC-SIL-1214-02
Feature: SummaryRail trên /shipments-detail (Chứng từ) ở băng điện thoại ≤520px.

## Repro (QA, build a8f059c0 → re-probe 2d15ef50 — FAIL 2 lần)
1. Đăng nhập tiepvv, mở /shipments-detail ở 390px.
2. Nhìn dải tóm tắt dưới bộ lọc.

## Expected
- Cả các chỉ số ('Container trên trang', 'Tổng container phù hợp', 'Thiếu ngày vận chuyển', 'Hôm nay chờ phân xe') đọc được TRỌN VẸN ở vị trí mặc định, không đứt giữa chữ ('Thiếu n…'), không cần đoán có cuộn ngang ẩn.

## Sửa (round 2 — 28/11)
- Round 1 (SIL-150 dải 40px flex + overflow-x auto + scrollbar ẩn) bị QA từ chối 2 lần: cắt chữ ở vị trí mặc định, không có dấu hiệu cuộn.
- Retire page-local band ≤520px; trả rail về luật dùng chung design-system ≤640px: `.summary-rail dl` lưới 2 cột — cùng luật trang đã đọc ở 521–640px.

## Pins
- `frontend/src/pages/ShipmentContainersPage.styles.test.ts` — pin-vắng: phone band KHÔNG override `.summary-rail dl`; margin rule giữ nguyên.
- `frontend/src/design-system/SummaryRail.test.tsx` — lưới 2 cột dùng chung (không đổi).

## Not covered
- UI DRIVEN 390px: QA verify trên staging sau deploy commit này.
