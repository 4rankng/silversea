# QA1-007 — /shipments/new: required asterisks must equal the CREATE validation set

Case ID: TC-20261014_QA1-007-01
Feature: dấu * trên các trường của Tạo lô hàng (`/shipments/new`, CUS/CLERK)
vs. bộ validation CREATE thực thi trong `getShipmentCreateReadiness()`
(`frontend/src/features/shipments/create/shipment-create-model.ts`).

## Bệnh (audit 2026-10-14)

**Bắt buộc nhưng KHÔNG có dấu *** — người dùng không biết trường nào bắt buộc:

| Trường | Mode | Validation |
|---|---|---|
| Kho lấy hàng (`shipment-pickup-warehouse`) | LCL | `!form.pickupWarehouseSiteId` |
| Quy cách đóng gói (`shipment-package-type`) | LCL | `!form.packageType` |
| Số lượng (`shipment-package-count`) | LCL | `!count \|\| count < 1` |
| Trọng lượng kg (`shipment-cargo-weight`) | LCL | `!kg \|\| kg <= 0` |
| Ngày giao hàng (`shipment-expected-delivery`) | LCL | `!form.expectedDeliveryDate` |
| Ngày giờ đóng trả (per container) | FCL | `!row.customerAppointmentAt` |
| Cảng nâng / Cảng hạ (per container) | FCL | `!row.pickupPortId` / `!row.dropoffPortId` (chỉ lô thường) |

**Có dấu * nhưng KHÔNG bị validation** — dấu * nói dối ở chế độ lệnh chạy ngoài
(ad-hoc waives catalog prerequisites, MasterDataNhaMay §4.1):

| Trường | Mode | Thực tế |
|---|---|---|
| Tuyến đường (`shipment-route`) | LCL | issue chỉ khi `!adHoc` |
| Nhà máy * / Tuyến đường * (per container) | FCL | issue chỉ khi `!adHoc` |

## Expected sau khi sửa

- Dấu * xuất hiện đúng trên 7 nhóm trường bắt buộc phía trên (cảng nâng/hạ và
  nhà máy/tuyến per-container chỉ khi KHÔNG phải lệnh chạy ngoài).
- Dấu * biến mất ở chế độ lệnh chạy ngoài cho các trường catalog bị waiver
  (tuyến LCL, nhà máy/tuyến per-container); Cảng nâng/hạ cũng vậy.
- CBM (`shipment-cargo-volume`) giữ KHÔNG dấu * — helpdesk 2026-10-13 (ops
  Tiếp Vu): CBM không bắt buộc; nhập thì phải > 0.
- Các trường đã đúng giữ nguyên: Khách hàng, Hình thức XNK, Số Bill/Booking
  (theo hướng), Loại hàng (radio), Loại container (FCL), Ngày giờ đóng trả giờ
  có dấu * (trước đây thiếu).

## Pins

- Pins mới trong `ShipmentCreateWorkspace.asterisk-contract.test.tsx`: render
  form ở cả hai mode (thường/ad-hoc) × hai cargo mode và khớp bộ trường có dấu *
  `[data-required="true"]` với `getShipmentCreateReadiness().issues` field ids.

## Not covered

- Rung 3 trên staging; UI drive cục bộ nếu stack khả dụng.
- Các dialog con (thêm khách hàng/tuyến/cảng/loại cont) — form validation
  riêng, không thuộc bộ CREATE của lô.
