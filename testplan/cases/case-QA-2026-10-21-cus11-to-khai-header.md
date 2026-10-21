# Case QA-2026-10-21-cus11-to-khai-header — tờ khai header /shipments/:id luôn render giá trị

Card 211026125915 (cus-11). QA đọc header `/shipments/:id` hiện "—" khi lô chưa có
tờ khai cấp LÔ (bảng `shipment_declarations`) dù các cont đã mang số tờ khai riêng
từng cont (`shipment_containers.declaration_number`, card 261013200312) → QA tưởng
chức năng chưa implement.

## Trạng thái trước fix

Header detail chỉ đọc `declarations` (cấp LÔ):
- Lô có tờ khai cont nhưng 0 dòng `shipment_declarations` → dd "Số tờ khai" = "—".
- Lô thật sự 0 tờ khai (không LÔ, không cont) → "—" khô, không đường vào flow thêm tờ khai.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| CUS11-R1 | Mở `/shipments/:id` lô có tờ khai cấp LÔ | dd "Số tờ khai" = join các số tờ khai LÔ (giữ nguyên FB-113), 4 nhãn Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu |
| CUS11-R2 | Lô KHÔNG có tờ khai LÔ nhưng cont có `declaration_number` | dd hiển thị số tờ khai của cont ĐẦU TIÊN tìm thấy trong lô (không "—"); title ghi rõ nguồn per-container |
| CUS11-R3 | Lô thật sự 0 tờ khai (không LÔ, không cont) | dd = "Chưa có" + link "Thêm tờ khai" mở đúng modal thêm tờ khai (cùng flow nút section); đủ 4 nhãn |
| CUS11-R4 | Link header tôn trọng gate | Chỉ hiện với role được thêm tờ khai (ADMIN/MANAGER/CUS); disable khi lô khóa kế toán |
| CUS11-R5 | Vitest | Unit pin cho R1–R3 trong `ShipmentDetailPage.test.tsx` |

## Verify

- UI drive script: `testplan/qa/scripts/2026-10-21-cus11-dri04-ui-drive.mjs`
- Environment: local dev (frontend 7175/7176-worktree, backend 3002, postgres 5441)
- Role: ADMIN (`admin`)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| CUS11-R1 lot join (ship 5) | 3 (UI DRIVEN) | `qa/2026-10-21-cus11-dri04/cus11-dri04-ui-{before,after}.log`, unit `ShipmentDetailPage.test.tsx` | staging |
| CUS11-R2 cont-only header (ship 110902) — trước '—', sau 'TK-FB109-706110' + title nguồn | 3 (UI DRIVEN) | `qa/2026-10-21-cus11-dri04/cus11-r2-cont-only-{before,after}.png`, logs | staging; lô nhiều số tờ khai cont KHÁC nhau (chỉ lấy số ĐẦU TIÊN theo yêu cầu card) |
| CUS11-R3 zero-decl (ship 312425) — 'Chưa có' + link mở modal | 3 (UI DRIVEN) | `qa/2026-10-21-cus11-dri04/cus11-r3-zero-{before,after}.png`, `cus11-r3-zero-modal-after.png`, logs | staging; submit thật (hủy trước khi lưu — không ghi dữ liệu) |
| CUS11-R4 gate role/lock | Unit | `ShipmentDetailPage.test.tsx` (locked → disabled + reason; ADMIN link enabled) |không drive UI từng role |
| CUS11-R5 vitest | Unit | 164/164 scoped pass | — |
| DB không đổi (read-only fix) | 2 (DB VERIFIED) | DB rows before/after identity trong log | — |

## Not covered

- Staging (local dev per brief).
- Role ACCOUNTANT/DRIVER trên link (unit-gated theo `canManageDeclarations`; không drive UI từng role).
