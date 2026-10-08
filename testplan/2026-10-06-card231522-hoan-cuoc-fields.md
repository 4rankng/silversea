# Card 051026231522 — Hồi quy: Theo dõi hoàn cược thiếu trường + auto-record (5.10 Table 1.1.3)

Ngày: 2026-10-06 · Agent-MiMo

## Phạm vi hồi quy (trước khi làm)

| # | Khu vực | Rủi ro | Trường hợp kiểm |
|---|---|---|---|
| R1 | `createDepositTracker` input mở rộng (depositDate, status) | phá create cũ (dialog hiện tại không gửi 2 field) | create cũ (6 field) vẫn chạy; field mới optional |
| R2 | `isCvOverdue` anchor | test card 20260923_14 pin theo createdAt | row thiếu depositDate → anchor = createdAt (hành vi cũ, test cũ xanh); row có depositDate → anchor = depositDate |
| R3 | `markDepositRefunded` composition khi tạo ĐÃ hoàn cược | double-post tiền quỹ, idempotency | tạo mới status=DA_HOAN_CUOC → posting quỹ chạy ĐÚNG 1 lần qua engine cũ (không logic tiền song song) |
| R4 | Auto-record khi CUS tích "có cược" | nhân bản row (retry), sai số Bill | hasDeposit=true → 1 row tracker (bill=bookingRef, amount đúng); hasDeposit=false → 0 row; retry idempotent |
| R5 | Expected refund date | quy tắc CV+14 | Ngày dự kiến = Ngày nộp CV + 14 (để trống → tự điền); field sửa được |
| R6 | 2 cảnh báo (cộng dồn, chưa hoàn cược) | bị phá / trùng logic #375 | KHÔNG đụng logic cảnh báo hiện có (card 20260923_14 + 370) — verify giữ xanh |
| R7 | Migration schema | mất dữ liệu, downtime | thêm cột nullable, không cột mới NOT NULL, rollback drop-column an toàn |

## Quyết định đã chốt

1. "Ngày cược" = cột `deposit_date` nullable mới; anchor cảnh báo CV = COALESCE(depositDate, createdAt) — không đổi hành vi row cũ.
2. "Ngày dự kiến hoàn cược" = Ngày nộp CV + 14 (công thức trong thẻ); để trống tự tính, sửa được.
3. "Trạng thái" trong dialog tạo: Chưa/Đã hoàn cược; chọn Đã → chạy posting quỹ qua markDepositRefunded (compose, không tạo dòng tiền mới).
4. Auto-record ở SERVER khi tạo shipment với hasDeposit=true (atomic, sống sót khi FE lỗi); Số Bill = bookingRef; Hãng tàu = 'Chưa phân xe' placeholder (điều vận phân sau); Ngày cược = ngày tạo (VN).
5. 2 cảnh báo đã tồn tại (kiểm tra check cược + Chưa hoàn cược số tiền) — KHÔNG làm lại (đặc tả card 369 cấm lặp logic #375); chỉ verify + ghi evidence.
