# Card 051026231617 — Chi tiết chi hộ: dòng âm vs footer Tổng trả (regression case)

Case ID: TC-051026231617-01
Feature: dialog "Chi tiết chi hộ" (PhoiPhieuChiHoDialog) và dialog "Chi tiết tiền đường" (PhoiPhieuTienDuongDialog) — footer tổng và các dòng tiền âm.

## Quyết định sản phẩm đã có (ràng buộc, không mở lại)
Số tiền chi phí SIGNED là luật PM từ card 20260928_181/197: dòng âm là điều chỉnh và **bị loại khỏi mọi tổng** (`sumExcludingNegative`) — "mọi tổng tính như thể dòng không tồn tại". Footer "Tổng trả" = tổng dương (gross) là ĐÚNG thiết kế; không đổi công thức.

## Repro (trước khi sửa — đúng kịch bản staging trip 103 / EGLV790676233174)
1. Kế toán mở "Chi tiết chi hộ EGLV790676233174": 5 dòng, Số tiền trả = −50.000, +50.000, +50.000, −50.000, −50.000.
2. Footer: "Tổng trả 100.000 ₫" trong khi tổng các dòng = −50.000 ₫ — mâu thuẫn không lời giải.

## Expected (sau khi sửa)
- Công thức GIỮ NGUYÊN: Tổng trả gross dương (loại dòng âm theo luật PM); test hiện có PHOI07 vẫn pass.
- Khi có dòng âm: hiện ngay dưới footer dòng giải thích — `Có N khoản chi âm, tổng -X ₫ — không tính vào Tổng trả.` (chi hộ) resp. `Có N khoản tiền đường âm, tổng -X ₫ — không tính vào Tổng phát sinh.` (tiền đường) → bộ số reconcile nhìn thấy được: Tổng trả + tổng dòng âm = tổng thật các dòng.
- Không có dòng âm → không hiện gì.
- Số tiền qua `round2dp()`/`formatMoney()` của shared; không có số học mới ngoài reduce + round2dp.

## Automated pins
- `frontend/src/features/accounting/PhoiPhieuChiHoDialog.test.tsx` — fixture đúng kịch bản thẻ (2 dương +50k, 3 âm −50k): footer vẫn `100.000₫` + note "Có 3 khoản chi âm, tổng -150.000 ₫ — không tính vào Tổng trả."; không dòng âm → không note. (Đã chứng minh red bằng mutation: gỡ note → 2 test mới fail, còn lại green.)
- `frontend/src/features/accounting/PhoiPhieuTienDuongDialog.test.tsx` — cùng hợp đồng cho "Tổng phát sinh"/"Đã duyệt".

## Bằng chứng staging (read-only, GET)
`qa/2026-10-06_chiho-footer-staging-probe.log` — trip 103: 5 dòng đúng như thẻ; backend board `chiHoTra = 100000` (cùng luật gross) → toàn hệ thống nhất quán dưới luật PM, chỉ thiếu lời giải thích ở dialog.

## Not covered
- Rung 3 chụp màn hình dialog có dòng âm trên staging bằng giao diện thật (probe này là API read-only; lane chính chụp khi QA).
- Không đụng backend/report: mọi tổng backend đã theo cùng luật `sumExcludingNegative` từ card 20260928_197.
