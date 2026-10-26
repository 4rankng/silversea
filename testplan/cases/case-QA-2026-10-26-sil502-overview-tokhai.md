# Case QA-2026-10-26-sil502 — Tạo lô có tờ khai → Tổng quan cột CHỨNG TỰ

- **Ticket:** SIL-502 (board id 564, [CUS][P0])
- **Report:** CUS 26/10 — tạo lô có tờ khai nhưng Tổng quan cột CHỨNG TỰ chỉ Bill + "Chưa có tờ khai" (ảnh 7 lô).
- **SPEC (comment 1886):** (a) repro LOCAL quick-create → kiểm tra BE shipment_documents; (b) BE ok → fix FE cột CHỨNG TỰ đọc nguồn đúng (481/483 nghi đổi nguồn); (c) BE mất → khôi phục wire quick-create→documents (diff f4cd3691/0e8cd190); (d) regression test tạo lô có tờ khai → overview hiện.

## Repro steps (local, role CUS `cus`, branch fix-overview-tokhai @ fb031edb)

1. `make dev` stack tương đương: backend :3012 (tsx, code branch này, DB local silversea @ :5441), frontend :7185 (vite, proxy /api → :3012).
2. Đăng nhập `cus` → `/shipments/new` → chọn Khách hàng, Hình thức "Nhập khẩu", Số Bill, nhập Số tờ khai (chip strip, Enter), 1 container hợp lệ ISO 6346 + loại + nhà máy/tuyến/cảng/ngày giờ → "Tạo lô hàng".
3.Sau redirect `/shipments/:id` (view) → quay Tổng quan `/shipments` → đọc cell CHỨNG TỰ của lô vừa tạo.

## Expected

- BE: 1 row `shipment_declarations` (scope SINGLE) + `shipment_containers.declaration_number` được fan-out (FCL).
- FE: cell CHỨNG TỰ = Bill + các số tờ khai (join), KHÔNG phải "Chưa có tờ khai".

## Result trên trunk fb031edb — KHÔNG tái hiện được

| Bước | Kết quả | Bằng chứng |
|---|---|---|
| API quick-create (FCL, declarationNumber) | BE OK: declarations row + container stamp | lot 317: `shipment_declarations` id 5 `502-REPRO-TOKHAI`; container 344 stamp |
| API quick-create (LCL, không container) | BE OK: declaration entity; list trả union | lot 319: list `declarationNumbers: ['502-LCL-TOKHAI-…']` |
| LIST `/shipments/cus-workspace` | `declarationNumbers` đầy đủ | lot 317/318/319 |
| DETAIL `/shipments/cus-workspace/:id` | `summary.declarationNumbers` đầy đủ | lot 317 |
| UI flow (form thật) | Chi tiết hiện tờ khai; Tổng quan cell = Bill + tờ khai | lot 318, `qa/2026-10-26-sil502/after-create-overview.png`, DOM text `OVERVIEW_SHOWS_DECL: true` |

## Điều tra theo SPEC

- **(a)** BE `shipment_declarations` CÓ record sau quick-create → không phải mất wire.
- **(b)** FE `CusShipmentRow` đọc `item.declarationNumbers` (fallback `declarationNumber`) — đúng nguồn union (card 20260921_3); render UI DRIVEN đúng.
- **(c)** Diff `f4cd3691` (SIL-481) chỉ tháo panel Tờ khai khỏi DETAIL page (component giữ nguyên file chờ re-host), `0e8cd190` (SIL-483) chỉ drawer; toàn bộ đường declaration (create service, documents service, builders, reads, CusShipmentRow, workflow, client) **byte-identical** giữa 7b7180fe (base stack local đang chạy) và HEAD (`git diff 7b7180fe..HEAD` rỗng cho các file này).
- Wire read union có từ 3c9ea9e7 (21/09), per-cont 68c1a32d (13/10), sync create da2eb512 (24/10) — đều trong base.

## Kết luận + hướng xử lý tiếp

- Trunk healthy: create→documents→list→render nguyên vẹn (rung 3 verified). Không có code fix cần thiết trên trunk; branch này thêm **regression net** theo (d):
  - BE unit `shipment-overview-declaration-wire.test.ts`: pin quick-create schema nhận declarationNumber + containers; list item giữ `declarationNumber` + `declarationNumbers`; drawer summary == item schema (một nguồn).
  - FE `CusShipmentRow.cus-cards.test.tsx`: cell CHỨNG TỰ join union / fallback "Chưa có tờ khai" / fallback `declarationNumber`.
  - FE `use-shipment-create-workflow.test.tsx`: payload root mang declarationNumber; initialDeclarationId được tin (không POST trùng); legacy snapshot không id được heal bằng 1 POST; slot 2+ đi entity POST riêng.
- 7 lô trong ảnh nằm ngoài DB local → nghi deployed build/entry channel khác (staging/prod: không được đụng theo §2). Nếu vẫn thấy trên staging/prod: gửi mã lô (Số Bill/shipment code) để đối chiếu, hoặc kiểm tra build hash môi trường; các lô tạo qua import/legacy API không mang declarationNumber sẽ đúng là "Chưa có tờ khai" (dữ liệu, không phải bug wire).

## Gates

- BE scoped unit: `cd backend && pnpm test:unit` (không đổi source BE).
- FE scoped: `npx vitest run src/features/shipments/cus src/features/shipments/create` + full create/cus suite.
- `tsgo --noEmit` (FE) + `tsc --noEmit` (BE) = 0 lỗi; eslint files đụng = 0.
- Evidence: `qa/2026-10-26-sil502/` (driver scripts, screenshots, DOM assertions, gate logs).
