# SIL-600 (id 701) — Form tạo lô hàng thiếu cột Số tờ khai theo container

- Nguồn: QA Glint (ticket 701 / SIL-600) 30/10/2026; owner ruling cùng ngày
  (Frank, comment ticket): "tạo lô PHẢI cho nhập số tờ khai theo container" —
  đảo ngược pin SIL-521/522 ("form tạo cố tình không có tờ khai") CHỈ ở form
  tạo, chỉ ở tầng container. Việc bỏ ô nhập cấp lô (SIL-521) giữ nguyên.
- Phạm vi: thêm cột SỐ TỜ KHAI theo từng container vào bảng "Thông tin hàng"
  của form tạo (`/shipments/new`); nhập được ngay lúc tạo; mỗi cont nhập/sửa
  riêng; trùng số trong cùng lô KHÔNG bị chặn.

## Tái hiện (trước fix)

1. Đăng nhập CUS (tiepvv), mở `/shipments/new`.
2. Bảng "Thông tin hàng" chỉ có 8 cột: STT, SỐ CONTAINER, NHÀ MÁY, TUYẾN
   ĐƯỜNG, CẢNG NÂNG, CẢNG HẠ, NGÀY GIỜ ĐÓNG TRẢ, THAO TÁC — không có ô nào
   nhập số tờ khai (cả cấp lô lẫn cấp cont).
3. Muốn nhập tờ khai phải tạo lô xong, vào Chi tiết lô hàng nhập từng cont.

## Fix

- Shared: `shipmentContainerItemSchema` nhận `containers[].declarationNumber`
  (trim, ≤50 ký tự, rỗng → null). Key cấp lô vẫn KHÔNG vào
  `QUICK_CREATE_SHIPMENT_KEYS`.
- Backend: `reconcileShipmentContainersInTx` ghi `declaration_number` theo hợp
  đồng undefined-preservation (payload không quản lý trường → giữ giá trị đã
  lưu; create/edit form luôn gửi giá trị hiện tại).
- Frontend: draft row + payload + edit-prefill mang `declarationNumber`; cột
  mới đặt ngay sau nhóm SỐ CONTAINER (đúng thứ tự sheet Thông tin hàng phía
  CUS, CusLotView); ô nhập text thường, tối đa 50 ký tự, không bắt buộc;
  "Thêm container" kế thừa số của dòng trước (dùng chung cả lô là trường hợp
  chính, vẫn sửa riêng từng dòng); trùng số giữa các dòng không bị chặn.
- CSS: cột 150px, min-width bảng 844 → 994px; mobile (≤620px) ô tờ khai chiếm
  full row như nhóm SỐ CONTAINER.

## Kỳ vọng sau fix

1. Thead cột đúng thứ tự: STT → SỐ CONTAINER → SỐ TỜ KHAI → NHÀ MÁY → TUYẾN
   ĐƯỜNG → CẢNG NÂNG → CẢNG HẠ → NGÀY GIỜ ĐÓNG TRẢ → THAO TÁC.
2. Nhập tờ khai lúc tạo → `POST /api/shipments/quick` mang
   `containers[].declarationNumber` → dòng `shipment_containers` lưu đúng cột
   `declaration_number`.
3. 2 cont cùng 1 số lưu được, không lỗi trùng.
4. "Sửa lô" hiển thị lại số đã lưu; lưu không làm mất số.
5. Không có ô tờ khai cấp lô (chip strip vẫn chết).
