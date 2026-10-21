# Case QA-2026-10-21-hoanung-am-signed-refund — Hoàn ứng SỐ ÂM (chi phí vượt tạm ứng)

## Nguồn (QA R30 follow-up, 21/10/2026, LOCAL)

QA R30 chưa verify được kịch bản "Hoàn ứng số âm — cần chi phí vượt tạm ứng
(chi phí gắn với chuyến xe)" vì thiếu data/flow rõ. Case này chốt lại hành vi
đúng đã audit + verify E2E trên local dev.

## Kịch bản chuẩn

| ID | Bước | Kỳ vọng |
|---|---|---|
| HUAM-R1 | Ops gửi yêu cầu tạm ứng 100.000 (PENDING) | tạo OK, chờ duyệt |
| HUAM-R2 | Kế toán duyệt tạm ứng (`POST /api/advance-requests/:id/approve`) | status RECORDED + giải ngân: ledger `OPS_ADVANCE` credit 100.000 + treasury `OUT` 100.000 (duyệt = giải ngân, KP-148) |
| HUAM-R3 | Ops ghi chi phí gắn chuyến 150.000, `settlementMethod=OPS_ADVANCE` | tạo OK; **auto-offset phải TỰ BỎ QUA** (100k < 150k — không được overdraw tạm ứng): khoản chi còn "chưa thanh toán", không có settlement tự động |
| HUAM-R4 | Ops xác nhận kê xong (completion COMPLETED) | khoản chi đủ điều kiện đưa vào phiếu |
| HUAM-R5 | Nhập "Tiền hoàn lại" **−50.000** → tạo phiếu hoàn ứng | 201; `refundAmount = -50000`; cân đối 100.000 − 150.000 − (−50.000) = 0 |
| HUAM-R6 | Nhập "Tiền hoàn lại" **+50.000** (phiếu LỆCH) | 400 `Phiếu chưa cân đối: tạm ứng 100000, chi phí 150000, hoàn lại 50000` |
| HUAM-R7 | Trang kế toán `Tạm ứng & hoàn ứng` → tab **Phiếu hoàn ứng** | dòng phiếu hiển thị `Hoàn lại -50.000 ₫` (summary strip, KHÔNG bị ẩn vì số âm) |
| HUAM-R8 | Kế toán bấm **DUYỆT PHIẾU HOÀN ỨNG** | DOM chuyển "Đã duyệt (KT): <kế toán>"; DB `checked_by`/`checked_at` được stamp; bút toán `OPS_SETTLEMENT` debit = 150.000 + (−50.000) = **100.000** (số dư Ops hội tụ về 0) |
| HUAM-R9 | Duyệt lại lần nữa | 409 `Phiếu đã được kế toán duyệt.` |

## Ý nghĩa nghiệp vụ của số âm

`refundAmount` là TIỀN OPS HOÀN LẠI CÔNG TY. Chi vượt tạm ứng ⇒ số âm ⇒
**Cty phải trả thêm Ops** phần chênh (card 2026-10-05_1544: "nếu dương: Cty
thanh toán hoàn ứng; nếu âm: Cty yêu cầu hoàn trả tạm ứng" — trên trang phiếu,
áp cho phần CHƯA quyết toán). Phiếu cân đối với số âm là hợp lệ, không block
duyệt (FB-100, card 141026230770 — `signedNumeric`).

## Verify (21/10/2026, local dev :3002/:7175/:5441)

- E2E 20/20 PASS: `qa/2026-10-21-hoanung-am/e2e-driver.log`,
  `probe-result.json` (settlement PT-2610-0009 #2212, refund −50.000).
- UI DRIVEN: `qa/2026-10-21-hoanung-am/ui-07-admin-summary-am.png` (dòng
  `Hoàn lại -50.000 ₫`), `ui-08-after-duyet.png` (`Đã duyệt (KT): Nguyễn Thị
  Mai`); DB: `db-proof.txt` (refund_amount=-50000, checked_by=3, ledger
  OPS_ADVANCE credit 100.000 / OPS_SETTLEMENT debit 100.000, treasury OUT).
- Unit: `backend/src/tests/hoanung-am-signed-refund.test.ts` (5 case — schema
  signed refund + reversal convergence).
- Gates: be-tsc 0 error; scoped BE tests 9/9 (`be-tsc.log`, `be-tests-scoped.log`).

## Reproduce

```sh
node testplan/qa/scripts/2026-10-21-hoanung-am-e2e.mjs
# env: API_PORT, FRONT_PORT, ACCOUNTANT, OPS_USER, SHIPMENT_ID, TRIP_ID, SKIP_UI=1
```

Script tự tạo user OPS `hoanungqa` (ví tiền trống, tránh auto-offset của tạm
ứng cũ), chạy đủ chuỗi R1→R9, ghi evidence vào `qa/2026-10-21-hoanung-am/`.
LOCAL ONLY — không trỏ staging.

## Coverage gaps (chưa phủ)

- Mobile card kế toán (`as-mcard`): card "Hoàn lại" chỉ render khi refund > 0
  — số âm chỉ thấy qua "Tạm ứng quyết toán" (= chi + hoàn) ở strip desktop.
  Đã ghi nhận là hạn chế hiển thị, không chặn nghiệp vụ (detail page
  `/settlements/:id` + notice "Công ty thanh toán hoàn ứng" vẫn đúng).
- Trang danh sách Ops `/my-settlements`: tương tự, "Hoàn lại" chỉ hiện khi > 0;
  số âm xem ở trang chi tiết phiếu.
