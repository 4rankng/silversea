# SIL-588 (id 688) — Lọc lô hàng theo ngày trả về cả lô chưa nhập ngày

- Nguồn: khách hàng (b_d. Phạm Trung Kiên) 29/10/2026.
- Link: plan.tingting.vip SIL-588.

## Tái hiện

1. Mở CUS "Tổng quan lô hàng".
2. Lọc khoảng ngày (transportDateFrom/To) một ngày xác định.
3. Kết quả gồm cả lô chưa nhập ngày đóng trả.

## Nguyên nhân

`shipmentTransportDateCondition` (backend/src/services/cus-workspace-sql.service.ts)
vẫn giữ lane "undated = luôn hiện" (card 231026000252): cả hai arm đều chấp nhận
NULL cạnh phép so khoảng. Phía Chi tiết (container) đã bị thu hẹp bởi SIL-506
(owner ruling 26/10); Tổng quan chưa theo.

## Kỳ vọng sau fix

- Khoảng ngày đang hoạt động chỉ trả lô CÓ ngày (union ngày container
  coalesce(appointment VN, EDD); lô không container thì EDD) nằm trong khoảng.
- Lô chưa có ngày nào (container không appointment + lô không EDD; hoặc lô lẻ
  không EDD) bị LOẠI khi có filter, hiện lại khi bỏ filter.
- Không filter → toàn bộ như cũ (kể cả lô chưa có ngày).
- `total` + `statusCounts` đọc cùng điều kiện (đã dùng chung conditions) —
  số tab không lệch danh sách.
- Dispatch master-plan (deliveryDateFrom/To cùng dùng hàm này) theo cùng luật.

## Case ID

- SIL-588-C1: render SQL — EXISTS arm là `between` thuần (không còn
  `is null or`); container-less arm là `expected_delivery_date between` nằm
  sau NOT EXISTS gate; params [from,to,from,to].
- SIL-588-C2: không còn arm NULL nào trong render (grep 'is null' trong
  chunk = 0 ngoài NOT EXISTS của chính gate).

## Bổ sung (cùng phiên) — scoped counts theo cùng luật

- SIL-588-C3: `filterContainersByDateRange`
  (backend/src/services/container-date-filter.ts) — cont/lô KHÔNG ngày nào
  (không appointment + fallback resolver trả null) bị LOẠI khi filter bật;
  fallback NGÀY ĐÚNG trong khoảng → giữ; bỏ filter → passthrough nguyên mảng
  (kể cả undated). Scoped counts (Tổng quan CUS `buildListItem`, dispatch
  master-plan aggregates) không còn đếm cont của lô mà luật row
  (`shipmentTransportDateCondition`) vừa loại — comment cũ "undated = luôn
  hiện" (card 231026000252) đã supersede ở mọi bề mặt mà filter ngày chạm tới.
