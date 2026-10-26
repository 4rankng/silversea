# SIL-503 — /shipments-detail hàng LẺ: SỐ TỜ KHAI + PHÂN XE click-to-edit (FCL-cell parity)

Ticket: SIL-503 (board id 565) · Branch: `fix-lcl-cell-edit` (off main fb031edb) · 2026-10-26

## Change (FE-only — không đụng backend/shared, khác file với lane 502)

1. **SỐ TỜ KHAI (lot row)** — cell mở SHARED documents editor như FCL:
   - `use-cus-detail.startEdit`: lot row (id âm, không container line) mở phiên
     documents trên pseudo line READ-ONLY (`lotPseudoLine`, cusDetailModel); mọi
     mode khác bị từ chối cho lot (documents-only law).
   - `saveDocuments` lot branch: Bill/Booking/Nhập/Xuất/Hãng tàu → PATCH
     `PUT /shipments/:id` (như cũ); tờ khai → shipment-declaration API theo diff
     `lotDeclarationWrite` (PUT row hiển thị metadata verbatim / POST khi lô
     chưa có row / PUT null khi xoá; noop khi echo).
   - Editor chrome lot-aware: heading "Lô <bill>" (không còn "Container số 1"),
     hint "Số tờ khai lưu theo LÔ hàng lẻ…".
2. **PHÂN XE (lot row)** — BKS thực click-to-edit theo house pattern FB-093a:
   - Trigger "Sửa BKS thực" (allocated) / "Nhập BKS thực" (state "Chưa phân xe")
     → editor combobox "BKS thực" → `POST /shipments/lcl/truck`
     `{shipmentId, actualTruckNo}` + optimistic overlay tự-heal.
   - Composite "Nhà xe - BKS Thực: X" GIỮ STATIC TEXT (giữ contract FB-093a).
3. **FCL rows**: byte-for-byte unchanged (vitest pin + drive step c).

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Cell SỐ TỜ KHAI lot row mở editor (heading LÔ + hint lot) và lưu số | UI DRIVEN | `ui-declaration-editor-open.png`, `ui-declaration-after-save.png`, DOM assert `declaration_cell_after` = `…: TK-SIL503-745946` (ui-driver.log, ui-assertions.json), DB row `shipment_declarations` id 12 shipment 342 (db-proofs.txt) | role khác CUS (DISPATCHER bị READ_ONLY documents theo shipmentFieldAccess — unit pin ở ledger suite); mobile viewport; staging env |
| PHÂN XE lot "Chưa phân xe": nút "Nhập BKS thực" mở editor + lưu | UI DRIVEN | `ui-bks-thuc-editor-open.png`, `ui-bks-thuc-after-save.png` (composite `— - BKS Thực: 29H-503.55` + 2 trigger), DOM assert `vehicle_cell_after`, DB `shipments.actual_truck_no = 29H-503.55` version 1→2 (db-proofs.txt) | role DISPATCHER/ADMIN (endpoint cho phép — unit pin FB-093a continuing); allocated-lot path qua UI thật (đã pin trong vitest `sil503` suite); mobile viewport |
| FCL row giữ nguyên contract (editor per-cont + hint từng container) | UI DRIVEN (open+cancel, không write) | `ui-fcl-editor-open.png`, `fcl_editor_heading` = `…SILU5001029`, `fcl_declaration_hint` chứa "từng container" (ui-driver.log); DB 318 không đổi (db-proofs.txt) | không có — behavioural parity pinned ở vitest + drive |
| 2 loại hàng cùng board (FCL + LCL row) | Unit (vitest DOM) | `ShipmentContainerLedger.sil503-lcl-cell-edit.test.tsx` describe "2 loại hàng cùng board" 3 test | drive chung 1 trang thật (2 fixture khác khách hàng, board search tách) |

## Gates

| Gate | Kết quả |
|---|---|
| Scoped vitest (detail 5 files + cus hook/model suites) | 148/148 pass |
| Full FE vitest | 5557/5558 — 1 fail PRE-EXISTING: `ShipmentsPage.density.test.ts` (SIL-485 `.cus-lot-table` CSS) — verify fail tại base fb031edb bằng stash (không phải của lane này) |
| `cd frontend && npx tsc -b` | 0 lỗi |
| `cd frontend && npx tsgo -b` | 0 lỗi |
| `npx eslint` scoped 8 file đổi | 0 lỗi |
| `make build` | success (cũng cấp dist/assets cho numeric-identity suite) |
| Backend/shared | KHÔNG đổi — không chạy BE gates |

## Artifacts

- `ui-driver.log` — driver steps + exit (DONE).
- `ui-assertions.json` — DOM assertions trước/sau.
- `ui-*.png` — 7 screenshots @1440×900.
- `db-proofs.txt` — psql outputs (local dev DB qua docker ss-prod-db).
- `sil503-ui-drive.mjs` — driver (puppeteer, token pre-inject, login `cus` từ
  testplan/testaccounts.txt, fixture tự tạo qua `POST /api/shipments/quick`).
