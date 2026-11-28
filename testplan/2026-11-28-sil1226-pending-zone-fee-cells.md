# SIL-1226 (id 1411) — Phí nâng/hạ theo vùng (ZONE_SURCHARGE) chờ duyệt không đụng Lạch Huyện (regression case)

Case ID: TC-SIL-1226-01
Feature: Tổng hợp ô Lạch Huyện thu/trả trên /accounting/chot-debit và /accounting/ghep-bo-debit (K5.5 — phí theo đầu nâng/hạ, config port_zone_surcharges).

## Repro (QA, build 88418971, 28/11 — lô LG28-FCL-01/02)
1. Lô FCL nâng Hateco + hạ SITC Lạch Huyện: Lạch Huyện thu/trả 1.000.000/1.000.000 (config, đúng).
2. Ops mở /ops/orders → "+ Khai chi phí" → tab Phí không hóa đơn → "Phí nâng/hạ theo vùng" 1.500.000 → Lưu (chờ duyệt).
3. Mở lại chot-debit.

## Expected (trước fix bị sai)
- Lạch Huyện thu/trả VẪN 1.000.000/1.000.000 (config fallback không bị đè).
- Khoản phí Ops chỉ hiện ở nhóm phí không hóa đơn (dòng đỏ chờ duyệt — luật SIL-1072); Lợi nhuận giữ 4.462.000.
- Chi phí Ops KHÔNG loại khác (đối chứng "Đảo vỏ") không bị ảnh hưởng — giữ nguyên luật cũ.

## Root cause + sửa
- Charge 0 (chưa đàm phán) trả lời `charge != null` như negotiated 0 → cell thu = 0 KNOWN → config fallback không chạy; cost phí đè ô trả trong khi row còn chờ duyệt.
- Luật chung mới `zoneFeeBillsLachHuyenCells(confirmedAt)` (debit-receivable-arming.ts): row chờ duyệt (confirmedAt null) KHÔNG tính ô thu/trả ở CẢ 2 bảng; row ĐÃ duyệt vẫn đè ô (Ops override wins) — không đổi.
- Tổng TC: zone rows vẫn không góp theo luật SIL-1072 (pin cũ giữ nguyên — mong đợi ticket: phí chỉ hiện ở nhóm phí không hóa đơn).

## Pins
- `backend/src/tests/unit/sil1072-pending-zone-fee.test.ts` (describe SIL-1226) — predicate đúng confirmedAt; CẢ HAI service đọc MỘT luật; cost push nằm trong gate.

## Not covered
- Integration số liệu thật 2 bảng: QA verify staging sau deploy (khai phí mới → đối chiếu ô; và duyệt phí → ô đổi theo override).
