# Case QA-2026-10-04-327 — Mobile: nền phủ kín tới đáy màn hình, hết dải trắng (card 20261004_327)

- Card: 20261004_327-mobile-bottom-screen-gap (visual bug P2, user-reported iPhone screenshot)
- Environment: local dev (:7175) DEV evidence (pixel-probes); staging + iPhone Safari thật = QA rung
- Accounts: thanhdc (CUS), admin
- mutates: none (bộ lọc tìm kiếm only)

## Repro (pre-fix)
1. Trên iPhone (Safari/Chrome), vào "Tổng quan lô hàng" (/shipments), Tháng 10/2026, danh sách NGẮN.
2. Dưới thẻ lô cuối cùng: khoảng trắng/dải trắng lớn kéo tới tận đáy màn hình vật lý.

## Expected (post-fix)
- Nền (--bg) liền mạch từ dưới thẻ cuối xuống đáy màn hình (kể cả safe-area); không dải trắng ở 390x844 / 414x896 / 375x667 và Safari iOS thật.

## Rungs
- UI DRIVEN: short-list state (788px nội dung < 844 viewport) — mẫu pixel dải dưới nội dung = RGB(227,232,229) = --bg tuyệt đối; captures 3 kích thước AC2 với dữ liệu thật.
- TEST VERIFIED: styles/mobile-viewport-fill-contract.styles.test.ts 7/7 (red-first 6 failed → green), bottom-nav + mobile-gutter 18/18.
- Staging + real-device rung: iPhone Safari vuốt toolbar co giãn — HẠNG MỤC NÀY desktop không thay thế được (ghi rõ trong evidence).

## Status
- [x] local visual rung executed (lead) — 04/10 (pixel-proven short-list; real-Safari rung thuộc staging)
- [ ] staging rung executed (lead)
