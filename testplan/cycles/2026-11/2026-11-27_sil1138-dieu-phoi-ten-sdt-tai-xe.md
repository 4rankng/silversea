# Regression spec — `SIL-1138` Chỉnh sửa điều phối mất tên/SĐT tài xế ngoài khi Lưu

**Ticket:** SIL-1138 (nhập tên/SĐT tài xế nhà xe ngoài → Lưu thay đổi → mở lại trống)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-27 (lane r40e) — verify on staging
**Cycle:** 2026-11 wave

## Goal

Hộp thoại "Chỉnh sửa điều phối" (mục "Phát lệnh cho tài xế"): "Tên tài xế (nhà xe ngoài)" và
"SĐT tài xế (nhà xe ngoài)" nhập rồi bấm [Lưu thay đổi] phải ĐƯỢC LƯU và hiện lại khi mở hộp
thoại (ticket expected). Payload PATCH .../plan mang 2 trường + persist + readback.

## Repro (QA 27/11, build 6398dfbc)

1. dungnv, /dispatch-detail?q=W3A-LCL → pill nhà xe lô W3A-LCL-01 → hộp thoại "Chỉnh sửa điều phối".
2. Mục "Phát lệnh cho tài xế": nhập "QA Tài Xế R4" + "0901111222".
3. Bấm [Lưu thay đổi] — hộp đóng, không lỗi; body PATCH KHÔNG có 2 trường (chỉ carrierType,
   externalCarrierId, plannedRevenue, plannedCarrierCost, classification, operationalNotes).
4. Mở lại hộp thoại → cả 2 ô trống; server assignedDriverName/Phone = null.

## Expected

- Body PATCH mang `externalDriverName`/`externalDriverPhone` khi 2 ô khác giá trị đã lưu
  (touch-gate: không đổi thì không gửi — không đè giá trị editor khác vừa lưu).
- Persist vào `shipment_fulfillments.planned_external_driver_name/phone` (cột nullable mới,
  migration additive IF NOT EXISTS); readback trả 2 trường qua `assignedDriverName/Phone` của
  dòng kế hoạch.
- Mở lại hộp thoại → 2 ô còn nguyên giá trị đã lưu. "Phát lệnh" vẫn mang contact vào trip
  (trip_carrier_info) như cũ.

## Out of scope

- Không đổi luật "tên tài xế ngoài không bắt buộc khi phát lệnh" (TC-DV-DISPATCH-046).
- Không đổi issue-body contract (externalDriverName/Phone vẫn ride issue).

## Acceptance criteria

### TC-1138-001 — Payload mang 2 trường khi thay đổi

- **Given** hộp thoại dòng EXTERNAL chưa phát lệnh, 2 ô đang trống.
- **When** nhập tên + SĐT → [Lưu thay đổi].
- **Then** `onAtomicSave` body chứa `externalDriverName: 'QA Tài Xế R4'`, `externalDriverPhone:
  '0901111222'`; không có confirm 'Vẫn lưu?'.

### TC-1138-002 — Vòng đời lưu → mở lại còn nguyên

- **Given** dòng có `assignedDriverName/Phone` đã lưu (readback).
- **When** mở hộp thoại.
- **Then** 2 ô hiện đúng giá trị đã lưu (seed từ readback).

### TC-1138-003 — Không gửi khi không đổi (touch-gate)

- **Given** 2 ô seed sẵn giá trị đã lưu.
- **When** [Lưu thay đổi] không sửa 2 ô.
- **Then** body KHÔNG có 2 khóa driver (không đè editor khác).

### TC-1138-004 — BE wiring

- **Then** schema strict nhận 2 khóa; service persist touch-gated; read service fall back
  `row.plannedExternalDriverName/Phone`; migration 2 cột nullable.
