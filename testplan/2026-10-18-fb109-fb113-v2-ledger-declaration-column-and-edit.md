# FB-109 + FB-113 v2 — bảng ledger: cột Số tờ khai + nút Sửa inline (regression case)

> **SUPERSEDED 25/10 (SIL-477, owner ruling):** phần FB-109 v2 "nút Sửa
> always-visible ở cột Số tờ khai" đã BỊ XOÁ — owner xác nhận cell
> click-to-edit là đủ, nút trùng lặp với chính cái cell. Trigger duy nhất là
> click ô Số tờ khai (id canonical `shipment-detail-edit-documents-<row>`),
> focus restore sau save giữ nguyên. Phần FB-113 (4 cột chứng từ theo thứ tự
> QA) vẫn còn hiệu lực. Case bên dưới giữ nguyên làm bản ghi lịch sử v2.

Case ID: TC-171026122100-V2 / TC-171026122140-V2
Feature: bảng ledger Chi tiết lô hàng (`ShipmentContainerLedger.tsx`) — cột chứng từ và nút sửa từng dòng tờ khai.

## Vì sao có v2 (bài học lần trước)
Lần trước (merge 2bf3cf9f) agent sửa THỨ TỰ TRƯỜNG TRONG POPUP — nhưng QA test
BẢNG LEDGER. Feedback QA 18/10 trên build 2bf3cf9f:
- FB-109: "không có nút sửa inline, chỉ thêm/xóa" — bảng thiếu NÚT SỬA trên
  từng dòng tờ khai.
- FB-113: "header thiếu trường Số tờ khai, thứ tự không đúng" — BẢNG thiếu
  CỘT "Số tờ khai".

Surface đúng: `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`.

## Repro (trước khi sửa)
1. CUS mở Chi tiết lô hàng có nhiều container (fb `EGLV149607019409`…).
2. Bảng có MỘT cột "Chứng từ & hãng tàu" gộp: Bill + tờ khai + nhập/xuất +
   hãng tàu xếp chồng trong một ô; header không có "Số tờ khai".
3. Muốn sửa tờ khai của một container: không có nút nào nhìn thấy — chỉ có
   click-vào-ô (không discoverable), QA kết luận "chỉ thêm/xóa".

## Expected (sau khi sửa)
- FB-113: bảng có 4 cột có header, đúng thứ tự QA: **Bill/Booking →
  Số tờ khai → Nhập/Xuất → Hãng tàu** (giữa Khách hàng và Thông số container).
  "Bill/Booking" là đúng chữ của QA trong spec; header route đổi thành
  "Nâng / hạ" (cell vốn đã gắn nhãn NÂNG/HẠ) để 12 cột chia lại width mà
  không header nào bị cắt giữa chữ (R17/FB-063 — đo bằng header-fit probe).
- FB-109: mỗi dòng container CÓ QUYỀN sửa chứng từ hiển thị nút **Sửa** trong
  cột Số tờ khai (kể cả dòng ĐÃ CÓ tờ khai — bắt buộc theo QA). Click Sửa mở
  đúng popup documents editor đã có; sửa số → Lưu → bảng cập nhật số mới.
- Không có quyền (đủ 5 trường READ_ONLY) hoặc dòng lô hàng lẻ (lot-level):
  không có nút Sửa, ô vẫn hiển thị giá trị/placeholder.
- Chỉ MỘT editor documents được mount khi mở (4 ô cùng mở một editor —
  anchor là ô Số tờ khai).

## Automated pins
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.test.tsx`
  — describe "documents column split + Sửa button (FB-109/113 v2)": danh sách
  11 header đúng thứ tự; Sửa hiện trên dòng có tờ khai và gọi
  `onStartEdit(row, 'documents', shipment-detail-edit-documents-<id>)`; giá
  trị 4 cột + placeholder; đúng MỘT editor mount trên ô Số tờ khai; Sửa ẩn
  khi READ_ONLY và trên lot row.
- `frontend/src/pages/ShipmentContainersPage.test.tsx` — header list 11 cột;
  4 trigger documents mỗi dòng; ô Số tờ khai có nút `Sửa tờ khai container
  CONT-001`; nhóm READ_ONLY mất cả trigger lẫn Sửa.
- `frontend/src/pages/ShipmentContainersPage.styles.test.ts` — 12 cột chia
  đúng 100%; pin nhãn `data-cell-label={cellLabel ?? modeLabelForTrigger}`
  và selector status theo class (thay cho nth-child(8)).
- Popup giữ nguyên thứ tự trường FB-113 cũ (card 171026122140) — test cũ
  vẫn pass, không đụng `InlineEditor` grid.

## Bằng chứng browser (UI DRIVEN, 2026-10-18)
- Driver: `testplan/qa/scripts/2026-10-18-fb109-fb113-v2-ledger-declaration-ui.mjs`
  (cus, local :7176→API :3002, lot 110222 / bill FB110-BL-001) — exit 0,
  13/13 assertion; log `qa/2026-10-18_fb109-fb113-v2/ui-driver.log`.
- Screenshots: `ui-1-ledger-columns-fb113.png` (4 cột đúng thứ tự + Sửa trên
  cả 2 dòng), `ui-2-sua-button-filled-row-fb109.png`, `ui-3-editor-open.png`
  (editor mở seed FB110-DECL-A, 1 bản sao, neo ô Số tờ khai),
  `ui-4-after-save.png` (bảng hiện TK-QA-V2-001 sau Lưu),
  `ui-5-band-390/768.png` (card mode: label từng cột + Sửa, không overflow).
- DB side effect: GET containers sau Lưu → `declarationNumber=TK-QA-V2-001`;
  restore qua chính UI path → `FB110-DECL-A`, sibling trống về `null`.
- Header-fit probe (`...header-fit-probe.mjs`): 1440/1280 clip-set đúng bằng
  build cũ (chỉ 2 header dài previously-clipping); 3 header mới vừa 1 dòng.

## Not covered
- Băng 1101–1365px: header "Bill/Booking" có thể hụt dưới ~85px cột (build
  cũ cũng cắt header tại băng này — đã đo, xem probe); chưa chạy
  role-ui-sweep toàn route trong scope này.
- Sort: chỉ cột Bill/Booking giữ header sort (`billOrBookNumber`, key cũ);
  3 cột mới là header tĩnh — QA không yêu cầu sort theo tờ khai.
