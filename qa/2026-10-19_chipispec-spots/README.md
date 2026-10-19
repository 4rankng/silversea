# QA evidence — cards 181026183500 + 181026183600 (2026-10-19, local dev @ fix-chipispec-spots)

Driver: `node scripts/qa-chipispec-spots-183500-183600.mjs before|after` (puppeteer
via scripts/lib/ui-driver.mjs — evaluateOnNewDocument token injection), ketoan
(Accountant, user id 3) unless noted. Backend :3002, frontend :7175.

## Claim / bug coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| 183500 BEFORE — carrierSupplierId null trên shape CUSTOMER | DB/API VERIFIED | psql: 40/40 EXTERNAL rows là 'CUSTOMER', 0 'SUBPLIER' → carrierSupplierId luôn null; `GET /phoi-phieu/rows` trip 60439 → null (pre-fix); stash-rerun API `?search=TCXBOOK-18500` → `(TCX Transport Co 18500, None)` | — |
| 183500 BEFORE — NCC trống khi tên khác tên NCC | UI DRIVEN | `before-diffname/183500-ncc-after-pick.png` (Bên thực chi=Nhà cung cấp, ô NCC placeholder "Chọn nhà cung cấp" + hint "Chưa có nhà xe trên tuyến này — chọn thủ công."); DOM dump `value:""` @ aria "Chọn nhà cung cấp" | mobile viewport |
| 183500 AFTER — NCC tự điền theo id (tên khác nhau) | UI DRIVEN | `after-diffname/183500-ncc-after-pick.png` (ô NCC = "Nhà xe TCX Logistics 18500"); API sau fix → `(…, 15310)`; backend test `phoi-phieu-carrier-supplier.test.ts` 3/3 | staging data, role MANAGER/ADMIN |
| 183500 UI-B77AP2 (trùng tên) — fallback tên vẫn hoạt động | UI DRIVEN | `after/183500-ncc-after-pick.png` (NCC = "UI Nhà xe B77AP2") | — |
| 183600 BEFORE — không có pill "Chờ duyệt", nút chữ thường | UI DRIVEN | `before/183600-advances-before-approve.png` + findings: pills=[Tất cả,Đã ghi nhận,Chưa ghi sổ,Đã hủy], hasPendingPill=false, buttonTexts=["Phê duyệt tạm ứng"], hasSpecLabel=false | mobile viewport |
| 183600 AFTER — pill "Chờ duyệt" + nút "PHÊ DUYỆT TẠM ỨNG" | UI DRIVEN | `after/183600-advances-before-approve.png` (pill "Chờ duyệt 7" trong dải lọc); `after/183600-advances-pending-filter.png` (pill active → 6 dòng PENDING, mỗi dòng nút PHÊ DUYỆT TẠM ỨNG) | mobile viewport |
| 183600 AFTER — bấm nút duyệt → ghi sổ + giải ngân | UI DRIVEN + DB | DOM sau click: dòng QA 183600 → "Đã ghi nhận" (`after/183600-advances-after-approve.png`); DB: advance_requests 6505 status=RECORDED approved_by=3; treasury_movements 11502 OUT 2.500.000₫ ref TU-6505-* | — |

## Ops-side setup (fixture creation)
PENDING request #6505 được tạo bằng LUỒNG THẬT qua UI: giaonhan (OPS) đăng nhập
→ /ops/wallet → "Xin Tạm Ứng" → modal → Lưu (đã drive bằng tay qua Paseo
browser; screenshot màn ví không bắt được do webview background — dùng DOM
assert: hàng mới "2.500.000 ₫ / Đang ghi nhận / Hủy tạm ứng").

## Notes
- `before/183500-ncc-after-pick.png` (lần chạy đầu) HIỂN THỊ "Công ty trả trực
  tiếp" — lần đó click chọn "Nhà cung cấp" chưa ăn (heuristic cũ); bằng chứng
  BEFORE đúng nằm ở `before-diffname/` (probe Native-select).
- Fixture UI-B77AP2 trùng tên khách/NCC nên fallback-theo-tên che bug; tái hiện
  đúng bug QA cần tên khác nhau → fixture TCXBOOK-18500 (trip 145053).
- Headless Chrome crash trên /accounting/phoi-phieu do payload
  truck-assignments (~275KB → hàng nghìn dòng render) với DB dev đang chứa
  flood fixture QA (609 tạm ứng) — driver stub các endpoint report/truck-
  assignments; KHÔNG phải regression của change (xảy cả ở build 64f81514).
