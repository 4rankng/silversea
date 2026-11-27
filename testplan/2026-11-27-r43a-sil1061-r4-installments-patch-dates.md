# SIL-1061 R4 + SIL-1061 API 2 — Hoàn cược từng phần: đợt 2 bị chặn 409, PATCH dates

Ngày: 2026-11-27 · K2.118 / K2.150 / KB Ch.2 §2.4.7 · r43a GLM

## Bug 1 — R4: đợt hoàn thứ 2 chết 409 "Mã giao dịch thực tế đã được ghi nhận trên tài khoản này"

- **Trước sửa**: tick 500.000₫ trên cược 2.000.000₫ → 200; tick tiếp phần còn lại
  1.500.000₫ → 409 — mã movement `HOAN-CUOC-{id}-{bill}` cố định THEO DÒNG,
  khóa uniqueness kho quỹ (account + direction + physicalReference) đâm trùng
  ở đợt 2. Deposit kẹt bán-đã-hoàn.
- **Sau sửa**: mã xoay THEO TỪNG ĐỢT — đợt 1 giữ mã gốc (R1–R3 nguyên vẹn),
  đợt n ≥ 2 = `{base}-{n}` (luật xoay -R2/-R3 của phoi-phieu, a6cdb613).
  Số đợt = đếm movement POSTED của đúng dòng cược (prefix `HOAN-CUOC-{id}-`,
  khớp base hoặc hậu tố `-số`) trong tx đang khóa dòng FOR UPDATE — count-then-post
  không race.

| # | Trường hợp kiểm | Kết quả mong đợi |
|---|---|---|
| R4.1 | Tick 500.000₫ rồi tick 1.500.000₫ cùng dòng | 200 + 200; 2 movement `HOAN-CUOC-{id}-{bill}` (500.000) và `…-2` (1.500.000); dòng flip ĐÃ khi đủ 2.000.000 |
| R4.2 | Tick đợt 3 trên dòng đã đủ | 409 'Dòng này đã ghi nhận hoàn cược — không thể tích lại.'; không post thêm movement |
| R4.3 | Ledger vẫn bút toán quỹ ADJUSTMENT credit-only `DEPOSIT_TRACKER:{id}`, mỗi đợt một dòng | nguyên vẹn (§3 regression) |

## Bug 2 — PATCH /api/accounting/deposits/{id}/dates "404 Không tìm thấy API"

- **Đo firsthand 27/11 (local HEAD + staging ce561f5f)**: PATCH có body `{}` lên id
  999999 → **404 "Không tìm thấy dòng theo dõi hoàn cược."** (404 NGHIỆP VỤ của
  handler — route không hề mất; 404 catch-all "Không tìm thấy API" KHÔNG tái hiện
  trên cả 2 môi trường). Route `router.patch('/:id/dates')` + mount
  `/api/accounting/deposits` + 2 trường `recoveredAmount`/`refundReceivedDate`
  đã có từ 070fdbb0. Verdict: không có lỗi route tại HEAD; probe của owner có khả
  năng lệch URL/method hoặc bắn vào process cũ. Contract vẫn được pin thêm test.
- **Contract (đã pin test + live)**: PATCH 2 trường trên dòng CHUA_HOAN_CUOC → 200;
  giảm `recoveredAmount` khi `refund_posted_movement_id` đã có → 400
  'Dòng đã ghi nhận hoàn cược qua bút toán quỹ — không thể giảm số đã hoàn.'

| # | Trường hợp kiểm | Kết quả mong đợi |
|---|---|---|
| R5.1 | PATCH {refundReceivedDate} sau khi hoàn một phần | 200, ngày nhận đổi, số đã hoàn giữ |
| R5.2 | PATCH giảm recoveredAmount sau movement | 400 chặn, dữ liệu nguyên |

## Bằng chứng

- BE integration `deposit-refund-installments.test.ts` 2/2 (RED→GREEN: trước sửa
  đợt 2 chết đúng 409 'Mã giao dịch thực tế…').
- BE unit `deposit-refund-partial/deposit-intake-laws/deposit-bill-suggestions`
  42/42 (gồm pin mới mã xoay -2/-3).
- Live HTTP (backend cục bộ HEAD, port 3009): 201 → refund 500k 200 → PATCH dates
  200 → PATCH giảm 400 → refund 1.5tr 200 (status flip ĐÃ) → refund đợt 3 409;
  DB in 2 movement đúng mã/số tiền; fixture QA-R43A dọn sạch.
- FE cluster DepositRefundTrackerPage(.test/.helpers/.alerts/.styles) +
  accountingCommandRetry: 70/70 — nút Đã hoàn cược prefill phần còn lại + dòng
  'Đã hoàn X · Còn lại Y ₫' giữ nguyên từ 070fdbb0 (UI không đổi trong đợt này;
  rung: CODE-READ + pins — owner drive lại trên staging sau khi build).
