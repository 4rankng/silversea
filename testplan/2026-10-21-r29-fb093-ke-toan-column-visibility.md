# Regression case — FB-093 re-verify: nút "Tách nhóm" phía Kế toán BỊ CỘT ẨN CHE (card 211026024348)

- Case ID: `FB093-R29-KE-TOAN-COLUMN-VISIBLE`
- Ngày: 2026-10-21 (lane re-verify 5 mục FAIL R29 trên build c643ef1e)
- Surface: `/accounting/chot-debit` (Kế toán chốt debit), cột "Thông số container"

## Defect (re-drive trên staging c643ef1e — VẪN CÒN)

Sau Ghép cước thu khách, kế toán trên `/accounting/chot-debit` VẪN không thấy
nút "Tách nhóm" — mặc dù button đã được render trong cột "Thông số container"
(card 211026024348 đã land `UnmergeRevGroupAction` ở đó).

Root cause: card 191026181942 (KT4) đặt `defaultVisible: 'essential'` cho board
này — trên máy trạm MỚI (chưa có `accounting-debit-hidden-cols` trong
localStorage) mọi cột không `essential`/`pinned` bị ẨN, gồm cả cột
"Thông số container" (không có flag nào). Nút Tách nhóm nằm trong cột bị ẩn →
QA nhìn board thấy "không có nút" — đúng triệu chứng card gốc, tái hiện 100%
trên profile mới. Test scoped cũ của fix ép `localStorage.setItem(..., '[]')`
nên không phát hiện được tương tác giữa 2 luật.

## Expected

- Máy trạm mới (chưa chọn cột): cột "Thông số container" tự HIỆN khi board có
  dữ liệu LCL/nhóm ghép (nó mang action bắt buộc + note "Ghép cùng Bill X") —
  nút "Tách nhóm" thấy được trên từng dòng nhóm; các cột tiền breakdown vẫn ẩn
  theo essential default (KT4 giữ nguyên: ma trận tiền ≤ 6 cột).
- Board thuần FCL (không có dữ liệu lcl): cột vẫn ẩn như cũ.
- Lựa chọn tường minh của operator (picker) luôn thắng mặc định.

## Fix

- `frontend/src/lib/column-visibility.ts`: flag `essentialWhenHasData` mới —
  trong nhánh `hiddenByDefault('essential')`, cột có flag + `hasData(cột)=true`
  không bị ẩn. Opt-in per-column, các surface khác không đổi.
- `frontend/src/pages/accounting/AccountingDebitClosePage.columns.tsx`: cột
  `container` khai báo `essentialWhenHasData: true` + `raw: (row) => row.lcl?.label ?? null`
  (hasData phản chiếu đúng dữ liệu lcl thật).

## Pins

- `frontend/src/lib/column-visibility.test.ts` — "essentialWhenHasData (FB-093
  re-verify)": có data → hiện; không data → ẩn; choice tường minh thắng.
- `frontend/src/pages/accounting/AccountingDebitClosePage.tach-nhom.test.tsx` —
  case "máy trạm MỚI": KHÔNG set localStorage → nút "Tách nhóm" vẫn thấy, cột
  "Cước thu (tự động)" vẫn ẩn.

## Evidence

- `qa/2026-10-21-r29-verify/fb093/` — staging BEFORE (nút không hiện, build
  c643ef1e), local AFTER-FIX rung 3 (FE fix :7191 → staging API): 08/09/10 PNG +
  DOM dumps + unmerge 200 + audit trail 3 chu kỳ ghép/tách
  (`db-5-final-state.txt`).

## Not covered

- Operator ĐÃ có stored choice ẩn cột (choice tường minh vẫn thắng — đúng thiết
  kế, không đụng).
- Đọc kênh debit-summary hiện `freightAuto=0` không kèm reason cho lô member
  không-trip sau tách (snapshot 378 ĐÃ giữ reason D02 "Tách khỏi nhóm ghép —
  chờ định giá lại"; kênh hiển thị chưa surface) — tách card riêng cho kênh
  đọc freight, không thuộc defect "thiếu nút" của card này.
