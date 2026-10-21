# 2026-10-21 — BE canonical full suite trên main (branch `fix-be-canonical`)

## Phạm vi

Verify canonical backend test suite (unit + integration) tại commit `536aad6c`
(= `origin/main` HEAD) trên branch `fix-be-canonical`. LOCAL only — stack
`make dev` (Postgres :5441, Redis :6391, backend :3002 healthy,
`/api/health` → `{"status":"ok"}` trước khi chạy).

Canonical command (theo `backend/package.json`):

```
pnpm test
  = pnpm test:unit          → npx tsx --test 'src/tests/unit/*.test.ts'
  + pnpm test:integration   → npx tsx --test --test-concurrency=1 'src/tests/*.test.ts'
```

## Kết quả

| Gate | Command (exact) | Kết quả | Exit |
|---|---|---|---|
| BE canonical test | `cd backend && pnpm test` | **668/668 pass, 0 fail, 0 skipped** | 0 |
| — unit | `npx tsx --test 'src/tests/unit/*.test.ts'` | 338 tests / 52 suites, 338 pass, 0 fail, duration 36 605 ms | 0 |
| — integration | `npx tsx --test --test-concurrency=1 'src/tests/*.test.ts'` | 330 tests / 79 suites, 330 pass, 0 fail, duration 128 788 ms | 0 |
| BE typecheck | `cd backend && npx tsc --noEmit` | 0 errors | 0 |

Không có test đỏ nào còn lại trên main → không cần fix code/test; commit này
chỉ ghi số liệu docs.

## Ghi chú quá trình

- **run1** (`qa/2026-10-21_be-canonical_test-run1.log`): fail exit 2 tại
  `pretest` (build `shared/`) vì worktree mới chưa có `node_modules`
  (`Cannot find module 'zod'`, `node_modules missing`). Phân loại: **thiết lập
  môi trường**, không phải test đỏ — không test nào được chạy. Khắc phục:
  `pnpm install` ở repo root.
- **run2** (`qa/2026-10-21_be-canonical_test-run2.log`): full canonical pass
  như bảng trên.
- be-tsc log: `qa/2026-10-21_be-canonical_be-tsc.log`.

## Coverage còn lại (không thuộc scope này)

- Chỉ BE canonical suite + BE typecheck được chạy. FE typecheck/test/lint,
  `make build`, route sweep UI **không** chạy trong scope này (không thay đổi
  code, docs-only).
- Không có bề mặt UI nào thay đổi → không có claim UI (§9 không áp dụng).
