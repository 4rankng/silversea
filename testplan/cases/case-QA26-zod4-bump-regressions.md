# QA-26 — Security bump zod 3→4: hai regression class bắt được khi đóng 9 Dependabot alerts

- Ticket: QA 26 (board SIL) — phần A của task `fix-sec-depends` (branch
  `fix-sec-depends`, off origin/main 4a01615c): bump zod ^3.25.76 → ^4.6.7,
  multer ^2.5.0, body-parser ^2.4.0 (override), undici ~7.30.1 (override),
  qs >=6.16.1 (override), puppeteer/puppeteer-core ^25.16.0 (chromium-bidi mới
  dùng zod ^4.6.5) — `pnpm audit`/`--prod` = 0 vulnerabilities.
- Surface: `backend/src/middleware/errorHandler.ts` (global handler),
  `shared/src/schemas/partial-update.ts` (mới — builder PATCH/PUT), 3 call
  sites `.partial()` (crud-factory, dispatch-planning, expense).

## Regression 1 — global error handler đọc `.errors` đã bị v4 gỡ

### Hiện tượng

- Mọi route cho `.parse()` throw (crud-factory create/update ~28 catalog
  endpoints, expense PUT, app-settings, lcl-grouping…) trả về
  `{"error":"Dữ liệu không hợp lệ"}` thay vì message tiếng Việt kèm path, và
  MẤT toàn bộ `details`.
- Nguyên nhân: v4 bỏ alias `.errors` trên `ZodError` — handler đọc
  `err.errors` → `undefined` → rơi vào fallback message, `details` bị drop.
- Status vẫn 400 nên backend unit/integration cũ không bắt được (không có test
  nào pin nhánh ZodError của global handler).

### Fix + regression pin

- `errorHandler.ts` đọc `err.issues` và map về contract JSON-safe
  `{code, message, path}` (lọc symbol khỏi `PropertyKey[]` path) — cùng mapping
  với `throwValidation` trong `backend/src/lib/validation.ts`.
- Pin: `backend/src/tests/unit/error-handler-zod-shape.test.ts` — ZodError thật
  qua handler stub: 400 + message đầu tiên kèm nhãn path (không rơi fallback),
  details đủ 2 issue với path `[['expectedVersion'],['note']]`, không symbol.

## Regression 2 — v4 áp `.default()` bên trong `.partial()` → PATCH ghi đè cột

### Hiện tượng

- v3: `createSchema.partial().parse({ note })` → chỉ `{ note }` → UPDATE chỉ
  ghi cột note.
- v4: default thắng wrapper optional → cùng parse trả về
  `{ note, sharePct: 0, billingKmMultiplier: 2, vehicleComponent: 'TRUCK',
  isActive: true, … }` → PUT/PATCH ghi đè mọi cột có default bằng giá trị
  create-time = mất dữ liệu cấu hình (crud-factory PUT toàn bộ catalog,
  PATCH xe nhà xe bật lại `isActive`, PATCH chi phí đổi `vehicleComponent`).

### Fix + regression pin

- `shared/src/schemas/partial-update.ts` — `partialUpdateSchema()`: bóc
  `ZodDefault` (kể cả qua `ZodOptional`/`ZodNullable`, cả hai thứ tự wrapper)
  trước khi `.partial()`; mirror policy unknown-keys (strict/loose/strip) qua
  `def.catchall` (never/unknown/null). Omitted key = không xuất hiện trong
  output = "giữ nguyên giá trị đang lưu".
- Wire 5 schema/call site thuộc cùng class (sibling sweep round 2 bắt thêm 2
  schema composed `.omit().partial()` mà grep `.partial()` ban đầu bỏ sót):
  1. `crud-factory.ts` — PUT toàn bộ catalog (freight-rate-terms là ví dụ
     pin sẵn);
  2. `dispatch-planning.routes.ts` — PATCH xe nhà xe (`isActive` default true);
  3. `expense.ts` — PATCH chi phí (`vehicleComponent` default 'TRUCK');
  4. `shared/src/schemas/invoice-tracking.ts` — `invoiceTrackingPatchSchema`
     (`progress` default 'CHUA_GUI' → PATCH thiếu progress bị reset trạng thái);
  5. `shared/src/schemas/index.ts` — `tripExpensePatchSchema`
     (`sellAmount` default 0 + `settlementMethod` → PATCH chỉ sửa buyAmount
     bị ZERO tiền bán và reset phương thức thanh toán — money path).
- Pin: `shared/src/schemas/partial-update.test.ts` (omitted-key qua 3 thứ tự
  wrapper + policy strict/loose/strip) và pin cũ
  `shared/src/schemas/freight-rate-terms.test.ts` chuyển sang gọi helper
  (assertion giữ nguyên — "partial updates preserve the omitted existing lag").

## Đã biết, ngoài scope (báo owner)

- `shared` suite: 10 test `fifoAging` đỏ TRƯỚC cả bump (chạy lại trên bản
  origin/main nguyên vẹn bằng code thuần, không import zod → vẫn 10 fail
  7 pass) — drift do card 061026221213 đổi semantic bucket theo due-date,
  suite shared không nằm trong gate nào nên đỏ âm thầm. Không sửa trong task
  này (cần owner quyết định đúng sai giữa test và implementation).
