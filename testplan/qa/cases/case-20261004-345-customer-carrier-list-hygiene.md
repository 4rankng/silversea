# Case QA-2026-10-04-345 — Danh sách Khách hàng / Nhà cung cấp không được lẫn dòng test (card 20261004_345)

- Card: 20261004_345-import-customer-carrier-mapping-mixing (P2, feedback Zalo 04/10 — "trộn danh sách")
- Environment: staging vantai.tingting.vip (QA build 813a2b0d) qua API
- Account: admin / Abc123
- mutates: none (kiểm tra đọc); đợt dọn 04/10 soft-deleted 16 dòng test qua DELETE /api/customers/:id (Idempotency-Key + If-Unmodified-Since)

## Repro (pre-fix)
1. Đăng nhập admin. GET /api/customers (mặc định) — danh sách lẫn dòng test: "CÔNG TY TEST CARRIER FOCUS FIX 0909", "PROBE Tim Kiem…", "Khách C21 A/B", "Nhà xe C21 Alpha", "Nhà xe E2E <hex>"…
2. Khách nhìn hai danh sách cùng tên (LONG MINH ở cả hai) → kết luận "import ghi nhầm bảng".

## Expected (post-fix)
- GET /api/customers mặc định = 12 dòng KH thật; ?isCarrier=true = danh mục nhà xe riêng; KHÔNG dòng test/QA rơi rãi.
- LONG MINH ở cả hai = vai trò kép CÓ CHỦ ĐÍCH (customer.id=1.linkedSupplierId=34 — seed-customers.ts + decision D-E/F); import "Nhà xe" sheet → CARRIER-typed supplier + mirror customers.isCarrier (master-data-import-sep2026.service.ts) — không có đường ghi nhầm bảng.
- Fixture "Nhà xe E2E" sinh ra khi lượt E2E chạy → thuộc lượt chạy, không đụng khi đang sống.

## Rungs
- DB·API VERIFIED: probe 04/10 trước dọn 17/36 (nhiều dòng test) → sau dọn 12/25; transcript trong card.
- TEST VERIFIED: catalog-crud booleanFilters isCarrier=false (fix 10-03) — hai quần thể tách theo truy vấn.

## Status
- [x] probe + cleanup executed (lead) — 04/10
- [ ] prod data cleanup — CHỈ khi user duyệt phiên riêng (hard rule: agent không đụng prod)
