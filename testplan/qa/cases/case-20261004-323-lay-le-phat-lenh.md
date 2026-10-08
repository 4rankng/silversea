# Case QA-2026-10-04-323 — Lấy Lẻ "Phát lệnh" không bị chặn bởi validation tuyến (card 20261004_323)

- Card: 20261004_323-lay-le-phat-lenh-blocked (bug P1, QA-found staging 04/10)
- Environment: staging https://vantai.tingting.vip (QA rung sau cut) — fix đã land 18dc6eb3
- Accounts: dungnv / Abc123 (Điều vận) + tài khoản lái xe nhận lệnh
- mutates: 1 fixture row SHP-2609-00249 (phát lệnh thật trên staging — được phép)

## Repro (pre-fix)
1. Đăng nhập dungnv, /dispatch-detail, dòng SHP-2609-00249 (fulfillment 172, "Lấy Lẻ").
2. Gán xe 15H-061.14 (Bùi Quang Hường) → "Lưu thay đổi".
3. Bấm "Phát lệnh": banner đỏ "Dữ liệu đã thay đổi. Vui lòng tải lại."; sau reload nút "Phát lệnh" vẫn còn — lệnh không đi. Dòng báo "Container chưa có tuyến đường hợp lệ." dù cột TUYẾN ĐƯỜNG hiển thị tuyến.
4. Lái xe không nhận được lệnh; /ops/orders vẫn "Sẵn sàng phát lệnh".

## Expected (post-fix)
- "Phát lệnh" thành công cho lô Lấy Lẻ có tuyến ở cấp shipment (fallback containerRoute.routeId ?? shipment.routeId); không 409 "Container chưa có tuyến đường hợp lệ".
- Lệnh tới app lái xe ("Lệnh mới"); OPS queue chuyển trạng thái đúng.

## Rungs
- UI DRIVEN (staging): nguyên chuỗi repro trên — gán xe → Phát lệnh → toast thành công → đăng nhập lái xe thấy lệnh.
- TEST VERIFIED: backend regression trong các commit fix (dispatch-planning-commands.service.ts fallback) — xem evidence block trong card.
- Build-currency: verify /api/health buildHash trước khi chấm.

## Status
- [ ] local visual rung executed (lead) — (BE fix; rung tập trung staging)
- [ ] staging rung executed (lead)
