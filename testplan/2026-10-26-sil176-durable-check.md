# SIL-176 — Hồi quy: POST /advance-settlements/:id/check qua reviewed durable command boundary

Ngày: 2026-10-26 · SIL-176 (board issue id 209) · branch `fix-209-durable-check`

## Bối cảnh

BE standing red (card 191019215621, phát hiện từ full-suite gate card
261019172304): `material-write-registry-exhaustive` fail
`financial/advances.routes.ts|POST|/advance-settlements/:id/check: no reviewed
durable command boundary` — route tự khai material write nhưng body không chạy
qua durable-command envelope, trong khi 2 route anh em cùng file (`/reversal`,
`/update`) đều đã qua `runIdempotent`.

Fix chọn 1 (ưu tiên khi là material write thật — card 191026160000) đã land
`fb0ce978`: bọc handler trong `runIdempotent` + khai enum
`IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_CHECK = 'advance-settlements.check'`.
Lane này pin hồi quy double-submit cho route `/check` và chạy lại toàn bộ gates.

## Contract double-submit (pin bắt buộc)

Submit duyệt 2 lần:

| Lần | Điều kiện | Kết quả bắt buộc |
|-----|-----------|------------------|
| 2, cùng Idempotency-Key + cùng payload | `runIdempotent` replay snapshot | `replayed: true`, KHÔNG gọi lại `checkAdvanceSettlement` → không stamp lần 2, không bump version lần 2, không notification lần 2 (không double-apply) |
| 2, key khác | service state-transition guard | 409 `Phiếu đã được kế toán duyệt.` (real accountant check là terminal) hoặc 409 `Bạn đã duyệt phiếu này rồi.` (cùng actor legacy) |
| thiếu Idempotency-Key | `runIdempotent` | 400 `Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này.` |
| cùng key, khác actor / khác payload | `replayFromRecord` | 409 (khóa giao dịch thuộc người khác / nội dung khác) |

## Thay đổi lane này

- BE unit pin mới `backend/src/tests/unit/advance-settlement-check-durable.test.ts`
  (source-contract pins, đúng pattern unit-only — không DB, không app boot):
  envelope presence + enum identity + role guard + audit key + service
  state-transition guards + conditional version bump.
- KHÔNG sửa route/service (đã đúng từ `fb0ce978`); KHÔNG đụng
  `material-write-registry-exhaustive.test.ts` (READ-ONLY, card cấm).

## Phạm vi hồi quy

| # | Khu vực | Rủi ro | Trường hợp kiểm |
|---|---------|--------|-----------------|
| R1 | Registry | route mất `runIdempotent` → standing red quay lại | `material-write-registry-exhaustive` pass isolated |
| R2 | Envelope identity | replay lookup lệch endpoint string | pin `IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_CHECK` dùng trong handler |
| R3 | Role guard | role khác stamp duyệt | `requireRoles(Role.ADMIN, Role.ACCOUNTANT)` |
| R4 | Audit | duyệt không trace | `res.locals.auditEntityKey = phiếu hoàn ứng <code> — duyệt` |
| R5 | Service guards | DRAFT/VOID duyệt được; duyệt 2 lần double-apply | 409 guards + terminal checkedBy + conditional version bump trong service source |
| R6 | Full suite | regression chỗ khác | `cd backend && pnpm test` xanh (338+), `npx tsc --noEmit` = 0, `pnpm lint` 0 |

## Ghi chú QA

Live double-submit probe (2 POST thật lên stack local: lần 2 cùng key →
`replayed: true`; lần 2 key khác → 409) thuộc QA script theo ghi chú trong
ticket — không phải BE unit (owner ruling 2026-10-19: BE tests pure unit).
