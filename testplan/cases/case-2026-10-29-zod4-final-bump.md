# 2026-10-29 — zod 3.25.76 → 4.6.7 (fix-zod4-final): behavior-invariance regressions

- Ticket: SIL-542 ("QA 26 — Đóng 9 Dependabot alerts (7 high)", id 608) —
  phần zod của QA26 từng bị revert về 3.25.76 (ff923fd9, instruction batch
  29/10); task này bump lại trên nhánh `fix-zod4-final` off origin/main mới
  nhất và giữ nguyên behavior wire contract.
- Bối cảnh: 4 Dependabot HIGH còn mở = zod 3.25.76 "memory exhaustion
  validating oversized constrained collections" (GHSA) — không có bản vá
  3.x; bản vá = zod ^4.6.7. Tham khảo migration cũ: `fix-zod4-migration`
  (a27bcfa3) — các fix đã biết: partialUpdateSchema builder (v4 `.partial()`
  rides create-time defaults), ZodError `.errors`→`.issues` (throwValidation +
  global errorHandler), error params `invalid_type_error`/`required_error`/
  `errorMap` → `error`, `z.record` 2 args, type `z.input`→`z.output` cho
  coerced fields (QuotationFeeData…), `.innerType()` hop không còn cần.
- Phạm vi bump: `backend/package.json` + `shared/package.json` zod →
  `^4.6.7` (frontend không khai báo zod trực tiếp — dùng qua @tingting/shared).

## Bất biến bắt buộc (accept/return đúng payload hiện có)

Mọi case dưới đây parse THÀNH CÔNG với output bằng đúng giá trị gửi lên (trừ
default create-time được áp như hiện hành) trên CẢ zod 3.25.76 (trước bump)
và zod 4.6.7 (sau bump). Không assert default message tiếng Anh của zod
(v3/v4 khác nhau); chỉ assert message tiếng Việt custom và giá trị parse.

### Vùng rủi ro 1 — Auth (test-first: `shared/src/schemas/auth-schema.test.ts`)

- Z4-AUTH-1 `loginSchema`: payload thật `{identifier, password}` accept;
  identifier rỗng reject.
- Z4-AUTH-2 `createUserSchema`: payload thật accept + DEFAULT create-time
  (`status: 'ACTIVE'`, `customerAccountType: 'SINGLE_ENTITY'`) — pin semantics
  `.default()` giữa 2 bản.
- Z4-AUTH-3 `createUserSchema` refine "ít nhất một trong username/email/phone"
  — reject với message tiếng Việt khi thiếu cả 3.
- Z4-AUTH-4 `updateUserSchema`: email `''` (clear) accept, email hợp lệ
  accept, email hỏng reject; password < 6 ký tự reject.
- Z4-AUTH-5 `changePasswordSchema`/`updateProfileSchema`: message tiếng Việt
  khi thiếu/sai.

### Vùng rủi ro 2 — Shipment create/update (extend `shipment-schema.test.ts`)

- Z4-SHIP-1 `createShipmentSchema`: payload thật đầy đủ (bookingRef + EXPORT +
  timestamps `+07:00`/`Z`) accept, giá trị giữ nguyên từng byte (no coercion
  surprises).
- Z4-SHIP-2 create defaults: `isAdHoc`/`isCombined`/`hasDeposit` = false khi
  omitted — pin `.default()` semantics.
- Z4-SHIP-3 `createShipmentSchema` thiếu customerId (không ad-hoc) →
  'Khách hàng là bắt buộc.'
- Z4-SHIP-4 `updateShipmentSchema`: patch subset `{expectedVersion,
  driverNotes}` accept; key omitted KHÔNG xuất hiện trong output (không clobber
  cột đang lưu); thiếu cả expectedVersion/version reject.
- Z4-SHIP-5 `updateShipmentSchema` timestamp: `+07:00` accept (wire ledger
  editor), chuỗi rác reject.

### Vùng rủi ro 3 — Lot merge / LCL grouping (`lcl-grouping.test.ts`)

- Z4-MERGE-1 `assignLclCostGroupSchema`: payload thật (2 lô, BKS thật) accept,
  giữ nguyên thứ tự shipmentIds; 1 lô → 'Nhóm ghép cần ít nhất 2 lô'.
- Z4-MERGE-2 BKS 'bổ sung sau' (mọi biến thể case/whitespace) reject ở MỌI
  đường ghi BKS (assign/update/truck) — rule SIL-494.
- Z4-MERGE-3 `updateLclCostGroupSchema`: payload rỗng → 'Không có gì để sửa…';
  `freightCost: null` accept (3-state auto-trace) và null lọt qua parse;
  omitted key không xuất hiện trong output.
- Z4-MERGE-4 `mergeLclRevGroupSchema`: `billingTruckNo: ''`/null accept
  (FB-141 clear là thao tác hợp lệ); omitted → absent.
- Z4-MERGE-5 `setLclLotRevClassSchema`: thiếu cả 2 trường → message tiếng Việt;
  `unmergeLclLotSchema` chỉ nhận dimension COST/REV.

## Cách reproduce (trước khi sửa)

```bash
cd shared && pnpm test   # các case Z4-* phải XANH trên zod 3.25.76
# sau bump:
cd shared && pnpm test   # cùng case XANH trên zod 4.6.7 — không sửa assertion
```

## Evidence

- Trước bump (zod 3.25.76): `qa/2026-10-29_zod4-final_shared-tests-pre-bump.log`
- Sau bump (zod 4.6.7): `qa/2026-10-29_zod4-final_*.log` (shared/BE/FE/build)
- Migration reference: commit f80cc48e (QA26) + revert ff923fd9; testplan cũ
  `case-QA26-zod4-bump-regressions.md` (2 regression class lỗi thời của lần
  bump đầu vẫn là luật cho partialUpdateSchema + error-handler shape).
