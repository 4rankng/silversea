# TiepVu 22/10-3 — search kho "GLC": gõ đè lên giá trị đã chọn bị ăn ký tự đầu (stale state race)

Source: docs feedback 23/10 (TiepVu22Oct-3 / TiepVu22Oct-4.docx image4 — gõ
đủ "GLC" không ra, gõ "LC" lại thấy). Environment: local dev (make dev —
backend :3002, frontend :7175, PG :5441). Accounts: testplan/testaccounts.txt.

## Phân tích (repro 2026-10-23, qa/2026-10-23-search-glc-race)

- KHÔNG có server-side search theo keystroke: network log chỉ có
  `GET /operational-sites?scope=shared` (lúc mount) và `?customerId=1` —
  filter 100% client-side (`matchesComboboxSearch`, normalize + contains).
- Path "2 ký tự ra / 3 ký tự không ra" không phải ngưỡng đổi query: "LC"
  không bao giờ trùng label "GLC" (không phát sinh id-roundtrip), còn "GLC"
  trùng đúng label → onCustomValue resolve id → form value đổi.
- Lỗi THỰC SỰ còn sót trên main (sau fix 261022213755b): gõ đè lên ô kho ĐÃ
  CÓ giá trị chọn (picked). Keystroke đầu tiên làm onCustomValue clear id
  (value: id → ''), sync effect trong uui-searchable-field chạy
  `setInputValue('')` → ĂN mất chữ vừa gõ: gõ "GLC" → ô còn "LC". Đây là
  race "state cũ ghi đè input mới" — cùng họ với stale-response race.

## Case TV3-A — gõ đè lên pick: mọi keystroke phải được giữ

1. CUS → /shipments/new → khách LONG MINH → Nhập khẩu → Hàng lẻ.
2. Ô "Kho lấy hàng": chọn 1 kho bất kỳ (vd "Kho ST") — ô hiển thị label.
3. Select-all + gõ tuần tự G, L, C (delay 0/40/120/400ms đều phải pass).
4. Sau MỖI keystroke: input PHẢI đúng text đã gõ ("G", "GL", "GLC") —
   không bị reset về '' hay label cũ.
5. Sau "GLC": menu còn mở (aria-expanded=true), option GLC hiển thị.
6. Click option GLC / Enter → commit đúng site id của kho GLC.

## Case TV3-B — regression các path đã xanh (261022213755b giữ nguyên)

1. Ô trống: gõ G→GL→GLC menu mở, GLC hiện ở cả 3 bước (TV2-B cũ).
2. Gõ "LC" (không trùng label): menu mở, GLC hiện (contains).
3. Gõ có dấu "Bãi" / "Đà Nẵng": normalize không dấu vẫn match searchText
   ("Bãi GLC" trong searchText của kho GLC; "BB Đà Nẵng" theo label).
4. Pick thật sau khi gõ đủ label vẫn commit id (không hồi quy 20260922_4).

Expected: phiên gõ (typing session) sở hữu text hiển thị — mọi thay đổi
value từ passthrough giữa chừng không được đè text người dùng đang gõ.
