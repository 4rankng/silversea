# Root cause — scoped BE batch đỏ ảo (SIL-521 verify, 27/10/2026)

## Báo cáo gốc

`backend/src/tests/unit/cus-container-declaration-copy.test.ts` bị nghi
order-dependence/pollution: "pass isolated nhưng fail 2/10 trong batch scoped
(ship.sh scoped BE)".

## Phân tích log gốc của user (`/tmp/gate-scoped.log`, 00:15 27/10)

2 test fail KHÔNG nằm ở copy-test (10/10 của file này pass cả batch lẫn
isolated). Fail nằm ở 2 file KHÁC, cả 2 đều là pin schema:

1. `shipment-create-key-guard.test.ts` — "quick-create carries exactly two
   extra channels over the create list": actual `['_requestId','containers',
   'declarationNumber']` vs expected 2 keys.
2. `shipment-overview-declaration-wire.test.ts` — "quick-create no longer
   takes a lot-level declarationNumber (SIL-521)": unknown-keys actual
   `['declarationNumber']` vs expected `[]`.

Cả 2 = schema runtime VẪN CHẤP NHẬN `declarationNumber` trong quick-create —
tức là code SIL-521 (đã land trong src) KHÔNG có trong artifact mà test đọc.

## Bằng chứng stale artifact (main checkout /Volumes/LexarSSD/projects/silversea)

- `shared/src/schemas/index.ts`  mtime 27/10 00:08 — quick-create KHÔNG còn
  `declarationNumber` (SIL-521).
- `shared/dist/schemas/index.js` mtime 26/10 11:55 — VẪN CÒN
  `declarationNumber: z.string().trim().max(50).optional().nullable()` trong
  `quickCreateShipmentBaseSchema`.
- Backend resolve `@tingting/shared` → node_modules symlink → `shared`
  package.json → `dist/`. FE alias thẳng `../shared/src` (vite.config.ts:17)
  nên chỉ BE chịu ảnh hưởng.

## Cơ chế

- `pnpm test` full có `pretest: pnpm --dir ../shared build` → luôn dist tươi.
- `ship.sh` scoped lane gọi thẳng `pnpm exec tsx --test $CHANGED` — KHÔNG
  build → dist cũ từ lần build trước (dev server/pretest cũ...) → schema drift
  src↔dist → 2 test pin đỏ.
- KHÔNG phải pollution/order-dependence: với dist cũ, từng file chạy ISOLATED
  cũng đỏ y hệt (5 pass/1 fail và 3 pass/1 fail). "Isolated xanh" mà user thấy
  là do giữa các lần chạy đã có tiến trình rebuild shared (pretest/predev/
  build) — dist tươi lúc đó.

## Repro trong worktree này (chứng minh cơ chế)

Bước 1 — giả lập dist cũ (build từ `8c509cad~1:shared/src/schemas/index.ts`,
src giữ HEAD):
- Batch scoped 3 file: `tests 20 · pass 18 · fail 2` — ĐÚNG 2 fail trùng log gốc.
- Isolated: key-guard 5/1, wire 3/1 — đỏ không phụ thuộc thứ tự.

Bước 2 — rebuild dist từ src HEAD:
- Batch scoped: `tests 20 · pass 20 · fail 0` — lặp 2 lần liên tiếp đều xanh
  (`qa/2026-10-27_decl-test-pollution_scoped-run{1,2}.log`).

## Fix

`tools/ship.sh` scoped BE lane build `shared/dist` tươi trước khi chạy test
(đúng convention `pretest` của backend), fail cứng nếu build lỗi. Không đụng
nội dung assertion của bất kỳ test nào.

Artifact:
- `qa/2026-10-27_decl-test-pollution_USER-ORIGINAL-FAIL.log` — log đỏ gốc 00:15.
- `qa/2026-10-27_decl-test-pollution_scoped-run1.log` / `...run2.log` — xanh ×2
  sau fix, đúng lệnh ship.sh scoped (build + tsx --test $CHANGED, bash).
- `qa/2026-10-27_decl-test-pollution_ship-gates.log` — full `ship.sh gates`
  (tsgo + tsc FE/BE + full FE + scoped BE trong gate thật).
- Regression: `testplan/cases/case-SIL-521-scoped-gate-stale-dist.md`.
