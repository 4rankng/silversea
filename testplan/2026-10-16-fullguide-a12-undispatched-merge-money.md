# Case 161026204709 / TC-A12 — ghép cước thu khách trên lô CHƯA phân bổ xe: tiền không hiện trên bảng quyết toán

Nguồn: hướng dẫn kiểm thử khách hàng 16/10/2026 (PHẦN A.4 + TC-A12, phiếu
161026204709). Môi trường: staging `227a08b2` → `e3286338`.

## Tái hiện (rung 2, staging 227a08b2 — lô thật của khách)

Lô 619/620 (BILL-RET1026-01/02, cùng khách, chưa phân bổ, đã ghép nhóm REV):
bảng Chi phí – Quyết toán trả về `freightAuto: null` cho CẢ HAI lô; bảng Kế
toán chốt công nợ không có dòng. DB: 0 trips, 0 freight_rate_snapshots,
0 trip_financial_state — phép ghép không ghi đồng tiền nào.

## Nguyên nhân (hai lớp)

1. `mergeRevenueGroup` chỉ ghi tiền khi lô có trip live (`if (!trip) continue`)
   — lô chưa phân bổ không có trip ⇒ không ghi gì cả (kể cả con 0₫ của lô ghép).
2. Ngay cả khi có trip, FB-093 ghi vào `trip_financial_state.revenue` — kênh
   mà HAI bảng tiền đều không đọc (CUS đọc `freight_rate_snapshots.totalAmount`,
   Kế toán đọc `freightRateSnapshots.freightAmount`). Lớp này đã được lane
   F-2 sửa bằng luật ĐỌC option (b) (commit `b859d0b8`/`e3286338`) cho lô CÓ
   trip; lane đó ghi rõ phần dư "merged-but-undispatched keep null" — đúng
   là trạng thái khách báo lỗi.

## Sửa (extension của luật F-2, cùng kiến trúc kênh)

- GHI (lcl-grouping.service): khi lô ghép KHÔNG có trip live, phép ghép tự
  materialize tiền thành freight snapshot mức lô (tripId NULL — grain
  "intake" mà cả hai bảng đã đọc): Lô 1 = giá lane đã resolve (miss lane ⇒
  giữ MANUAL/trống như nhánh có trip), lô ghép = 0₫ có trích dẫn
  "Ghép cước cùng Bill X" (zero là giá trị — luật D02). INSERT-only, đúng
  hợp đồng supersede 2026-09-09.
- TÁCH (unmerge REV): chuyển tiền FB-095 đọc/ghi CẢ HAI kênh — leaver không
  có trip đọc snapshot mức lô; promotee không có trip nhận snapshot chuyển
  tiền; lô thành viên rời nhóm được re-cite "chờ định giá lại".
- ĐỌC (shipment-debit-summary + accounting-debit-close): lô đủ điều kiện
  (LCL + revGroupId/stamp) mà kênh override không có số (không trip) ⇒
  fallback về kênh snapshot thay vì ép null; note thành viên suy ra từ
  `revGroupPrincipalRef`.

## Phạm vi còn lại (documented, không chặn)

- Ghép TRƯỚC khi phát lệnh: khi lô sau đó được điều xe, dispatch freeze
  supersede snapshot mức lô theo đúng grain — bảng về giá dispatch. Luật
  "merge-before-dispatch giữ 100%/0₫ qua lần dispatch sau" không có trong
  tài liệu khách; cần owner ruling nếu muốn.
- Leaver tách nhóm mà không có trip: dòng 0₫ hiển thị đúng giá trị nhưng
  KHÔNG kèm note (lô đã rời nhóm, không còn kênh stamp; trích dẫn nằm trong
  formula_text của snapshot).

## Gates

BE tsc 0 · lcl-grouping 28/28 (5 case A12-01…05 mới) · shipment-debit-summary
+ accounting-debit-close + reconciliation-refund-settle + advance-approval
64/64 tổng · FE không đổi contract màn hình (note đi qua `freightOverrideReason`
đã có). Root lint: các lỗi tồn tại trước ở file scratch/W1 (không thuộc phạm vi).

## Kế hoạch xác thực (đã thực hiện xem qa/)

- Rung 2 tái hiện: `qa/2026-10-16_fullguide_a-lcl-chain.log` (a4-db: 0 rows
  mọi kênh tiền) + probe lô 619/620 trên `e3286338` (freightAuto null).
- Rung 3 re-drive kịch bản A.4 bằng UI sau khi deploy: driver
  `testplan/qa/scripts/fullguide-a-lcl-chain.mjs` (VERDICT A.4).
