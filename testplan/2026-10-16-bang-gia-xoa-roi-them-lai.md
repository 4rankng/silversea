# Bảng giá — xóa rồi thêm lại báo trùng ảo (card 161026121500)

Nguồn: kanban card `161026121500-bang-gia-xoa-roi-them-lai-bao-trung-ao`
(file .docx 0 byte — nội dung không đọc được; phạm vi suy từ tên card +
họ defect đã biết từ closed-loop 2026-10-16: F-1 cùng bảng
`pricing-tables`, ticket 161026095800). Ngày: 2026-10-16.

## Nguyên nhân (code-read + schema-read, xác nhận bằng introspection)

`createCrudRouter` xóa mềm mặc định (`deleteMode: 'soft'` → set `deletedAt`);
mọi guard trùng ở tầng app cho pricing catalog đều lọc `isNull(deletedAt)`.
Nhưng 5 unique index trên DB **không** loại tombstone khỏi slot duy nhất:

| Index | Bảng | Predicate hiện tại |
|---|---|---|
| `pricing_tables_general_date_idx` | pricing_tables | không có `deleted_at is null` |
| `pricing_tables_container_date_idx` | pricing_tables | không có `deleted_at is null` |
| `pricing_tables_rate_key_date_idx` | pricing_tables | không có `deleted_at is null` |
| `road_allowances_route_type_idx` | road_allowances | không có WHERE nào |
| `lift_pricing_port_type_state_dir_date_uniq` | lift_pricing | không có WHERE nào |

→ Luồng: tạo bảng giá → xóa (xóa mềm) → thêm lại cùng phạm vi → guard app
cho qua → INSERT đụng index vẫn chiếm chỗ bởi dòng đã xóa → vi phạm unique
→ báo "trùng" dù không còn dòng sống nào. `carrier_route_pricing` (2 index)
và `port_zone_surcharges` đã đúng — đây là chuẩn tham chiếu.

## Case hồi quy

### BGX01 — xóa bảng giá cước rồi thêm lại cùng phạm vi: phải thành công
1. Tạo bảng giá cước (customer × tuyến × [container|loại xe] × ngày hiệu lực) → 201.
2. Xóa dòng vừa tạo (DELETE → xóa mềm, `deletedAt` set).
3. Tạo lại đúng phạm vi đó → phải **201**, không phải 409/500.

### BGX02 — hai dòng sống cùng phạm vi vẫn bị chặn
1. Tạo bảng giá phạm vi X (live) → 201.
2. Tạo tiếp bảng giá cùng phạm vi X → phải 409 "Bảng giá cho phạm vi và
   ngày hiệu lực này đã tồn tại" (chống trùng thật không suy yếu).

### BGX03 — sweep họ defect: phụ cấp đường & giá nâng hạ
1.road_allowances: tạo (tuyến × loại rơ-moóc) → xóa → tạo lại → 201.
2.lift_pricing: tạo (cảng × cont × hướng × trạng thái × ngày) → xóa → tạo lại → 201.
3. Cả hai: hai dòng sống cùng khóa → 409 như cũ.

### BGX04 — pin schema: 5 index phải mang predicate tombstone
Unit test introspect drizzle schema (getTableConfig + PgDialect): cả 5 index
trên chứa `deleted_at is null`; 2 index `carrier_route_pricing` giữ nguyên
predicate đúng (chống regenerate làm mất).

## Kết quả (2026-10-16)

| Case | Kết quả | Bằng chứng |
|---|---|---|
| BGX01 | PASS — DB | `qa/2026-10-16_bang-gia-tombstone_db-proof.log` (INSERT→soft-delete→INSERT OK, 1 live row) |
| BGX02 | PASS — DB | cùng log: `duplicate key ... pricing_tables_general_date_idx` khi 2 dòng sống |
| BGX03a/b | PASS — DB | cùng log: road_allowances + lift_pricing re-add OK |
| BGX04 | PASS — unit | `backend/src/tests/unit/pricing-tombstone-unique-indexes.test.ts` 5/5 |
| BGX01 (UI) | PASS — rung 3 | `qa/2026-10-16_bang-gia-tombstone_ui-06-recreated-same-selector.png` + driver log — tạo→xóa→tạo lại cùng selector qua UI thật: THÀNH CÔNG |
| BGX02 (UI) | PASS — rung 3 | `qa/2026-10-16_bang-gia-tombstone_ui-07-real-duplicate-still-blocked.png` — "Bảng giá cho phạm vi và ngày hiệu lực này đã tồn tại" |

Ghi chú rung-3: DateInput không nhận synthetic date (hàng rơi về
2026-10-16 thay vì 2099-12-31) nhưng selector identity giữ nguyên qua
tạo/xóa/tạo-lại (cùng customer × route × date) nên repro vẫn đúng đường
defect. DB sau chạy: 3 dòng sentinel đều tombstone (dọn sạch).

