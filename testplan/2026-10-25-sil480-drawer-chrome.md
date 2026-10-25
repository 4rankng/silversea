# SIL-480 — Drawer chi tiết lô: header quá lớn + nút dính header không gap (regression case)

Case ID: TC-480-01
Feature: Drawer chi tiết lô trên /shipments (`cus-shipment-drawer`) — chrome chuẩn hoá theo spec consult (bảng px, ticket SIL-480, owner 25/10/2026).

## Phàn nàn owner (nguồn: SIL-480 + ảnh `drawer-header-truoc.jpg`)
- Header quá lớn (76px, padding 16/28) so với chuẩn consult 56px.
- Nút (tabs Chi tiết lô hàng / Xóa lô) DÍNG header — gap header→content = 0.
- Close 40×40, title 16/700 wrap tự do, tabs 2 nút rời (secondary + ghost), content không có inset thống nhất.

## Spec chuẩn hoá (bảng px trong ticket — làm đích trên drawer này)
| Element | Spec |
|---|---|
| Header bar | cao 56, padding 0 20, border-bottom 1px hairline; title không wrap |
| Title | 18/24/600, truncate 1 dòng; subtitle 12/16 cách title 2 |
| Close | 32×32 ghost, icon 16, top 12 / right 12 |
| Tabs segmented | cao 32, padding 2, item 28, radius 8, font 13/500; active nền trắng + shadow nhẹ; container band house `--surface-2` |
| Content | padding 20/24; section đầu cách divider 16 |
| Section label | 13/16/500, uppercase, tracking .04em, muted ink |

Ngoài phạm vi chấp nhận (ghi rõ trên ticket): hàng "Drawer width 40vw min 480 max 720" — cả hai bản distilled (ticket IMPLEMENT + lệnh lane) đều không nêu; ledger đã tune theo @container băng rộng. Footer 64 / row 44–48: mục "nếu có", không thuộc chrome lần này.

## Automated pins
- `frontend/src/pages/ShipmentsPage.test.tsx` — it "normalizes the drawer chrome to the SIL-480 consult spec": min-height 56 + safe-area, align center, title 18/24/600 + ellipsis, close 32×32 + svg 16, lot-bar 32/2/`--surface-2`, seg item 28/13/`--fw-medium`, active `--surface` + `--shadow-sm`, body padding `16px 24px 20px`, ledger padding 0, section label 13/16 uppercase tracking .04em `--ink-3`; cấm hồi quy `cus-drawer-lot-detail`/`cus-drawer-lot-delete`.
- `frontend/src/pages/ShipmentsPage.test.tsx` — các test affordance "Xóa lô" theo role/name giữ nguyên (markup đổi class, giữ `<button>` + tên).

## Bằng chứng UI (run 25/10, local admin, worktree fix-drawer-chrome)
- `qa/2026-10-25-sil480/drawer-{390,768,1440}-before/after-{viewport,panel}.png` + `*-probe.json` (computed style) + `driver-before/after.log`.
- Before (cơ học): head 76px/padding 16–18·28, title 16/700 wrap, close 40×40, lot-bar 40 (item 40/30), body padding 0, headerToContentGap **0**.
- After (cơ học): head 56, title 18/24/600 truncate, close 32×32/svg 16, lot-bar 32 (item 28, 13/500, band + active shadow), body 16/24/20, headerToContentGap **16**.
