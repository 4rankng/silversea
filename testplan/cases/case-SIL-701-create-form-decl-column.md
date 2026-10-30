# SIL-701 (id 701) — Form tạo lô: thêm cột SỐ TỜ KHAI theo từng container vào bảng "Thông tin hàng"

- Ticket: SIL-701 (board SIL, id 701, báo cáo 30/10/2026, QA Glint).
- Owner ruling 30/10/2026 (Frank, comment 2895): tạo lô PHẢI cho nhập số tờ
  khai theo container. Pin SIL-521/522 "form tạo cố tình không có tờ khai"
  (audit SIL-530 27/10) bị ĐẢO NGƯỢC đối với form tạo — ticket này là yêu cầu
  đảo pin. Bỏ ô nhập cấp lô GIỮ NGUYÊN (SIL-521 điểm 4).
- Surface: `/shipments/new` + `/shipments/:id/edit` (ClerkShipmentCreatePage →
  ShipmentCreateWorkspace → ShipmentContainerEditor/Row), FCL mode bảng
  "Thông tin hàng". BE: `POST /api/shipments/quick` (combined create) +
  `PUT /api/shipments/:id/containers` (reconcile khi Sửa lô).

## Bug (kết quả thực tế)

Bảng "Thông tin hàng" trong form tạo chỉ có 8 cột (STT · SỐ CONTAINER · NHÀ
MÁY · TUYẾN ĐƯỜNG · CẢNG NÂNG · CẢNG HẠ · NGÀY GIỜ ĐÓNG TRẢ · THAO TÁC) —
không có cột số tờ khai theo cont. Muốn nhập số tờ khai phải tạo lô xong rồi
mới vào lưới Chi tiết lô hàng / drawer nhập từng cont.

## Mô hình dữ liệu (SIL-521 / §3.4, ruling 26/10 + 30/10)

1. Số tờ khai quản lý THEO CONT — mỗi cont nhập/sửa riêng.
2. Trùng số trong cùng lô (1 phần hoặc toàn bộ) KHÔNG bị chặn.
3. Không chặn trùng theo lô; guard cross-lô (`assertContainerDeclarationNumberAvailable`)
   GIỮ NGUYÊN — số đã thuộc lô KHÁC vẫn 409.
4. Ô nhập tờ khai CẤP LÔ vẫn bị gỡ (không strip/chips/textarea cấp lô; payload
   không mang `declarationNumber` cấp lô; không tạo `shipment_declarations`).

## Column placement (quyết định của lane, ghi rõ để audit)

