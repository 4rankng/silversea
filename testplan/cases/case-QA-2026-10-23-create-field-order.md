# Case QA-2026-10-23-create-field-order — Tạo lô (CUS): Hình thức XNK trước Số Bill/Booking + Số tờ khai xuống cuối phần Nhận diện lô

Card 261023093200 (Tiệp Vũ FB 23/10, kèm screenshot form Tạo lệnh hàng bước
2/3). Surface: `/shipments/new` → `ShipmentCreateIdentitySection` (section
"Nhận diện lô"). Chỉ đổi THỨ TỰ field trong layout — KHÔNG đổi logic,
validation, hay semantics tờ khai per-cont (CUS-05: tờ khai gán theo cont,
nhiều cont chung 1 số; lô 1 số → copy mọi cont — đã land).

## Bố cục trước (A.3, card 181026200200)

Band 1: Khách hàng · Số Bill/Booking → Band 2: strip Số tờ khai →
Band 3: Hình thức xuất nhập khẩu · Hãng tàu → Band 4: Tuỳ chọn.

Vấn đề: khách phải chọn Hình thức XNK TRƯỚC khi điền Bill/Booking (field
Bill/Booking bị disable + hint "Chọn Hình thức xuất nhập khẩu trước" cho tới
khi chọn hướng), nhưng picker hướng lại nằm ở band 3 — dưới field nó gate.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| CFRD-R1 | Mở `/shipments/new` (FCL) | DOM/visual order phần Nhận diện lô: Khách hàng · Hình thức xuất nhập khẩu → Số Bill/Booking · Hãng tàu → Tuỳ chọn → strip Số tờ khai (cuối cùng) |
| CFRD-R2 | Chưa chọn hướng | Số Bill/Booking vẫn disabled + hint "Chọn Hình thức xuất nhập khẩu trước" (giữ QA1-001); hint nằm ngay dưới picker hướng |
| CFRD-R3 | Chọn Nhập/Xuất | Bill/Booking enable, placeholder đúng theo hướng (IMPORT→Bill, EXPORT→Booking) — logic đổi |
| CFRD-R4 | LCL | Hãng tàu ẩn như cũ; band 2 chỉ Số Bill/Booking; strip tờ khai vẫn cuối section |
| CFRD-R5 | Semantics tờ khai | Chip input, bulk edit, Xóa tất cả, conflict warning per-number giữ nguyên — chỉ vị trí đổi |
| CFRD-R6 | Responsive | 820px: Khách hàng full-row, các field khác 2 cột; 640px: 1 cột — không clipping |
| CFRD-R7 | Vitest | Pin R1 trong `ShipmentCreateIdentitySection.test.tsx` (DOM order chain) |

## Verify

- UI drive: `testplan/qa/scripts/2026-10-23-create-field-order-ui-drive.mjs`
  (puppeteer, token inject trước SPA nav — `puppeteer-spa-auth`). BEFORE phase
  trên stack main checkout (:7175, HEAD cfd1299d clean), AFTER phase trên
  stack worktree này (vite :7176, cùng backend :3002 / DB :5441). Role ADMIN.
- Artifacts: `qa/2026-10-23-create-field-order/`.

## Not covered

- Staging (local dev per brief).
- Role CUS tự tạo lô (drive bằng ADMIN — cùng component, RBAC chỉ ở route).
- Viewport 390 mobile (drive 1440 + 820 reflow qua CSS contract test).
- Form sửa Chứng từ trên `/shipments` (surface khác, không đổi).
