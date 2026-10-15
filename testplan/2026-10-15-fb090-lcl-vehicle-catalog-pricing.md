# FB-090 — LCL foundation: Loại xe tải trọng tải + Bảng giá thu/trả theo trọng tải

Ticket: `kanban/TODO/FB-090-lcl-vehicle-catalog-pricing.md`
Nguồn: DEV SPEC Hoàn thiện Hàng lẻ (LCL) 2026.10.15 §I + §II.1.
Branch: `feat/lcl-foundation`. Ngày: 2026-10-15.

## Phạm vi

1. Danh mục Loại xe (`vehicle_size_classes`) — đã có table + seed (1.25T…15T,
   CONT20/40, CONT20/40.LIGHT/.HEAVY) + CRUD API `/api/vehicle-size-classes`.
   FB-090 bổ sung: shared type, hook, trang quản trị danh mục, và quy tắc
   nguồn xe (sourcing rule) dùng chung cho các ticket LCL sau.
2. Bảng giá theo loại xe:
   - Cước thu khách: `pricing_tables` + cột `vehicle_size_class_id`
     (denormalize `rate_key` = mã loại xe để mọi đường resolve hiện hành —
     engine rateKey, `resolveTablePrice`, seed — hoạt động nguyên vẹn).
   - Cước trả nhà xe: bảng mới `carrier_route_pricing`
     (tuyến × loại xe × [nhà xe, NULL = giá chung] × giá × hiệu lực).
3. Regression cases bên dưới phải pass trước khi báo hoàn thành.

## Cases

### FB090-01 — Quy tắc nguồn xe LCL (shared)
- Vào: helper sourcing rule với loại xe tải (isContainer=false) và
  loại cont (isContainer=true).
- Kỳ vọng: xe tải → `EXTERNAL_ONLY` (100% xe ngoài); cont 20'/40' →
  `INTERNAL_OR_EXTERNAL`. Nhãn hiển thị tiếng Việt tương ứng.

### FB090-02 — Lookup cước thu khách theo loại xe
- Setup: customer + route + pricing row gắn `vehicle_size_class_id`
  (code '5T'), effectiveDate cũ hơn ngày tra.
- Hành động: resolve theo vehicle class id; resolve theo mã class
  (compatible rateKey row không có id); ngày tra sau ngày hiệu lực mới nhất.
- Kỳ vọng: trả về giá của row có effectiveDate ≤ ngày tra mới nhất;
  row rateKey-compat resolve được như row có id; không có row → null
  (caller tự xử lý MANUAL), không throw.

### FB090-03 — Lookup cước trả nhà xe (carrier_route_pricing)
- Setup: route + vehicle class; row giá chung (supplier NULL) và row
  riêng của nhà xe X cho cùng (route × class × date).
- Hành động: resolve với supplierId=X; supplierId=Y (chưa có row riêng);
  không truyền supplierId.
- Kỳ vọng: có row riêng → dùng giá riêng; chỉ có giá chung → dùng giá
  chung khi supplier không có row riêng; không có gì → null. effectiveDate
  mới nhất ≤ ngày tra thắng.

### FB090-04 — CRUD bảng giá trả nhà xe chống trùng
- Setup: tạo row (route × class × supplier NULL × date) rồi tạo lại y hệt.
- Kỳ vọng: 409 từ route guard; tạo row riêng của nhà xe cùng (route ×
  class × date) thì hợp lệ (không trùng với giá chung).

### FB090-05 — Admin UI
- Trang "Loại xe" liệt kê catalog + quy tắc nguồn xe; thêm/sửa được.
- Trang "Bảng giá cước": chọn Loại xe từ dropdown (không còn gõ tay mã
  lớp giá khi chọn từ danh mục); container select vẫn hoạt động; chọn cả
  hai → chặn.
- Trang "Bảng giá cước trả nhà xe": tạo/g/s/x row theo
  tuyến × nhà xe (hoặc "Giá chung") × loại xe.

## Not covered
- FB-091..095 (display/grouping/settlement/debit-note/unmerge) — các
  ticket sau tiêu thụ foundation này.
- Không deploy (theo chỉ dẫn).
