# SIL-677 — copyTrip live lot-linked 500/409 chưa bắt → copy hoạt động (detach) — evidence

Branch: `fix/sil677-copytrip-live` · Local dev db `ss-prod-db` (localhost:5441) · backend boot từ worktree này (PORT=3177, `pnpm dev`) · account `admin` (ADMIN, Abc123).

Review: independent code-reviewer **Approve** (2 minor đã xử lý: map thêm 40001
cho nhánh repeatable-read nội bộ + force-track qa artifacts; 2 nit đã xử lý:
message pair trung tính, card scope chính xác).

## Driver HTTP trước/sau (`qa/scripts/2026-11-04-sil677-driver.mjs`)

| Nhánh (source trip) | BEFORE (pre-fix, commit 3fa8fd434) | AFTER (fix này) |
|---|---|---|
| pair-active — trip 1272 (shipment 1769, fulfillment 2041, có pair) | 409 `active_trip_pair_id, active_trip_pair_order đã tồn tại` | 201 + copy detach (`shipment=NULL fulfillment=NULL pair=NULL/NULL status=CREATED`) + line law giữ bridge, 0 số cont/seal |
| co-fulfillment — trip 851 (shipment 1239, fulfillment 1453) | 409 `fulfillment_id đã tồn tại` | 201 + detach như trên |
| lot-linked-thuong — trip 504 (shipment 777, fulfillment NULL) | 409 `shipment_id đã tồn tại` | 201 + detach như trên |
| canceled-lot — trip 1272 tạm CANCELED (fixture restore + verify) | 409 pair index (trip có pair ⇒ law SIL-655 arm SourceCanceled TRƯỚC đây cũng gãy với trip có pair) | 201 + `copy.shipment_id=1769` (p2.copy-stays-lot-linked giữ nguyên) |

Artifacts: `2026-11-04_sil677_driver-before.log` (5/6 checks — FAIL duy nhất là `canceled-lot.before-201`, đúng_bug_trước_fix), `2026-11-04_sil677_driver-after.log` (17/17 PASS, exit 0).

## Lưu ý thực tế trước fix (khác luật ticket)

Ticket báo "500 chưa bắt". Đo THỰC TẾ ở base 3fa8fd434: central handler
(`middleware/errorHandler.ts`) đã map 23505 → **409 generic** dạng
`"fulfillment_id đã tồn tại"` (không 500) — `DrizzleQueryError.cause` mang code
23505 và `isPgUniqueViolation` bắt được. Vấn đề còn lại đúng bản chất ticket:
copy KHÔNG hoạt động + message generic không có ý nghĩa nghiệp vụ. Sau fix: 201
cho 3 nhánh live, và mọi 23505 sót (race) → 409 có message nghiệp vụ.

## Gates

| Gate | Command | Result | Log |
|---|---|---|---|
| Scoped unit test (mới) | `cd backend && npx tsx --test --test-concurrency=1 src/tests/unit/sil677-copytrip-live.test.ts` | 10/10 pass, exit 0 (final state) | `qa/2026-11-04_sil677_backend-scoped-test.log` |
| FULL BE unit | `cd backend && pnpm test:unit` | 852/852 pass, exit 0 (final state) | `qa/2026-11-04_sil677_backend-unit-full.log` |
| BE integration-named | `cd backend && npx tsx --test --test-concurrency=1 'src/tests/*.test.ts'` | 342/342 pass, exit 0 (chạy trước review-fix; delta sau đó chỉ là mapper message + nhánh 40001 — phủ bởi scoped + unit rerun) | `qa/2026-11-04_sil677_backend-integration-full.log` |
| Backend tsc | `cd backend && npx tsc --noEmit` | 0 errors, exit 0 (final state) | `qa/2026-11-04_sil677_backend-typecheck.log` |
| Root lint | `pnpm lint` | 1 error ĐÃ TỒN TẠI TRƯỚC ở base — `frontend/.../DetailedPlanGrid.tsx:347` unused `rowIdentity` (file frontend không thuộc lane này, `git diff HEAD -- frontend/` = 0 dòng) + 4 warnings cũ | `qa/2026-11-04_sil677_root-lint.log` |
| SIL-655 pins (không regress) | `cd backend && npx tsx ../qa/scripts/2026-11-04-sil655-r2-p2-copytrip-link-probe.mjs` | 23/23 checks pass (arm 0 cập nhật pin hành vi SIL-677; arm SourceCanceled giữ nguyên — `p2.copy-stays-lot-linked` xanh) | `2026-11-04_sil677_sil655-p2-rerun.log` |

Coverage (rung §9 — backend/API lane, không đụng UI):

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| 3 nhánh live copy thành công + detach | DB/API VERIFIED (2) | `driver-after.log` — HTTP 201 ×3 + DB re-read NULL×4/CREATED + cleanup residual=0 | FE click-through "Sao chép chuyến" (không đổi FE) |
| Canceled-source giữ lot link (SIL-655) | DB/API VERIFIED (2) | `driver-after.log` canceled-lot + `sil655-p2-rerun.log` 23/23 | — |
| Mọi 23505/40001 sót → 409 có message | CODE-READ (1) + unit | mapper unit 10/10; driver ghi nhận trước-fix 409 generic tại cùng index | race thật giữa 2 request đồng thời (không dàn dựng) |

Cleanup: mọi bản copy probe (1295–1300) đã xóa khỏi db (residual=0 từng nhánh,
fixture source restore + verify trong log).
