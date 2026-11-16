# SIL-824 (id 953) — NÂNG/HẠ cắt token 'Cảng VipGreenPort' tại mọi canvas

- **Ticket**: SIL-824 · board plan.tingting.vip/tingtingsoft/SIL · priority URGENT
- **Filed QA**: frankn.sg 15/11 (build 1a0ea1c5) + 16/11 13:31 SGT (build 4db1a331) — hai lần FAIL cùng defect.
- **Status**: FIX LANDED 16/11 — case giữ làm regression pin.

## Reproduction (trước fix)

1. Đăng nhập (staging: `tiepvv`; local: `admin`), mở **Chi tiết lô hàng** (`/shipments-detail`).
2. Lọc ngày **Tất cả**, tìm dòng có điểm nâng/hạ **Cảng VipGreenPort** (QA repro: tờ khai `108590773650`, container `EMCU6163403`; local: shipment 133, container `EGSU0180803` — hạ tại cảng VipGreenPort).
3. Đưa canvas vào chế độ bảng fixed-px (1920 sidebar mở, hoặc 1440 sidebar đóng — canvas ≥1327).
4. Quan sát cột **NÂNG/HẠ**: tên địa điểm render `Cảng VipGreenPor` — chữ `t` cuối tràn qua biên phải ô và bị cell kề bên đè lên (còn "vệt mờ").

## Root cause (đo thực tế, webfont app tự host)

1. **Floor stale**: `--led-w-route: 88px` được tính từ số đo `'VipGreenPort'` = 74px của tier nhỏ hơn (SIL-819). Tier chữ hiện tại là primary 12px/600 — token đo thật **79.3px**, line box 88px chỉ còn ~75px → token không bao giờ vừa, tại MỌI canvas (cột fixed-px).
2. **Emergency break bị tắt**: td đang có luật `overflow-wrap: anywhere` (hoạt động), nhưng `.shipment-container-ledger__route > span` tự ghi đè `break-word` — trong ngữ cảnh grid con của table-layout:fixed, Chrome **không bao giờ fire `break-word`** → token (`NORGHTFREIGHT` 104px đo thật) tràn 24px qua biên thay vì xuống dòng lộ rõ.

## Expected behavior (sau fix)

- `VipGreenPort` (79.3-80.1px) hiển thị **nguyên token** trên một dòng trong line box 83px (floor 96px − 1px border − 12px trigger padding sau khi hạ padding-inline trigger 10→6px theo lever SIL-819) — không cắt, không vỡ chữ.
- Tên nhiều từ (`Cảng VipGreenPort` 113.8px) wrap tại dấu cách — mỗi token nguyên vẹn.
- Token bất thường dài hơn cả line box (`NORGHTFREIGHT` ~104px đo probe) break **lộ rõ** trong ô (law anywhere) + tooltip giữ trọn giá trị — không còn clip vô hình.
- Audit số liệu thật: mọi floor khác đã hết slack dưới chrome thật 21px (trigger 10×2 + border 1px — td padding thật là `0 !important` dưới `__editable-cell`, model cũ giả định 24px padding td là sai) → **không fund từ cột khác**; route 88→96 làm fixed-sum 1188→1196, min-width 1332, guard nâng 1326→1334 (canvas 1440 sidebar-đóng đo 1344 trên shell hiện tại — vẫn bảng, cách guard 10px).
- Không scroll ngang ở 1440 sidebar đóng; dưới ngưỡng vẫn card grid.

## Regression pins

- `frontend/src/pages/ShipmentContainersPage.styles.test.ts` — ladder pin: `billbook 108 · shippingline 92 · route 96`, sum-close 1188; route span pin `overflow-wrap: anywhere`.
- Driver đo hình học: `qa/2026-11-16_sil824-route-clip.mjs` (quét mọi cell NÂNG/HẠ: tokenWidth vs line box, clip/shatter flags, mode, canvas).
