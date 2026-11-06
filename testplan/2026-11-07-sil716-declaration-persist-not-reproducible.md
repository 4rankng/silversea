# SIL-716 — Số tờ khai CUS nhập không lưu (không tái hiện trên trunk 25dc1a2e)

- **Case ID:** SIL-716-REG-1
- **Ticket:** plan.tingting.vip SIL-716 (internal id 836) — feedback Tiếp Vũ 17/10, chuyển 07/11; ảnh các lô Long Minh/LOG COM "Chưa có tờ khai" dù đã nhập
- **Surface:** BE persist + FE payload, cả 2 đường ghi tờ khai (per-cont và lot-level)
- **Verdict:** **KHÔNG TÁI HIỆN** trên trunk — mọi đường ghi persist đầy đủ (API 200/201 + DB + reload).家族 lỗi này đã được sửa bởi loạt rework trước đó: SIL-521 (per-cont chỉ theo cont), SIL-659 (số cont + tờ khai 1 command), SIL-503 (lot-level ride shipment-declaration API), SIL-701 (per-cont tại create), SIL-660 (LCL lot-level declaration entity), SIL-335 (hãng tàu gõ tay lưu DB). Kết luận làm việc: báo cáo 07/11 khớp build prod cũ hơn trunk — cần deploy, không phải code fix thêm.

## Reproduction (probe)

`testplan/qa/scripts/2026-11-07-sil716-declaration-persist.mjs` — mirror đúng chuỗi API mà FE CUS dùng
(`use-cus-detail.saveDocuments`, `shipmentClient.updateCusShipmentContainerLine`, `createShipmentDeclaration`/`updateShipmentDeclaration`):

1. **FCL container row:** POST `/shipments/cus-workspace/:id/containers/:cid` `{expectedShipmentVersion, declarationNumber}` → 200, payload giữ nguyên field (FE `ShipmentContainerLedger.tsx` documents editor gửi `declarationNumber`; BE `shipmentCusContainerLineUpdateSchema` nhận; service `cus-shipment-workspace-writes.service.ts:554` persist + auto-copy sibling rỗng).
2. **Lot-level row (LCL):** POST `/shipments/:id/declarations` `{declarationNumber}` → 201; read join `distinctDeclarationNumbers(containers, declarations)` trả về.
3. **Lot-level update:** PUT `/shipments/:id/declarations/:did` → 200 + reload còn số mới.

## Observed (trên trunk, backend :3102 = worktree fix/r1-704-716-705)

- 7/7 check PASS — evidence: `qa/2026-11-07-lane-r1/sil716-api-t1.log`
  - container-line: reload CUS detail + `shipment_containers.declaration_number` đều còn đúng giá trị.
  - lot-level: reload summary.raw.declarationNumber + `shipment_declarations.declaration_number` còn; PUT cập nhật số mới persist.
- FE payload audit (code-read, không sửa file lane khác): `ShipmentContainerLedger.tsx:569` gửi `declarationNumber`; `DispatchDeclarationCell.tsx:120` gửi `{expectedShipmentVersion, declarationNumber}` — không có surface nào drop field.

## Expected

- Nhập tờ khai (FCL lẫn LCL) → lưu → reload còn nguyên giá trị (đã đúng trên trunk).
- Nếu prod vẫn mất: kiểm tra build prod đã chứa commit SIL-521/659/503/660/701 chưa — không phải lỗi code trunk.
