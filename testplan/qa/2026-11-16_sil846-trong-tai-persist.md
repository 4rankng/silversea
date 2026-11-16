# SIL-846 (id 975) — Trọng tải (Loại xe tính cước) bị mất khi lưu (tạo + sửa)

- **Ticket**: SIL-846 · HIGH · QA FAIL 2 lần (fd0f7f14 + 68646e82): field hiển thị đủ options nhưng KHÔNG persist (tạo mới + sửa đều rớt).
- **AC1 (bỏ bắt buộc Quy cách đóng gói)**: đã PASS từ trước — không đụng.

## Root cause — route forwards drop `revVehicleClassId`

Cả chuỗi dưới đều CÓ sẵn field (schema zod kế thừa từ `createShipmentBaseSchema`, `updateShipmentSchema` có riêng, services map insert/update, DB column `shipments.rev_vehicle_class_id`, FE form/prefill/payload):
- POST `/api/shipments/quick` (Tạo lô từ workspace) — route forward list thiếu `revVehicleClassId: parsed.data.revVehicleClassId` → zod parse được, route silently drop.
- PUT `/api/shipments/:id` (Lưu thay đổi từ edit) — whitelist forward cùng lỗi → version tăng, giá trị giữ nguyên (đúng repro QA).

API repro trên main trước fix (admin, fixture LCL):
- POST `/shipments` (full create route — có forward) → DB rev=4 ✓ (chứng tỏ các tầng dưới ok).
- PUT rev=3 → 200, version 1→2, **DB vẫn 4** ✗ (silent drop).

## Fix

- `backend/src/routes/shipments/core.routes.ts`: forward `revVehicleClassId` ở CẢ `POST /quick` và `PUT /:id`.
- Pin zod layer: `shared/src/schemas/shipment-schema.test.ts` — test mới assert field sống qua cả quick + update contract (reject 0 và non-numeric).

## Verification

- API after: PUT rev=3 → DB 3 ✓; POST /quick rev=4 → lot mới DB rev=4 ✓.
- UI DRIVEN (rung 3): `/shipments/285/edit` (admin, 1440px) — prefill hiển thị giá trị đã lưu 'Cont 40 nhẹ…' (state QA từng thấy rỗng) ✓; chọn 'Xe 5 tấn' qua combobox → 'Lưu thay đổi' → DB `rev_vehicle_class_id = 8` ✓ + URL redirect về detail.
- Ảnh: https://bot.tingting.vip/tmpqa/sil846-after-save.png · driver `testplan/qa/scripts/2026-11-16-sil846-ui-verify.mjs`.
- Schema test: shared schema suite **16/16 PASS** (tsx --test).

## Gates

- BE `npx tsc --noEmit` sạch · shared schema tests 16/16 · FE `tsc -b` sạch.
- Fixture/repro lots 285-286 ĐÃ XÓA sau verify.
