# SIL-655 (id 762) — trip_containers mồ côi: 5/8 insert path không set source_shipment_container_id

Worktree lane: `fix-sil655-trip-container-link`. Base `origin/main`.

## Case SIL655-01 — copyTrip mất liên kết lô

- Repro: copy một trip phát lệnh từ lô FCL (trip_containers có
  `source_shipment_container_id`), rồi lái xe nhập số cont trên trip copy.
- Expected: dòng container của trip copy giữ liên kết
  `source_shipment_container_id` (số/seal vẫn reset null theo luật copy);
  số lái xe nhập trên trip copy bridge về đúng shipment_container.
- Trước fix: dòng copy không có link ⇒ bridge no-op ⇒ số không về lô.

## Case SIL655-02 — trip tạo từ lô có sẵn container bị trộn placeholder + dòng thật

- Repro: POST /api/v1/trips với shipmentId của lô đã có ≥1 shipment_container
  và payload có containerTypeId + containerCount.
- Expected: trip CHỈ chứa dòng snapshot (có link); không insert thêm
  `containerCount` dòng placeholder không link. Placeholder chỉ còn khi lô
  không có container (hoặc trip không thuộc lô nào).

## Case SIL655-03 — insert trip_container có số nhưng không link (driver/forwarder/batch)

- Repro: POST /api/driver/me/trips/:id/containers (hoặc
  /api/forwarder/me/..., hoặc PUT /api/trips/:id/containers) với số cont
  trên chuyến có `trips.shipment_id`:
  - số KHÔNG có trên lô ⇒ 409 (phải khai trên lô trước);
  - số TRÙNG container của lô chưa có dòng nào trên chuyến ⇒ insert + set
    link `source_shipment_container_id` ⇒ bridgemirror số/seal về lô;
  - số trùng container của lô đã có dòng trên chính chuyến ⇒ 409 trùng.
- Expected: không thể tạo trip_container mồ côi có số trên chuyến thuộc lô.

## Case SIL655-04 — dòng LCL synthetic không bao giờ mang số cont

- Repro: lái xe Sửa (PATCH) số cont trên dòng synthetic của chuyến LCL
  (notes `__fulfillment_lcl:<id>`).
- Expected: 409 — lô LCL không được có container (luật decomposition
  `shipment-fulfillment.service.ts` 'Lô hàng lẻ không được tạo container giả'
  + intake `shipment-intake.service.ts` 'Hàng lẻ không được có container giả'),
  nên số không thể resolve về lô ⇒ từ chối tường minh, không im lặng bỏ qua.
  Dòng synthetic giữ cờ tường minh `__fulfillment_lcl:` trong notes.

## Case SIL655-05 — PATCH số lên dòng placeholder (không link) của chuyến có lô

- Repro: chuyến thuộc lô nhưng dòng container chưa link (placeholder cũ),
  lái xe/văn phòng PATCH số cont vào dòng đó.
- Expected: resolve số về container của lô ⇒ set link ngay trên dòng đó
  ⇒ bridge mirror về lô. Trước fix: số nằm chết trên trip, văn phòng đọc
  "Chưa có số cont".

## Biên của invariant (documented)

- Trip KHÔNG thuộc lô nào (`trips.shipment_id IS NULL`, legacy/SHIPMENT_FIRST_CREATE
  off): không có shipment_containers để resolve ⇒ giữ hành vi cũ (số ghi trên
  trip, không thể bridge — invariant vacuous). Ghi nhận trong report.
- Lô FCL chưa phát lệnh: shipment_containers mang số chưa có trip row là trạng
  thái hợp lệ (lô tồn tại trước chuyến — kiến trúc phase-01), không thuộc gate
  của ticket này.

## Gate queries (chạy trên ss-prod-db localhost:5441)

```sql
-- mismatch (linked but number differs)
SELECT tc.id FROM trip_containers tc
JOIN shipment_containers sc ON sc.id = tc.source_shipment_container_id
WHERE tc.container_number IS NOT NULL
  AND (sc.container_number IS NULL OR sc.container_number <> tc.container_number);
-- orphan with number
SELECT tc.id FROM trip_containers tc
LEFT JOIN shipment_containers sc ON sc.id = tc.source_shipment_container_id
WHERE tc.container_number IS NOT NULL AND tc.container_number <> ''
  AND tc.source_shipment_container_id IS NULL;
```

Baseline 02/11: mismatch = 2 (tc 12, 17 — class SIL-653, cần chạy lại
`backfill-stranded-container-numbers.ts --apply` — orchestrator quyết định);
orphan-with-number = 0.
