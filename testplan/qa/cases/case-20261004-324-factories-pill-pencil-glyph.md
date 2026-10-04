# Case QA-2026-10-04-324 — Pill "Đang dùng" không còn dính glyph bút chì (card 20261004_324)

- Card: 20261004_324-factories-pill-pencil-glyph (UI bug P3, QA-found on staging 04/10)
- Environment: local dev (:7175) for DEV evidence; staging https://vantai.tingting.vip for QA rung
- Account: dungnv / Abc123 (Điều vận)
- mutates: none (read-only navigation + one dialog open/close via Hủy)

## Repro (pre-fix)
1. Đăng nhập, vào Khai báo → Nhà máy / Kho (`/config/factories`).
2. Quan sát cột TRẠNG THÁI: pill "Đang dùng" (xanh) có glyph bút chì nhỏ dính mép phải trên hầu hết các dòng (do hàng icon thao tác của cột THAO TÁC tràn mép trái đè sang — root cause băng qua ô liền kề).

## Expected (post-fix)
- Cột TRẠNG THÁI sạch: không còn fragment glyph bút chì trên mọi dòng ("Đang dùng"/"Đã ngưng").
- Hàng nút Sửa (bút chì) / Xóa (thùng rác) trong cột THAO TÁC hiện đủ, căn phải, không bị cắt ở mọi độ rộng hỗ trợ.
- `/config/routes` (band 680–1100px, coarse pointer): Sửa/Xóa nằm trong cột của chúng, không đè "Ghi chú"/"Khoảng cách".

## Rungs
- UI DRIVEN (visual rung, local dev): full-page state matrix /config/factories + /config/routes @ 1280/1440/1920/2560; criterion crop cột TRẠNG THÁI + THAO TÁC.
- TEST VERIFIED: `config-action-glyph-bleed.styles.test.ts` (red-first 5/5 → 18 green), `FactoriesConfigPage.test.tsx` DOM pin.
- Staging rung: re-run after staging cut; record buildHash.

## Status
- [x] local visual rung executed (lead) — 04/10: real-tap rung on 14-item dataset, layout probes (52/46/80/80px status→pencil gaps at 4 widths), matrix factories+routes × with-data/empty/error
- [ ] staging rung executed (lead)
