# Regression case — ticket 221026173728 (REQ-22 REVERSED): thêm cont copy TẤT CẢ TRỪ số cont + Loại cont

- **Ngày**: 2026-10-22
- **Surface**: mọi chỗ dùng chung logic thêm cont — drawer Tổng quan
  (`frontend/src/features/shipments/cus/CusContainerLedger.tsx` → `addFieldsSeed()`,
  `CusContainerAddRow.tsx`) **và** Chi tiết trượt ngang
  (`frontend/src/features/shipments/detail/ShipmentDetailContainerManagement.tsx`
  hosts CÙNG `ContainerLedger` — one shared implementation, two hosts).
- **Ticket**: card 221026173728 "thêm cont copy tất cả trừ số cont + LOẠI CONT" (22/10).

## Ruling chain (newest-customer-date-wins)

| Ngày | Card | Luật loại cont |
|---|---|---|
| 18/10 | 191026100000 (A.1, b221194a) | Seed loại cont cùng trọng lượng/giờ hẹn — có copy. |
| 20/10 | 201026124500 / 181026185900 A.1 restated | BỎ seed loại cont — "the type is the operator's own entry again"; wire explicit null khi unpicked. |
| 21/10 11:26 | 211026112600 | KHÔI PHỤC copy loại cont (client-side seed). |
| **22/10** | **221026173728 (này)** | **HỦY ruling 21/10 — quay về A.1 nguyên văn: copy TẤT CẢ TRỪ Số cont + Loại cont. Loại cont luôn trống ("Chưa chọn") cho operator tự chọn.** Hành vi copy-kể-cả-Loại-cont là DEFECT theo ticket. |

## Wire contract (giữ nguyên từ A.1)

- Loại cont **không seed dưới mọi hình thức** — kể cả khi dòng ref có type
  nằm ngoài `selectors.containerTypes` (không còn catalog-guard riêng vì
  không còn gì để guard).
- Submit: type được chọn → number; **unpicked → EXPLICIT `containerTypeId: null`**
  (undefined sẽ kích hoạt server lot-default inherit — null thì server insert
  null, không re-copy). Xem `cus-shipment-workspace-writes.service.ts`
  `inheritable()`: UNDEFINED = inherit, EXPLICIT NULL = insert null.
- Copy set không đổi: Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng/Giờ hẹn ride seed
  per-column first non-null; Số container vẫn ô nhập của operator.

## TC-221026173728 — Loại cont trống khi mở form Thêm container

**Repro (trước reversal)**: local dev stack (BE :3002 + FE) → đăng nhập CUS →
mở lô FCL có ≥1 cont đã chọn loại cont (drawer Tổng quan HOẶC Chi tiết trượt
ngang) → bấm "Thêm container".

- **Trước reversal (defect)**: trigger Loại cont pre-fill loại cont của dòng
  trên (21/10 seed).
- **Sau reversal (expected)**: trigger hiện placeholder "Chưa chọn loại cont";
  Số container trống; **các trường còn lại VẪN copy** (Tuyến/Nhà xe/Nâng/Hạ/
  Trọng lượng/Giờ hẹn hiện giá trị dòng trên); submit chỉ cần nhập số cont
  (+ tự chọn loại nếu muốn) → dòng mới `container_type_id = NULL`, các cột
  copy nhận giá trị dòng ref.

**Edge pins**:

1. Dòng ref có type (kể cả id ngoài catalog) → vẫn placeholder, submit
   explicit null (stronger pin — test "LONG MINH legacy id").
2. Operator chọn rồi clear type → explicit null (A.1 wire contract nguyên vẹn).
3. Row 1 type null → row 2 có type → VẪN placeholder (không first-non-null
   cho type nữa).

## Evidence

- Unit: `CusContainerLedger.test.tsx` (suite A.1 flip theo luật 22/10, cite
  card 221026173728 trong test comment) + `ShipmentsPage.test.tsx` (drawer
  seeded-type pin flip sang placeholder).
- UI rung 3: `qa/2026-10-22-req22-reversed/` — screenshot form (Loại cont
  trống + các field copy), DOM assertion, driver log, DB readback
  (`container_type_id IS NULL` trên dòng mới).

## Ghi chú

- Reversal ghi nguồn ticket 221026173728 vào `docs/prd/CHANGELOG.md` (22/10),
  `docs/prd/README.md` (CUS-09 + FB-086 🔒-họ), `docs/prd/OpsVanHanh.md`
  (A.1/A.6) — cùng commit. Case 21/10 (`2026-10-21-card-211026112600-...md`)
  giữ nguyên làm hồ sơ lịch sử, không xóa.
- Pin vitest của ruling 21/10 ĐÃ FLIP trong cùng commit reversal (ruling-
  reversal rule: test pin behavior cũ sẽ đỏ — flip chứ không bỏ qua).
