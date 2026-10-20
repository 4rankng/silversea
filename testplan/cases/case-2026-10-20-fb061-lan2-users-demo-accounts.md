# FB-061 lan 2 — /users vẫn liệt kê tài khoản demo/QA trên staging (card 201026112400)

**Card:** `201026112400` (FB-061 STANDING lần 2, 2026-10-20)
**Surface:** admin → `/users` (Người dùng) — staging `vantai.tingting.vip`
**Class:** dữ liệu mẫu tồn tại trong staging DB (prod-mirror qua `make stgdb`) —
code sạch ở mọi build từ `285e20e8`; đây là data residual, không phải read bug.

## Repro (2026-10-20, staging build `106a25e3`)

Wire probe `testplan/qa/scripts/2026-10-20-fb061-lan2-users-probe.mjs`
(login admin → `GET /api/auth/users?limit=500`): 77 users visible, 5 thuộc
lớp dữ liệu mẫu (`qa/2026-10-20-fb061-lan2-users/users-census.json`):

| id | username | fullName | role | nguồn |
|----|----------|----------|------|-------|
| 75 | `HAHA-email-probe2` | HAHA probe 2 | DISPATCHER | QA duplicate-email probe (2026-09-17) |
| 78 | `cus` | Nhân viên CUS Demo | CUS | demo seed, chưa được tái sử dụng tên thật |
| 79 | `dieuvan` | Nhân viên Điều vận Demo | DISPATCHER | demo seed, chưa được tái sử dụng tên thật |
| 85 | `customer` | Khách hàng Demo | CUSTOMER | demo seed, chưa được tái sử dụng tên thật |
| 89 | `e2e-dispatcher-37341` | E2E Dispatcher Workspace | DISPATCHER | e2e lane, không mang epoch-13 midfix |

## Expected

`/users` trên staging không hiển thị user mẫu; user thật (NV00x, driver thật,
các account demo đã tái sử dụng tên thật: `admin`, `giamdoc`, `ketoan`,
`laixe`, `giaonhan`, `khachhang`, `samsung-cs`, `canon-cs`…) phải nguyên vẹn.

## Root cause

Registry purge `QA_FIXTURE_REGISTRY` có surface `users` nhưng predicate
`username ILIKE 'qa%' OR full_name ILIKE 'QA%' OR username ~ '-[0-9]{13}-' OR
username ILIKE '%-inv-%'` không match 5 user trên:

- `e2e-dispatcher-37341`: prefix `e2e-` đúng lane QA nhưng suffix là số ngắn,
  không phải `<epoch-ms>-<rand>` 13 chữ số → lọt regex.
- `HAHA-email-probe2`: probe thủ công, không mang token QA/epoch nào.
- `cus`/`dieuvan`/`customer`: demo seed `backend/src/seed.ts` — tên không
  mang token QA. Các account demo khác đã bị ghi đè tên thật trên prod
  (staging mirror prod) nên an toàn; ba account này còn nguyên chữ "Demo".

Fix lần 1 (`d4d686d6`) chỉ probe `/accounting/phoi-phieu` (surface của card
gốc) — `/users` không được quét nên residual không bị phát hiện.

## Fix

Mở rộng purge registry (cơ chế sanctioned của FB-061, chạy trong `make stgdb`
và `make demo`/`make qapurge`):

1. Surface `users` hiện有: thêm branch `username ILIKE 'e2e-%'` và
   `username ILIKE 'HAHA-email-probe%'` (identifier-gated, enumeration-verified).
2. Surface `users` mới **staging-only** (`envs: ['staging']`): demo-seed trio
   `(username IN ('cus','dieuvan','customer') AND full_name ILIKE '%Demo%')`
   — soft-delete. Conjunct `%Demo%` bảo vệ mọi account demo đã mang tên thật;
   local dev-seed không bị động chạm (local cần demo logins).
3. Executor học đọc `envs` (default: cả hai env) — surface bị skip được log
   rõ, không tính vào `remaining` (không gây exit 2).

## Trade-off ghi nhận

`cus` từng được dùng làm login CUS trên staging trong 2 script FB-113
(`2026-10-20-fb113-standing-*.mjs`). Sau purge, các lane CUS trên staging phải
dùng account đúng contract `testplan/testaccounts.txt`: `thanhdc` (NV018),
`tiepvv`, `anhdtv`, `huyenntt`, `anhntn`. FB-113 đã verify PASS (R26) nên
không lane đứng nào gãy.

## Verification plan

- Unit pin: `backend/src/tests/unit/qa-fixture-users-surface.test.ts`.
- Staging: deploy (`make demo` — purge chạy trong deploy) → `make qapurge-dry`
  (idempotence: matched=0) → API probe lại (0 flagged, 72 users) → UI drive
  `/users` rung 3 (screenshot + DOM + driver log) theo §9 AGENTS.md.
