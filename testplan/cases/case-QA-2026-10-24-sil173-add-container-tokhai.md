# Case QA-2026-10-24-SIL173 — Thêm container không copy số tờ khai cấp lô (FB-148)

Ticket SIL-173 (board plan.tingting.vip, id 203). Surface: /shipments/:id (FCL)
→ ledger container → "Thêm container" → cột "Số tờ khai" của dòng mới.

## Root cause

`addCusShipmentContainer` chỉ inherit tờ khai từ SIBLING container rows
(`inheritLotDefault`), không kéo số tờ khai CẤP LÔ (entity
`shipment_declarations`). Lô có tờ khai mức lô mà các dòng per-cont chưa mang
số (lô tạo trước SIL-166, hoặc số chỉ nằm ở entity lô) → dòng thêm sau sinh ra
trống. Luật CUS-05 (SIL-166 da2eb512, `syncDeclarationOntoEmptyContainers`):
số tờ khai cấp lô copy vào MỌI dòng container trống — kể cả dòng thêm sau.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL173-R1 | Lô FCL có tờ khai cấp lô R41B2TK01, các dòng hiện tại đã mang số → "Thêm container" | Dòng MỚI có Số tờ khai = R41B2TK01 ngay trong response (không cần F5) |
| SIL173-R2 | Lô có tờ khai cấp lô NHƯNG còn dòng cũ trống → "Thêm container" | Fan-out điền MỌI dòng trống (cả dòng cũ lẫn dòng mới); response khai báo `declarationSync.updatedContainerIds` |
| SIL173-R3 | Container đã có số riêng (divergence) | KHÔNG bị ghi đè (luật FB-109 never-overwrite giữ nguyên) |
| SIL173-R4 | Lô KHÔNG có tờ khai cấp lô, sibling có số per-cont | Dòng mới vẫn inherit sibling như cũ (card 181026185900 không hồi quy) |
| SIL173-R5 | FE stale cache | Add mà fan-out đụng dòng khác ngoài dòng mới → toàn detail refetch (onDetailStale), toast nêu số dòng được copy |
| SIL173-R6 | Wire schema | `shipmentCusContainerAddResultSchema` chấp nhận `declarationSync?` (cùng shape line-update) |
| SIL173-R7 | Version | 1 lần bump cho cả add (projectShipmentScheduleAndVersion) — fan-out nằm cùng tx, không bump riêng |

## Rule (nguồn)
CUS-05 ruling 22/10 (SIL-166 da2eb512); FB-109 never-overwrite predicate
nguyên văn (`IS NULL OR btrim=''`).

## Verify
- Unit: `backend/src/tests/unit/cus-container-add-tokhai-sync.test.ts` (wire +
  static wiring) ; FE: `CusContainerLedger.add-tokhai.test.tsx`
- Probe (rung 2): `qa/scripts/2026-10-24-sil173-add-container-tokhai-probe.mjs`
