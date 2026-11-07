# Case SIL-688 r4 — Xóa lô: chặn theo CHUYẾN XE phát lệnh, KHÔNG theo trạng thái lô

Ticket: SIL-688 (id 800) · Re-opened 07/11/2026 sau lane F1 · QA fail build 8f29bea4
(staging) + owner law 07/11/2026.

## Defect class (regression of 04627a9a)

SIL-653's commit 04627a9a (07/11 11:27) ORed lot status into the shared FE seed
`hasDispatchedLegs` (`shipment-edit-prefill.ts`): `hasLiveTrips || status ===
'DISPATCHED' || status === 'COMPLETED'`. The Xóa lô button reads that same seed
(`ShipmentCreateWorkspace.tsx` deleteBlockedReason), so a lot whose STATUS moved
but whose containers carry NO issued order had its Xóa lô dead on the UI while
the BE admits DELETE 200 — the exact "chặn theo trạng thái lô" the owner law
forbids. Muse QA: "lô IN_TRANSIT bị chặn xóa SAI".

## Owner law (07/11/2026)

- Deletion blocks ONLY on whether the CHUYẾN XE has issued orders (a live trip:
  `trips.deleted_at IS NULL AND status <> 'CANCELED'`, linked `trips.shipment_id`
  trực tiếp hoặc qua `shipment_fulfillments`) — NEVER on the lot's own status.
- Lô IN_TRANSIT (stale) với mọi container chưa phát lệnh → DELETE 200.
- Lô đã có chuyến phát lệnh → 409 "Chỉ xóa được khi mọi container chưa phát lệnh".
- Điều vận (DISPATCHER) → 403 (route requireRoles + service + casbin bridge —
  SIL-706 owner confirmation). CUS + ADMIN → được xóa. OPS → 403.
- Nút Xóa lô phải có trên 3 mặt: chi tiết lô /shipments/:id, danh sách
  /shipments (drawer), quyết toán /shipments-debit (menu "…") — chỉ CUS/ADMIN.

## Reproduction

1. `make dev`; login admin + tiepvv (CUS) + dieuvan (DISPATCHER), password Abc123.
2. Lô IN_TRANSIT chưa phát lệnh (fixture local: 779169/779168/779166 — 0 live
   trips; tạo mới: tạo lô, đưa status IN_TRANSIT, không phát lệnh nào).
3. Trước fix: nút Xóa lô trên /shipments/:id disabled/red-line từ chối dù BE
   nhận delete; DELETE API 200 nhưng FE chặn.
4. Sau fix: nút armed → confirm lý do bắt buộc → toast "Đã xóa lô hàng." →
   GET 404; DB `shipments.deleted_at` set + audit.

## Expected matrix (pinned)

| Scenario | Role | Expected |
|---|---|---|
| IN_TRANSIT, 0 live trips (stale) | admin | DELETE /shipments/cus-workspace/:id → 200, GET → 404 |
| IN_TRANSIT, 0 live trips | CUS (tiepvv) | DELETE → 200 |
| Live trip tồn tại (phát lệnh) | admin / CUS | DELETE → 409 + message luật |
| Bất kỳ | DISPATCHER (dieuvan) | DELETE → 403 (cả lô stale lẫn phát lệnh) |
| Bất kỳ | OPS | 403 + không có nút ở mọi mặt |
| FE seed | mọi vai | `hasDispatchedLegs = hasLiveTrips` — status KHÔNG tham gia |

## Pins

- FE unit: `frontend/src/features/shipments/create/shipment-edit-prefill.test.ts`
  — "SIL-688 r4: trạng thái lô KHÔNG bao giờ chặn" (DISPATCHED/IN_TRANSIT/
  COMPLETED + 0 live trips ⇒ seed false; live trip ⇒ true).
- API probe: `qa/2026-11-07-k9-688-693/api-probe.mjs` (10/10 — matrix trên
  fixture thật 779166..779171).
- UI DRIVEN: `qa/2026-11-07-k9-688-693/ui-drive-688.mjs` + shots + driver log.
