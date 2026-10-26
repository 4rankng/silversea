# SIL-521 — Gate phụ: scoped BE tests đỏ ảo khi shared/dist cũ (stale artifact, không phải test pollution)

- Ticket: SIL-521 (board SIL, id 584) — phát hiện khi verify tests SIL-521 qua
  `ship.sh gates`: batch scoped BE báo fail 2/20 trong khi chạy isolated lại
  xanh, trông như order-dependence/pollution giữa các file test.
- Surface: `tools/ship.sh` (gates → scoped BE tests), `shared/dist` build
  artifact, `backend/node_modules/@tingting/shared` symlink.

## Hiện tượng

- Batch scoped (`pnpm exec tsx --test` trên các file test BE changed vs
  origin/main): `shipment-create-key-guard` + `shipment-overview-declaration-wire`
  fail 2 test schema (extra-channels có thêm `declarationNumber`, unknown-keys
  = `['declarationNumber']`).
- Rerun isolated từng file (flake lane): vẫn đỏ y hệt nếu dist chưa rebuild —
  KHÔNG phải order-dependence; "isolated xanh" chỉ xuất hiện SAU khi
  `shared/dist` được rebuild bởi một tiến trình khác/lần chạy khác.

## Root cause

- Backend resolve `@tingting/shared` qua node_modules → `shared/package.json`
  → `shared/dist` (artifact build). FE alias thẳng vào `shared/src` nên miễn
  nhiễm.
- `pnpm test` (full) có `pretest: pnpm --dir ../shared build` nên luôn test
  trên dist tươi. `ship.sh` scoped lane gọi thẳng `tsx --test $CHANGED`,
  BỎ qua bước build → schema vừa sửa trong `shared/src` (SIL-521 bỏ
  `declarationNumber` khỏi quick-create) bị test đọc qua dist cũ → 2 test pin
  schema đỏ ảo. Tests giữ nguyên assertion, đúng 100%.

## Repro (đã chứng minh 27/10)

1. Đưa `shared/dist` về trạng thái cũ (build từ src pre-SIL-521), giữ src ở
   HEAD → batch scoped: 18 pass / 2 fail đúng 2 test trong log gốc; isolated
   từng file cũng 5/1 và 3/1 (không phụ thuộc thứ tự).
2. Rebuild `shared/dist` từ src HEAD → batch scoped 20/20 pass, lặp lại 2 lần
   liên tiếp đều xanh.

## Expected (guard)

- `ship.sh` scoped BE lane PHẢI build `shared/dist` tươi trước khi chạy
  `tsx --test` (đúng convention `pretest` của backend), và fail cứng nếu
  build lỗi.
- Test không bị yếu assertion — fix nằm ở gate orchestration, không đụng
  test file nào.
