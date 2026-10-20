# FB-061 lan 3 — /users vẫn còn dữ liệu mẫu: đơn vị "Đơn vị CUS Demo" (card 201026112400)

**Card:** `201026112400` (FB-061 STANDING lần 3, 2026-10-20)
**Surface:** admin → `/users` (Người dùng) — staging `vantai.tingting.vip`
**Class:** dữ liệu mẫu trong staging DB (prod-mirror qua `make stgdb`) — lần này
không phải user rows mà là **business unit demo-seed** trong catalog
"Đơn vị phụ trách" của chính trang /users.

## Repro (2026-10-20, staging build `d6d04ce6`)

Wire probe `testplan/qa/scripts/2026-10-20-fb061-lan3-users-probe.mjs`
(login admin → `GET /api/auth/users?limit=500` → drive `/users` @1440 + @390,
scan TOÀN BỘ trang): 72 user rows sạch (0 signature — thành quả lan 2), nhưng
payload trả kèm `businessUnits: [{id:6, code:'CUS-DEMO', name:'Đơn vị CUS
Demo', status:'ACTIVE'}]` và DOM render nó trong section "Đơn vị phụ trách":

- `bodyHits` cả 2 viewport: `demo-business-unit` (Đơn vị CUS Demo),
  `demo-unit-code` (CUS-DEMO).
- Screenshot: `qa/2026-10-20-fb061-lan3-users/201026112400_before_ui-01-desktop1440-users-page.png`
  (+ `-02-mobile390`, DOM/rows dumps, `users-probe-before-driver.log`).

Lỗ hổng của lan 2: UI drive lan 2 chỉ assert trên `table tbody tr` (rows phân
trang) nên catalog "Đơn vị phụ trách" (BusinessUnitsManager, admin-only) không
bị quét — human QA nhìn thẻ "Đơn vị CUS Demo — Mã CUS-DEMO · Đang sử dụng" ngay
dưới bảng và báo FAIL đúng.

## Root cause

1. `Đơn vị CUS Demo` là **demo-seed data**: `backend/src/seed.ts`
   `seedClerkScope()` tạo unit `CUS-DEMO` và link vào clerk demo `cus`.
2. Registry lan 2 mis-classify nó là "the single real unit" (comment surface
   `business_units`) — predicate `name ILIKE 'QA%' OR code ILIKE 'QA%'` cố ý
   không match, nên `make stgdb` / `make demo` / `make qapurge` không bao giờ
   dọn nó.
3. Reference census staging 2026-10-20 (psql qua SSH, read-only): unit 6 được
   tham chiếu bởi ĐÚNG 1 link (`user 78 cus` — đã soft-delete bởi surface
   demo-trio lan 2), 15 shipment `responsible_unit_id=6` **đều tạo ngày
   2026-09-19** (cùng ngày seed — là demo shipments, không phải lô thật),
   0 `salary_period_closes`. Không có gì thật gắn vào unit.
4. Read path `listBusinessUnits()` trả mọi row (thiết kế lifecycle surface —
   render cả INACTIVE để admin khôi phục), `business_units` không có
   `deleted_at` → soft-delete/deactivate **không thể** clears /users (đúng
   ruling card 111026105610). Bắt buộc hard-delete row.

## Fix (cơ chế sanctioned FB-061 — chạy trong `make stgdb`, `make demo`, `make qapurge`)

`QA_FIXTURE_REGISTRY` +2 surface staging-only (`envs: ['staging']`), đặt ngay
sau surface `business_units` QA (array order = executor order):

1. `user_business_unit_links` — `business_unit_id IN (SELECT id FROM
   business_units WHERE code = 'CUS-DEMO' OR name = 'Đơn vị CUS Demo')`,
   hard-delete (children trước).
2. `business_units` — `code = 'CUS-DEMO' OR name = 'Đơn vị CUS Demo'`,
   hard-delete. Exact-match `=` (không wildcard) lấy từng byte từ seed literal
   → không thể trúng unit admin tạo sau này. Không guards (zero FK vào
   business_units — cùng enumeration với surface QA-units; dangling
   responsible_unit_id trên 15 seed shipments behaved như INACTIVE vì mọi
   reader lọc status='ACTIVE').

Env scoping: staging-only vì local dev-seed dùng thật CUS-DEMO (local `cus`
login); executor từ chối prod — unit còn trên prod chờ owner instruction riêng.

Tự lành sau `make stgdb`: restore re-import unit → step purge 4/5 trong stgdb
chạy build mới → unit bị dọn lại tự động. Không ai phải nhớ chạy tay.

## Gates

- BE tsc `npx tsc --noEmit`: **0 errors**.
- BE unit `pnpm test:unit`: **322/322 pass** (+6 pin mới
  `qa-fixture-business-unit-demo-surface.test.ts`: BUDEMO-1..6 — exact-literal,
  env-scoping, execution order, seed-drift pin đọc `seed.ts`).
- Root lint `pnpm lint`: **0 errors**.
- (Brief ghi "ruff + pytest" — repo này TypeScript; gate tương đương scoped là
  tsc + node:test/vitest ở trên; không có Python source nào bị đụng.)

## Verification plan

1. `make demo` deploy commit fix → purge trong deploy phải log
   `user_business_unit_links … deleted≥0` + `business_units … deleted=1` và
   `QA-PURGE-SUMMARY remaining=0`.
2. `make qapurge-dry` — idempotence: matched=0 trên cả 2 surface mới.
3. Re-run probe lan 3 → phải CLEAN (wire + DOM @1440 + @390, 0 hit), screenshot
   after kèm DOM/rows dump + driver log.
4. DB proof: `SELECT count(*) FROM business_units WHERE code='CUS-DEMO'` = 0.

## Results

(điền sau deploy — evidence tại qa/2026-10-20-fb061-lan3-users/)

## Trade-off / Not covered

- 15 seed shipments (2026-09-19) mất tên đơn vị phụ trách hiển thị (dangling id
  → mọi reader lọc ACTIVE nên render trống) — chúng là demo rows, không phải
  dữ liệu thật.
- Prod vẫn còn CUS-DEMO + trio demo users — purge từ chối prod theo thiết kế;
  cần owner instruction riêng.
- Role non-admin không thấy catalog (admin-only) — không đổi.
- Local dev giữ nguyên CUS-DEMO (dev-seed cần) — surface staging-only.
