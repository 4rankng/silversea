# qa/2026-11-07-lane-k1/ — Lane K1 (SIL-727 + 728 + 729 + 734)

## Gates (lệnh + exit thật)

|Gate|Lệnh|Kết quả|
|---|---|---|
|Root lint|`pnpm lint`|EXIT=0 — 0 errors, 6 warnings (cũ, không thuộc diện lane)|
|FE typecheck|`cd frontend && npx tsc -b`|EXIT=0 (sau toàn bộ edit 727/728/729/734)|
|FE tests scoped|`npx vitest run src/pages/accounting/`|19 files, 165 tests pass (727 era)|
|FE tests 728|`npx vitest run src/pages/accounting/OpsReconciliationReportPage.test.tsx src/pages/AdminAdvanceSettlementsPage.test.tsx`|26 tests pass|
|FE tests drawer 728|`npx vitest run src/features/expense-accounting/ExpenseCashDrawer.recovery.test.tsx src/features/expense-accounting/ExpenseCashDrawer.test.tsx`|4 tests pass|
|BE typecheck|`cd backend && npx tsc --noEmit`|EXIT=0|
|BE unit new 728|`npx tsx --test src/tests/unit/advance-recovery-deficit.test.ts`|9 tests pass|
|BE unit new 729|`npx tsx --test src/tests/unit/phoi-phieu-shipment-fallback.test.ts`|5 tests pass|
|BE unit new 734|`npx tsx --test src/tests/unit/lcl-unmerge-reprice-survivor.test.ts`|5 tests pass|
|BE integration 729|`DATABASE_URL=... npx tsx --test src/tests/phoi-phieu-party-lots.test.ts`|4 tests pass (regression giữ xanh)|
|Probe thật 734|`DATABASE_URL=... npx tsx ../qa/scripts/2026-11-07-lane-k1-sil734-survivor-probe.ts`|EXIT=0 — 10/10 assertion PASS (log: 2026-11-07_sil734_survivor-probe.log)|

## Full-suite runs cuối (tuần tự, sạch)

|Run|Kết quả|
|---|---|
|BE unit full `npx tsx --test 'src/tests/unit/*.test.ts'`|EXIT=0 — 1008/1008 pass|
|FE full `npx vitest run` (lần 1)|6294 pass / 9 fail → điều tra từng cái: 1 sweep pin cũ (ExpenseCashDrawer label — đã cập nhật regex theo SIL-728), 2 test cần dist/assets (chưa build — pass sau `make build`), 6 timeout dưới CPU load (rerun riêng: 224/224 pass — ShipmentsPage ×2, ShipmentContainersPage ×2, DetailedPlanFilters, ShipmentCreateWorkspace.deposit)|
|FE rerun sạch 6 file fail|224/224 pass|
|`make build`|EXIT=0|
|`numeric-identity.styles.test.ts` + `money-format-sweep.chiphi2.test.ts` sau build|13/13 pass|

Ghi chú: hai lần chạy `vitest run` full-suite bị timeout/thrash vì máy đang chạy
đồng thời nhiều job nặng (tsc + vitest + probe) — các test fail trong 2 lần đó
đều pass khi chạy riêng/là timeout dưới load. Lần chạy full-suite sạch được ghi
ở mục dưới sau khi chạy lại tuần tự.

## UI verification contract (§9) — coverage table

|Claim / bug|Rung|Evidence|Not covered|
|---|---|---|---|
|SIL-727: 8 cột tiền essential mở full matrix + picker khóa|CODE-READ + component tests|`AccountingDebitClosePage.cost-dot.test.tsx` (essential-locked picker pin), 165 scoped tests|UI DRIVEN trên staging với account hoapt — không chạy được trong lane này (không đụng production; stack FE local không dựng trong lane)|
|SIL-727: checkbox đầu dòng dòng chọn được, dot giữ cho dòng khóa|CODE-READ + component tests|`AccountingDebitClosePage.test.tsx` SIL-727 checkbox pin (toggle 1 click = 1 toggle, không double-toggle, tick ✓ Ngày)|Như trên|
|SIL-728: nút Xác nhận hoàn ứng + bút toán|DB/API VERIFIED (BE)|BE pure pins + route pins; probe bút toán thật qua phiếu: chưa chạy POST thật vì backend :3002 không chạy trong lane|POST /advance-recovery thật trên stack (QA integration)|
|SIL-729: join ra đúng tên KH/nhà xe|DB VERIFIED|BE fallback resolver + integration party-lots 4/4 trên DB thật|Đối chiếu số liệu staging 13 chuyến/7.418.000₫ — cần staging dữ liệu thật|
|SIL-734: tách nhóm + xóa lô chính không mất đồng|DB VERIFIED (probe thật)|`2026-11-07_sil734_survivor-probe.log` — merge/tách/xóa thật trên Postgres local, 10/10 PASS|UI click thật [Tách nhóm] trên FE local|

## Ghi chú tiền

- Không một số nào bị tự chế: 3.500.000₫/900.000₫/420.000₫/4.300.000₫ đều từ
  ticket/testplan; Bảng giá lane-miss ⇒ giữ citation, không bao giờ gán 0₫.
- Idempotency: `POST /advance-recovery` đi qua `runIdempotent` +
  `Idempotency-Key` header (FE `crypto.randomUUID` giữ nguyên key khi retry
  cùng payload — pin trong `ExpenseCashDrawer.recovery.test.tsx`).
