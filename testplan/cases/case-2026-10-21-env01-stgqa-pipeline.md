# ENV-01 — `make stgqa`: clone prod→staging + auto-purge + bộ fixture QA riêng

**Card:** ENV-01 (doc khách 21/10, Frank gật)
**Class:** môi trường QA — người dùng phải nhập liệu 2 lần khi test vì staging
prod-mirror không có dữ liệu mẫu; QA cần demo unit + fixture riêng nhưng mọi
view gương-prod phải sạch (FB-061 standing).
**Surface:** Makefile (`stgqa`), `backend/src/seed/seed-qa-fixtures.ts`,
`backend/src/seed/reset-staging-passwords.ts`, docs README/roles.

## Repro / động lực

1. `make stgdb` ngày nay chỉ sync prod→staging + purge QA (card 41–45) —
   staging sau sync là "prod sạch": KHÔNG có lô mẫu nào cho QA test luồng
   FCL/LCL/kẹp, phải nhập tay lại sau mỗi lần sync.
2. Quy tắc mật khẩu (testplan/testaccounts.txt 2026-09-06): sau mỗi sync phải
   reset `users.password_hash` về bcrypt(Abc123) — hiện là bước THỦ CÔNG bị
   quên.
3. FB-061: fixture QA phải mang dấu hiệu QA-class để view gương-prod tự ẩn
   (qa-fixture-markers) và `make qapurge` dọn được.

## Expected behavior (ENV-01)

1. `make stgqa` = 1 lệnh idempotent: `stgdb` sync → reset mật khẩu Abc123 →
   seed fixture QA (1 demo BU `QA-DEMO`, 1 KH demo, 1 nhà xe demo, 4 lô mẫu
   FCL IMPORT / FCL EXPORT / LCL / FCL kẹp 2×20').
2. Chạy pipeline 2 lần ⇒ kết quả như nhau (định nghĩa fixture tất định,
   upsert theo natural key, revive hàng soft-deleted).
3. Mọi tham chiếu fixture (code, name, bill/booking, container) nằm trong
   lớp dấu hiệu QA (`qa-fixture-markers`) ⇒ board gương-prod tự ẩn và purge
   registry dọn được.
4. User thật (NV00x / username thật) KHÔNG bị seed hay purge đụng tới; reset
   mật khẩu chỉ đổi `password_hash`, không đổi identity rows.
5. Script chỉ chạy khi có env grant (`STGQA_ENV=local|staging`) và từ chối
   DATABASE_URL trỏ prod — cùng luật với `purge-qa-fixtures.ts`.

## Verification

- Unit: `backend/src/tests/unit/stgqa-*.test.ts` (định nghĩa tất định, đủ
  loại FCL/LCL/kẹp, marker-class, check-constraint chiều IMPORT/EXPORT,
  không đụng users, env gates).
- Integration (local dev DB, không chạy trên staging trong PR):
  `qa/scripts/2026-10-21-env01-stgqa-idempotency.mjs` — seed 2 lần, census
  giống nhau; purge ⇒ census visible 0; seed lại ⇒ census về đúng lượng;
  snapshot users không đổi qua seed/purge.
- Staging runbook: hướng dẫn chạy `make stgqa` (không chạy trong PR);
  `make stgqa-seed` khôi phục fixture sau khi `make demo`/`make qapurge` dọn.

## Out of scope

- Không đổi hành vi `make stgdb` (mirror thuần, per FB-061 + convention doc).
- Không thêm purge theo cờ `isAdHoc`: lệnh chạy ngoài là dữ liệu KINH DOANH
  THẬT (MasterDataNhaMay §4.1), không phải lớp QA — purge theo cờ này sẽ
  xóa dữ liệu prod thật trong mirror.
- Không seed fixture trên prod (gate chặn tuyệt đối).
