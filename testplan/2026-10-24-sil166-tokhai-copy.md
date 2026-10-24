# SIL-166 — Số tờ khai không copy theo lô trên Tổng quan lô hàng CUS (regression note)

Case IDs: TC-SIL166-01 (tạo lô kèm tờ khai → cont nhận số),
TC-SIL166-02 (thêm tờ khai mức lô trên lô có sẵn → chỉ dòng trống nhận),
TC-SIL166-03 (divergence — cont đã có số không bị ghi đè),
TC-SIL166-04 (FB-109 inline edit per-cont vẫn sync — regression chặn).

Spec: ruling CUS-05 22/10 (cards 221026095229/221026095329 — "inline edit
@Chi tiết lô + nhập 1 cont sync mọi cont cùng lô") + ngôn ngữ khách SIL-166
(Zalo 24/10): "lẽ ra phải lấy số tờ khai này copy vào tất cả các dòng số tờ
khai **trống** của lô". REQ-21 verify-fail A1 ×2 đã đóng — tính năng từng
ship xanh; SIL-166 là lá Class còn sót: 2 đường nhập **mức lô** không chạm
`shipment_containers`.

## Root cause (audit 24/10, trước khi sửa)

| Đường nhập tờ khai | Ghi vào | Cont rows |
|---|---|---|
| Inline edit cột @ledger (FB-109, CUS-05) | `shipment_containers` + fan-out sibling trống | ✅ sync |
| Tạo lô (`POST /api/shipments/quick` combined, FE gửi `declarationNumber`) | chỉ `shipment_declarations` (upsert chạy TRƯỚC khi insert containers) | ❌ sinh `NULL` |
| Sửa thông tin lô → Chứng từ (`POST/PUT /api/shipments/:id/declarations`) | chỉ `shipment_declarations` | ❌ giữ `NULL` |

CUS ledger (drawer Tổng quan + Chi tiết) render per-cont
(`cus-workspace-builders.service.ts` dòng containers: `declarationNumber:
container.declarationNumber`) → cột trống dù dòng lô trên list Tổng quan
hiện số (summary gộp 2 nguồn — `distinctDeclarationNumbers`). Không phải FE
render sai; là BE thiếu sync trên 2 đường mức lô.

## Reproduction / expected behavior

- TC-SIL166-01 — tạo lô NHẬP 3 cont kèm `declarationNumber` = TK166-XXXX:
  mở CUS workspace (`GET /api/shipments/cus-workspace/:id`) THEN cả 3
  container đều `declarationNumber = TK166-XXXX`; DB
  `shipment_containers.declaration_number` = TK166-XXXX trên mọi dòng.
- TC-SIL166-02 — lô 2 cont (không tờ khai) → cont #1 nhập số riêng qua
  inline edit → thêm tờ khai mức lô `POST /api/shipments/:id/declarations`
  THEN cont #2 (trống) nhận số mức lô, cont #1 GIỮ số riêng (divergence).
- TC-SIL166-03 — sửa số mức lô `PUT .../declarations/:id` sang số mới THEN
  chỉ dòng trống nhận số mới; dòng đã có số không đổi. Version lô tăng đúng
  1 lần khi có dòng được ghi (luật `copyCusShipmentContainerDeclaration`).
- TC-SIL166-04 — inline edit per-cont (FB-109) vẫn sync sibling trống và
  KHÔNG ghi đè sibling đã có số — behavior 22/10 không hồi quy.

## Fix layer

BE sync tại shared owner của declaration writes:
`backend/src/services/shipment-documents.service.ts` — fan-out never-overwrite
(predicate `IS NULL OR btrim(...) = ''`, same FB-109) gọi từ
`upsertShipmentDeclaration` (đường quick-edit + thêm tờ khai) và từ
`createShipmentIdempotent` sau reconcile (đường tạo lô combined — upsert chạy
trước khi containers tồn tại). FE không đổi.

## Verification

- Probe: `node qa/scripts/2026-10-24-sil166-tokhai-lot-sync-probe.mjs`
  (LOCAL `make dev`, API :3002, DB `ss-prod-db`). Repro-first: chạy trên code
  CHƯA fix → TC-01/02 FAIL; sau fix → 4/4 PASS + DB proof.
- FE scoped vitest (surface declaration, không đổi nhưng chặn hồi quy):
  `CusContainerLedger.declaration.test.tsx`,
  `use-cus-detail.declarations.test.tsx`, `cusQuickEditModel.test.ts`.

## Residual (ngoài scope, ghi rõ)

- `PUT /api/shipments/:id/containers` (reconcile workboard) insert dòng mới
  sinh `declarationNumber` NULL dù lô có số ở declaration entity — case hẹp
  (lot mà mọi dòng trống + thêm cont qua bulk reconcile), cần owner quyết
  trước khi mở rộng luật inherit sang bulk path. Đường add-cont CUS chính
  (`addCusShipmentContainer`) KHÔNG bị — đã có `inheritLotDefault` từ sibling
  (card 181026185900), và sau fix sibling sẽ mang số.
- Lô cũ đã tạo trước fix (cont NULL, entity có số) không backfill — khách
  lưu lại tờ khai qua Sửa thông tin lô sẽ copy xuống ngay sau fix. Backfill
  data cần owner instruction riêng.
