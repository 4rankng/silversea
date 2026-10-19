# Gates — BE reds FINAL (branch fix-be-reds-final, base 64f81514)

Ngày: 2026-10-19 · Worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-be-reds-final`

## Root cause (xem testplan/2026-10-19-be-reds-final-cross-run-interference.md)

Cross-run interference trên DB dev dùng chung: các checkout agent chạy song
song cùng các suite test (bằng chứng: `fix-be-reds-w4-b` chạy full-suite đồng
thời với run này; `pg_stat_activity` ghi nhận nhiều tiến trình). 11 red bền
qua 3 wave = các suite chạm singleton (payroll app_settings, vat_config +
cache config:vat) hoặc aggregate toàn công ty (đếm quotations, hội tụ sổ quỹ↔169)
đọc/ghi trong khi tiến trình khác ghi. Kèm 2 defect thật đi kèm: pin
UPDATE-only no-op (q10/q11) và payroll setting treo unit đã xóa (dọn từ DB).

## Fix

- `backend/src/tests/helpers/cross-suite-lock.ts` (mới): pg advisory lock
  (906416,1 payroll / (906416,2 vat) — precedent `freight-pricing-config-routes`).
- q09/q10/q11/q15/m73/final: serialize pin/restore payroll; pin upsert;
  restore value/absence TRƯỚC khi xóa unit; restore fail ⇒ giữ unit.
- vat-config-singleton + vat-config-cache-shape: serialize vòng đời singleton.
- q57: pin "no partial write" scope theo customer của sheet.
- card168: đọc cặp hội tụ fresh + tối đa 3 settle-reread (divergence thật vẫn fail).
- q03: deadline chờ audit/notification 20×50ms → 100×100ms.

## Kết quả (logs trong qa/)

| Gate | Kết quả | Log |
|---|---|---|
| `cd backend && npx tsc --noEmit` | 0 error | — (chạy 2 lần, sau mỗi vòng sửa) |
| `pnpm lint` (root) | 0 error | — |
| Unit `tsx --test src/tests/unit/*.test.ts` | 305/305 | qa/2026-10-19_be-reds-full-rerun.log (tail unit không chạy riêng — xem log targeted) |
| Targeted 11 suite (sequence, 1 process) | 45/45 pass, EXIT=0 | qa/2026-10-19_be-reds_targeted-green-v2.log |
| Concurrent proof payroll (q10 ‖ q15) | 2/2 + 6/6 | qa/2026-10-19_be-reds_conc-payroll-{a2,b2}.log |
| Concurrent proof payroll (q10+q11 ‖ m73+q15) | 4/4 + 8/8 | qa/2026-10-19_be-reds_conc-payroll-{a,b}.log |
| Concurrent proof vat (singleton ‖ cache-shape) | 11/11 + 2/2 | qa/2026-10-19_be-reds_conc-vat-{c,d}.log |
| Full integration `tsx --test --test-concurrency=1 src/tests/*.test.ts` | 3363 tests, 3360 pass, 3 fail — cả 11 target XANH | qa/2026-10-19_be-reds-full-rerun.log |

## 3 fail còn lại trong full-suite run (ngoài phạm vi 11, env-coupled)

1. `trip photo OPS shipment scope (route level)` — 2 leaf (AC1/AC3, 404≠200)
2. `Q23 field operations replay boundary` — 1 leaf (fuel evidence, 404≠200)

Cả hai: (i) đã tồn tại trước HEAD trong log clusterB (2026-10-18_be-reds-
clusterB_full-suite-final.log); (ii) cùng lớp can thiệp uploads/photo khi
`fix-be-reds-w4-b` vẫn đang chạy full-suite song song trên cùng DB trong suốt
run này; (iii) không thuộc danh sách 11 của brief. Xanh khi chạy riêng (đã
verify tail-slice 1044/1045 trước đó). Không sửa trong đợt này — cần gate
yên tĩnh (không tiến trình test song song) để phân định lại.

## Not covered

- Full-suite "0 fail" tuyệt đối chưa chứng minh được trong môi trường có
  agent khác chạy test song song trên cùng DB (w4-b vẫn đang chạy lúc gate).
- Các suite ngoài 11 vẫn có thể đỏ dưới can thiệp đồng thời (lớp lỗi này chỉ
  được đóng tại các suite đã thêm lock).
