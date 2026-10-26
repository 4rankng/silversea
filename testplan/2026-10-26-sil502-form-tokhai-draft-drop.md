# SIL-502 — Tạo lô qua FORM với Số tờ khai → số rơi khi lưu

- **Ticket:** SIL-502 (id 564, board SIL) — QA fail 26/10 build 52ee6443: tạo lô qua form với Số tờ khai QA26A502TK01, lưu xong API không có declarationNumber (declarations [], container null); Tổng quan hiện Bill + "Chưa có tờ khai".
- **Root cause:** ô nhập chip Số tờ khai trong Nhận diện lô chỉ commit qua Enter / dấu phẩy / dán có dấu phân cách. Draft chưa commit nằm trong state cục bộ (`declDraft`); nút lưu đọc `form.declarationNumbers` — nên "gõ số rồi bấm thẳng Tạo lô hàng (không Enter)" tạo lô KHÔNG số, không báo lỗi. Probe tái hiện: payload `declarationNumber: null` (trước fix) vs `"QA26A502TK01"` (sau fix).
- **Fix:** `onBlur` commit pending draft qua cùng `commitDeclarations` (dedupe + notice) — ShipmentCreateIdentitySection.tsx. Bulk textarea giữ nguyên hợp đồng Xong/Hủy (blur phải là discard).

## Case SIL502-R1 — Gõ số rồi bấm lưu (không Enter)

1. `/shipments/new` → chọn khách hàng (FCL mặc định).
2. Gõ `QA26A502TK01` vào ô Số tờ khai, KHÔNG nhấn Enter.
3. Bấm **Lưu nháp** (hoặc Tạo lô hàng — blur do mousedown phải commit trước).
4. **Expected:** payload POST `/shipments/quick` mang `declarationNumber: "QA26A502TK01"`; sau tạo, GET detail có `declarations[0].declarationNumber` = số đã nhập; container dòng đầu được stamp cùng số; Tổng quan cột CHỨNG TỰ hiện số.

## Case SIL502-R2 — Commit bằng Enter + blur không nhân đôi

1. Gõ số → Enter (chip hiện) → click ra ngoài.
2. **Expected:** đúng 1 chip; payload không trùng số; gõ lại đúng số đã commit rồi blur → dedupe vẫn 1 chip.

## Case SIL502-R3 — Regression: dây tạo lô 1 tờ khai chuẩn (normalize-all là ĐÚNG)

1. Tạo lô FCL 1 tờ khai + N container qua form (commit chip).
2. **Expected:** shipment_declarations 1 row (scope SINGLE) + MỌI container trống được stamp số (create-path `syncDeclarationOntoEmptyContainers`).

## Bằng chứng rung (26/10, worktree fix-498-502-tokhai)

- **Rung 2 — DB/API VERIFIED (BE @ HEAD + main 52ee6443 chạy local :3002):** POST `/api/shipments/quick` payload form (customerId 2, FCL, blNumber QA26A-502-PROBE, declarationNumber QA26A502TK01, 1 cont) → lot 347: `shipment_declarations` row (scope SINGLE) + container 364 stamped; GET `/api/shipments/347` trả `declarations[]` + `containers[].declarationNumber`; GET `/api/shipments` list item `declarationNumber` = số; GET `/api/shipments/cus-workspace/347` `summary.declarationNumbers = ['QA26A502TK01']`. → Dây BE + nguồn đọc ở HEAD HEALTHY; fail QA không tái hiện được qua dây này.
- **Rung component (vitest):** probe trước fix `PAYLOAD2 null` → pin sau fix 4/4 pass (`ShipmentCreateWorkspace.sil502-declaration-draft.test.tsx`).
- **Rung 3 — UI DRIVEN: CHƯA drive** (cần build deploy verified-hash; xem "Chưa cover").

## Gates (qa/2026-10-26-sil498-502-tokhai/)

- Scoped vitest `src/features/shipments/create` 36 file / 271 / 271 pass — `sil502_scoped-vitest-create.log`
- FE `tsc -b` 0 — `sil502_fe-tsc.log` · root `pnpm lint` 0 error (1 warning cũ CustomersConfigPage, ngoài vùng đụng) — `sil502_root-lint.log` · `tsgo --noEmit` 0 — `sil502_tsgo.log` · eslint file đụng 0 — `sil502_eslint.log`
- Independent code-review: APPROVE (đã áp khuyến nghị selector theo role + case dedupe).

## Chưa cover

- Rung 3 trên môi trường QA thật: QA cần verify build hash qua `/api/health` (`buildHash`) trước khi repro — dây HEAD đã chứng minh healthy nên fail trên build khác = build cũ/khác main.
- Trình duyệt thật IME Telex blur giữa chừng (commit partial — data-preserving, chấp nhận).
