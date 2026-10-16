# Card QA2-005 — CUS /shipments: record search must cover mã lô and customer name (regression case)

Case ID: TC-20261013_QA2-005-01
Feature: Ô "Tìm lô hàng" trên `/shipments` (Tổng quan lô hàng) — tìm kiếm mức bản ghi
qua `searchSuffix` trên `GET /api/shipments/cus-workspace` (và surface chia sẻ
`GET /api/shipments/cus-workspace/containers`).

Source card: Kanban `IN_PROGRESS/121026084713-qa2-005-cus-shipments-no-text-search.docx`.
Điều tra dev trong card (2026-10-12, 3 lần độc lập) đã xác nhận: ô tìm + param
`searchSuffix` + debounce 350ms ĐÃ TỒN TẠI ở HEAD; staging lúc QA bắt lỗi đang chạy
build cũ. Phần CÒN THIẾU so với yêu cầu thẻ ("bill/booking, mã lô, container number,
customer name") và so với pattern tham chiếu `/dispatch` (`shipmentQSearchPredicate`):

1. `CUS_SEARCH_PATTERN` (shared) chỉ nhận `[A-Za-z0-9 ./-]` — tên khách hàng tiếng
   Việt có dấu ("Nguyễn Văn") bị chặn ở validation, không bao giờ tới URL/API.
2. Predicate backend (`cus-shipment-workspace-reads.service.ts`) thiếu `shipmentCode`
   (mã lô) và tên khách hàng (`customers.shortName`/`name`, plus `rawCustomerName`
   cho lô ad-hoc).

## Repro (trước khi sửa)
1. Đăng nhập CUS (thanhdc), mở `/shipments`.
2. Gõ mã lô (shipment_code) của một lô → 0 kết quả (không field nào khớp).
3. Gõ tên khách hàng có dấu, ví dụ `Nguyễn Thị A` → draft không được apply (vi phạm
   pattern ASCII), URL không có `searchSuffix`, bảng không lọc.
4. So sánh `/dispatch`: q-search tìm được theo tên khách hàng và mã lô.

## Expected (sau khi sửa)
- `CUS_SEARCH_PATTERN` nhận chữ Unicode (`\p{L}`) — tên tiếng Việt có dấu hợp lệ;
  vẫn cấm `%`/`_` (wildcard injection) và giữ sàn 4 ký tự / trần 64 ký tự.
- Predicate backend là substring case-insensitive (`ilike`) nhiều field, bao phủ:
  Bill (`bl_number`), Booking (`booking_ref`), mã lô (`shipment_code`), số container,
  số tờ khai, tên khách hàng (operational coalesce `short_name`→`name` HOẶC `name`
  đầy đủ — mirror `shipmentQSearchPredicate` của dispatch) và `raw_customer_name`
  cho lệnh chạy ngoài.
- Tên khách hàng nằm trong `EXISTS (select 1 from customers …)` để count query và
  status-tab counts (chạy `from shipments` không join customers) không vỡ.
- Search rỗng = không thêm điều kiện — hành vi hiện tại giữ nguyên; mọi filter hiện
  có (direction, date range, bucket, adHoc, customerId) compose AND với search.
- Placeholder ô tìm cập nhật vocab mới; ariaLabel/keyboard (`/`, Esc) giữ nguyên.

## Automated pins (red-first)
- shared `cus-shipment-workspace.test.ts`: `Nguyễn Văn A` pass; `AB%1`/`AB_1`/`A12`/65-char vẫn fail.
- backend `src/tests/unit/cus-record-search.test.ts` (no DB, PgDialect render):
  đủ 8 nhánh ilike (bl, booking, mã lô, container, tờ khai, tên KH ×2, raw name);
  `ilike` chứ không phải `like`; pattern `%…%` + escape `\%_\`; empty/whitespace →
  undefined (passthrough); shipment mode dùng EXISTS container, container mode là
  cột trực tiếp.
- FE `ShipmentsPage.test.tsx`: draft có dấu tới URL `searchSuffix=` sau debounce;
  composition search + direction trên cùng một request; placeholder mới.

## Không thay đổi (non-goals)
- Không đổi tên param `searchSuffix` (link/saved filter cũ phải sống).
- Không unaccent/diacritic-insensitive (dispatch q-search shipment predicate cũng
  chỉ `ilike` thường — theo Vertrag tham chiếu).
- Không restructure endpoint; chỉ additive.

## Not covered
- Rung 3 UI-driven trên staging (cấm theo §2; local UI drive nếu stack khả dụng).
- /shipments-detail chỉ được cập nhật placeholder (chia sẻ predicate); sweep rộng
  hơn thuộc surface khác.

## Re-run 2026-10-16 — kanban wave 1016c (TC-20261013_QA2-005-01)

Implementation status: đã có trên `origin/main` từ dispatch gốc (predicate +
`CUS_SEARCH_PATTERN` + ô tìm đã nối `searchSuffix`); wave này chỉ re-run bằng
chứng theo hợp đồng §6/§7, không sửa mã.

| Gate | Kết quả | Evidence |
|---|---|---|
| `frontend npx tsc --noEmit` | exit 0 | `qa/2026-10-16_kanban-1016c-qa2-005_fe-tsc.log` |
| FE vitest `src/pages/ShipmentsPage.test.tsx` | 135/135 PASS (gồm 3 pin QA2-005) | `qa/2026-10-16_kanban-1016c-qa2-005_fe-vitest.log` |
| `backend npx tsc --noEmit` | exit 0 | `qa/2026-10-16_kanban-1016c-qa2-005_be-tsc.log` |
| BE unit `src/tests/unit/cus-record-search.test.ts` | 6/6 PASS | `qa/2026-10-16_kanban-1016c-qa2-005_be-unit.log` |
| shared `src/schemas/cus-shipment-workspace.test.ts` | 18/18 PASS | `qa/2026-10-16_kanban-1016c-qa2-005_shared-test.log` |

Rung: ≤2 (code-read + executed pins; không drive UI đợt này).
