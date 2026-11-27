# Regression spec — `SIL-1140` /dispatch empty-state sai câu KB

**Ticket:** SIL-1140 (dòng trống /dispatch hiện "Không có lô hàng nào cần phân xe" thay vì "Không có hàng lẻ chạy ngày đã chọn" — K10.13)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-27 (lane r40e) — verify on staging
**Cycle:** 2026-11 wave

## Goal

KB Ch.10 §10.3.2: dòng trống trên màn /dispatch (Kế hoạch Tổng quát) phải hiện đúng câu
"Không có hàng lẻ chạy ngày đã chọn" (đúng câu chữ).

## Repro (QA 27/11, build 6398dfbc)

1. dungnv, mở /dispatch.
2. Đặt bộ lọc ngày Từ 01/01/2031, Đến 31/01/2031 (khoảng ngày không có lô nào).
3. Dòng trạng thái trống hiện "Không có lô hàng nào cần phân xe" + "Lô hàng có ngày giao sẽ
   xuất hiện ở đây." — câu KB không xuất hiện.

## Expected

- Dòng trống hiện "Không có hàng lẻ chạy ngày đã chọn" (K10.13 — nhánh câu trạng thái trống;
  các nhánh khác của K10.13 đã PASS cùng build).

## Out of scope

- Không đổi các nhánh K10.13 khác (hộp thoại Phân bổ nhà xe, lỗi phân vượt nhu cầu, nhãn
  "Chưa phân xe", tìm Bill).
- Không đổi empty-state của các màn khác.

## Acceptance criteria

### TC-1140-001 — Chuỗi khớp KB

- **Given** /dispatch không có dòng nào (bộ lọc ngày không khớp lô).
- **When** quan sát dòng trạng thái trống.
- **Then** title = "Không có hàng lẻ chạy ngày đã chọn"; chuỗi cũ "Không có lô hàng nào cần
  phân xe" biến mất. Pin: MasterPlanPage.test.tsx (render rỗng).