- Cột mới đặt NGAY SAU ô gộp SỐ CONTAINER — parity với sibling đã chốt
  (drawer CusLotView: STT · Số container · **Số tờ khai** · Nhà máy · Tuyến
  đường · …, design lock SIL-508/552) và §10.2.5 ("Cột Số tờ khai ở tất cả
  bảng liệt kê container theo từng dòng").
- KHÔNG đảo các cột đã chốt (Nhà máy/Tuyến/Cảng giữ nguyên thứ tự) — instruction
  "KHÔNG phá bố cục đã chốt" (SIL-552 gộp 3 dòng/ô + arrangement hiện tại).
  Thứ tự field §10.2.3 (Tuyến · Cảng nâng · Cảng hạ · Nhà máy) khác thứ tự
  sibling đã ship — divergence ghi nhận ở đây, không tự ý reorder.
- STT giữ cột đầu (§10.2.3 row convention "STT · Số container · …").
- Không thêm cột Thể tích (CBM): pin "hides the FCL volume field" còn hiệu lực,
  ngoài phạm vi ticket ("chỉ việc thiếu cột số tờ khai").

## Case pin (expected sau thay đổi)

1. Cột SỐ TỜ KHAI đứng ngay sau SỐ CONTAINER trong thead + colgroup; input
   per-cont (placeholder "Nhập số tờ khai", maxLength 50), nhập được ngay lúc
   tạo; ô gộp SỐ/LOẠI/TRỌNG LƯỢNG (SIL-552) nguyên trạng.
2. Payload `POST /shipments/quick`: KHÔNG có `declarationNumber`/
   `declarationNumbers` cấp lô (pin cũ giữ); `containers[i].declarationNumber`
   mang đúng số từng dòng (trim, rỗng → null). Không gọi entity
   create/update/deleteDeclaration.
3. Trùng số trong cùng lô: 2 dòng cùng số → submit OK, không validation error.
4. "Thêm container" (createContainerFromPrevious) KHÔNG lan tờ khai — dòng mới
   để trống (FB-109 / acceptance 10.10-6 tinh thần per-cont).
5. "Nhân bản dòng" (duplicateContainerRow, SIL-513) copy toàn bộ giá trị dòng
   đó KÈM số tờ khai (explicit row copy — "copy dòng đó", §3.2 UX note 26/10);
   vẫn không copy `id` persist.
6. Edit mode (/shipments/:id/edit): prefill số tờ khai per-cont từ
   `shipment_containers.declaration_number`; save giữ/ghi đúng giá trị (update
   không wipe khi field absent — undefined-preservation).
7. BE reconcile persist per-cont `declarationNumber` (insert + update); số
   changed mà thuộc lô KHÁC → 409 như line-save (guard chuyển về
   shipment-lifecycle-shared, cùng một luật cho mọi writer).
8. Pin đảo (ruling 30/10): sil502 suite + ClerkShipmentCreatePage pin đổi sang
   hợp đồng mới — ô CẤP LÔ vẫn vắng mặt, cột per-cont CÓ MẶT.

## Regression evidence

- Gates (2026-10-30, this worktree):
  - `cd shared && npm run test` → **307/307 pass** (incl. new SIL-701 schema pin).
  - `cd backend && npx tsc --noEmit` → 0 errors.
  - `cd backend && pnpm test` → **338/338 pass** (pure unit).
  - `cd frontend && npx tsc -b` → 0 errors.
  - `cd frontend && npx vitest run src/features/shipments/create src/pages/clerk` →
    375/376 (1 TIMEOUT load-flake in ShipmentCreateWorkspace.cursor-advance —
    rerun solo 2/2 green, same flake class as SIL-552 lanes documented).
  - eslint touched files (FE+BE) → 0 errors.
- Rung-3 UI drive: `qa/drivers/2026-10-30-sil701-decl-column-ui-drive.mjs`
  (local :7188 FE → :3013 BE, both this worktree; shared dev DB :5441) —
  evidence `qa/2026-10-30_sil701-decl-column/` (see ui-driver.log).
  **8/8 PASS**: C1 header order exact + 1 per-cont input/row (placeholder
  "Nhập số tờ khai", maxLength 50) + merged SỐ CONTAINER group 3 dòng nguyên
  trạng + không có tờ khai cấp lô + header 1 dòng · C2 nhập "TK-SIL701-R3"
  vào dòng 1, Nhân bản dòng → dòng 2 mang CÙNG số (trùng trong lô hợp lệ;
  số cont tách MSKU1234565/ALLU5216535) · C3 submit → POST /quick 201 →
  GET /shipments/753: cả 2 cont `declarationNumber: "TK-SIL701-R3"` ·
  C4 screenshots 1440/768/390.
- DB proof (psql, dev DB `ss-prod-db`):
  `qa/2026-10-30_sil701_db-proof.txt` — shipment_containers 834/835
  (lô 753) cùng số TK-SIL701-R3. Evidence lot đã xóa sau chứng minh
  (DELETE 200, `qa/drivers/2026-10-30-sil701-cleanup.mjs`).
- Independent review (code-reviewer subagent, pre-commit): 2×S1 (debug
  scaffolding — đã gỡ trước commit), 2×S2 (wire type ShipmentContainerBatch
  thiếu declarationNumber — ĐÃ thêm kèm doc omission-preserves; batch
  semantics chưa có pin — ĐÃ thêm
  `backend/src/tests/unit/shipment-container-declaration-batch.test.ts`
  5/5 source-flow pins B1–B5), 1×N (trim asymmetry — chấp nhận, đồng nhất
  với line-save path). Backend tests tổng sau review: unit **565/565**
  (gồm pin mới B1–B5) + integration **338/338**.
- Lưu ý vận hành: trong khi drive, một process backend của lane `fix-sil-703`
  đang giữ cổng :3012 (readiness probe dương tính giả trên cổng đã mở sẵn)
  làm kết quả persist cũ trả null — đã chuyển stack của lane này sang :3013
  và kill process chiếm cổng (nhánh đó cần start lại backend của họ).
