# SIL-693 r2 + SIL-688 r2 — API-level evidence (rung 2, DB/API VERIFIED)

Stack: worktree BE :3003 (branch fix/sil-693r2-688r2-fe, base 3efeffb9) trên shared dev DB silversea :5441.
Accounts: admin (Quản trị), ketoan (Kế toán) — password Abc123 (testplan/testaccounts.txt).

## Setup (đều qua API chuẩn, idempotency-key riêng)
- Lô xóa-test `779058` = SHP-2611-00306: POST /api/shipments/quick (admin) → 201. LCL PENDING, chưa khóa, chưa fulfillment.
- Lô unpriced `779059` = SHP-2611-00307: POST /api/shipments/quick (admin) → 201; POST /api/shipments/779059/lock (ketoan) → 201 — freeze mới ghi `freightPricingBasis` SKIP (NO_ROUTE), `freightAuto` null.

## CASE A — lô chưa định giá: guard 409 remedy nguyên văn (SIL-693)
POST /api/shipments/debit-notes [779059] (ketoan) → **409**
```json
{"error":"Cước vận tải của lô SHP-2611-00307 chưa được định giá trong bản khóa lô (định giá tự động bị bỏ qua: NO_ROUTE). Không thể xuất Debit Note thiếu cước — hãy xác định giá cước thu khách trên màn hình Chi phí - Quyết toán (chọn loại xe tính cước hoặc nhập giá), khóa lại lô rồi xuất."}
```

## CASE B — selection đã nằm trong Debit Note: overlap 409 TRƯỚC actor-collision (SIL-693 r2 BE)
POST /api/shipments/debit-notes [779038] (admin — CÙNG actor đã xuất note 15) → **409** + `overlappingLotCodes: ["SHP-2611-00299"]`.
Trước fix: cùng actor + cùng selection → runIdempotent replay/trả doc 15 (hoặc, với actor khác, 409 "Khóa giao dịch này thuộc về người thực hiện khác" KHÔNG có overlappingLotCodes). Sau fix: pre-check `assertLotsNotInIssuedDebitNote(db, …)` chạy trước `runIdempotent` → 409 overlap thân thiện luôn thắng.

## CASE C — selection mới (chưa xuất) vẫn phát hành 201 (SIL-693 r2 boundary)
POST /api/shipments/debit-notes [106] (ketoan, lô 106 SHP-2610-00046 — legacy snapshot, chưa thuộc note nào) → **201 {"id":17}**.
(Lô 208 bị loại khỏi CASE C sau khi đối chiếu DB: 208 đã nằm trong note 4 — probe [208] trả 409 overlap là ĐÚNG luật.)

## SIL-688 r2 — detail wire `hasLiveTrips`
GET /api/shipments/779038 (admin): `hasLiveTrips: false` + `carrierAssignments: 1` — cặp fact chứng minh regression cũ: proxy fulfillment-plan đếm ≥1 (nút xóa bị disabled vĩnh viễn) trong khi luật BE (trip sống = 0) cho phép xóa.
GET /api/shipments/779059: `hasLiveTrips: false`.
Query BE softDeleteShipment (shipment-lifecycle.service.ts:463-473): chặn khi có trip sống (deleted_at null + status != CANCELED, qua trips.shipment_id HOẶC fulfillment) — field mới phản chiếu đúng luật đó (shipment-detail-reads.service.ts `shipmentHasLiveTrips`).

## UI DRIVEN (rung 3) — qa/2026-11-06-lane-693r2-688r2/
Driver: `ui-drive.mjs` (puppeteer headless, token inject theo puppeteer-spa-auth), log `ui-driver.log`, exit 0.
- 01-debit-board-loaded-1440.png → board /shipments-debit?customer=1 (LONG MINH), merge mode.
- 02-unpriced-remedy-toast-1440.png → toast CASE A nguyên văn (không còn toast chung).
- 03-overlap-in-note-toast-1440.png → toast "Các lô đã nằm trong Debit Note đã xuất: QA-MC-B" (CASE B qua FE).
- 04-debit-board-390.png → board 390px.
- 05-lcl-delete-armed-1440.png → /shipments/779058 nút "Xóa lô" armed (`disabled:false`, aria đúng).
- 06-lcl-deleted-toast-1440.png → toast "Đã xóa lô hàng." sau confirm lý do.

## DB side-effect (delete thật)
```sql
select id, shipment_code, deleted_at, updated_by, version from shipments where id in (779058, 779059);
-- 779058 | SHP-2611-00306 | 2026-11-06 14:47:50.208 | 61 (admin) | 2
-- 779059 | SHP-2611-00307 | (null)                 | 61         | 1
select count(*) from shipment_containers where shipment_id = 779058;  -- 0 (container đi cùng lô)
```

## Not covered
- Vai DIEU_VAN/CUS bấm xóa thật (admin drive; quyền xóa 3 vai đã pin bằng test registry lane trước, BE law không đổi trong lane này).
- 768px (không drive; thay đổi không đụng layout — toast text + gate state).
- Luồng re-download cùng selection same-actor TRƯỚC fix vs SAU fix trên staging (staging đã dọn lô test; so sánh dựa trên code-read runIdempotent + HTTP probe local).
