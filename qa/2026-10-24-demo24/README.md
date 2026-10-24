# SIL-161 — /demo/master-data UI evidence (UI DRIVEN, 1440×900)

Driver: `sil161-ui-driver.mjs` (Puppeteer headless, real login `admin` trên
stack dev địa phương — backend :3002, vite lane :7185; token inject trước
SPA navigation). Log: `sil161-ui-driver.log` — 16/16 assertions PASS,
0 console error, exit 0. Chạy 24/10/2026.

| # | Artifact | Bước click thật | Assertion DOM |
|---|---|---|---|
| 01 | `sil161-ui-01-fleet.png` | mở /demo/master-data, tab Đội xe nội bộ | dòng 51C-138.65 + chips [51C-138.65 + 51R-072.44 + Nguyễn Văn Tâm] |
| 02 | `sil161-ui-02-fleet-search.png` | gõ "469" vào ô search | ẩn dòng TRK-01, còn 72L-846.30 |
| 03 | `sil161-ui-03-fleet-added.png` | Thêm đầu kéo → fill form → chọn tài xế (listbox) → Thêm | dòng 51C-777.77 + chips có Nguyễn Văn Tâm |
| 04 | `sil161-ui-04-partners.png` | tab Đối tác (fullPage) | 3 bảng: 8 KH / 8 nhà máy / 3 nhà xe |
| 05 | `sil161-ui-05-partners-search.png` | search "samsung" | Samsung còn, Intel ẩn |
| 06 | `sil161-ui-06-rates-hover.png` | hover ô CL-40′-Xuất-Hạ (fullPage) | crosshair: cột Hạ 40′ Xuất + hàng CL tint bg-brand |
| 07 | `sil161-ui-07-rates-edited.png` | click ô VICT-20′-Xuất-Nâng → 1350000 → Enter | ô = "1.350.000 ₫" + live "Đã lưu — Cảng VICT — 20′ · Xuất · Nâng: 1.350.000 ₫" |
| 08 | `sil161-ui-08-freight-edited.png` | click FR-01 40′ → 5000000 → Enter | ô = "5.000.000 ₫" + "Đã lưu — Samsung…" |

Persistence: demo fixture-only (0 API call) — trạng thái lưu là React state
đọc lại từ DOM sau commit; không có DB side effect để lấy bằng chứng.

Lỗi tìm thấy bằng driver (đã sửa): header cấp 3 của ma trận phí lệch 1 cột
do `rowSpan=2` thiếu 1 hàng header → sửa `rowSpan=3`, chụp lại 06/07.
