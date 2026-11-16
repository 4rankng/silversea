# SIL-817 (id 946) — round 16/11: GET /api/trips/:id exposes activeHandoff + điều tra 409 lock

- **Ticket**: SIL-817 · URGENT · QA FAIL 16/11 23:13 build dd198999 — AC1 ✓, AC3a ✓ (không đụng), AC3b chưa xác minh được.

## AC3b — activeHandoff trên GET /api/trips/:id

- Nguyên nhân: lookup luật (dispatch_handoffs UNSEEN/SEEN theo shipment, shape `{id, status, handlerId}`) đã nằm ở `trip-queries.service.ts` (listStuckRunningTrips) nhưng route GET /:id (`routes/trips/crud.ts`) không expose.
- Fix: `getTripActiveHandoff(shipmentId)` mới trong trip-queries.service (CÙNG file chủ luật, cùng shape `listStuckRunningTrips`); GET /:id attach `activeHandoff: {id, status, handlerId} | null` vào response.
- Pin: `sil817-trip-detail-handoff.test.ts` (source-scan: route gọi lookup + spread vào res.json; lookup giữ luật UNSEEN/SEEN + handlerId).
- Hiệu quả QA: `GET /api/trips/540` trả `activeHandoff {id, status, handlerId: 15}` NGAY (không cần chờ vào danh sách kẹt 1 ngày như round trước).

## 409 'Khóa giao dịch này thuộc về người thực hiện khác' (trip 539 / task 702)

- Key `driver:task:702:milestone:order_received:version:2` = **deterministic** theo fulfillment+milestone+version (FE `buildIdempotencyKey`, DriverTripDetailPage:185) và CHUNG cho mọi actor; guard actor-mismatch của `runIdempotent` (idempotency.service:352) fire TRƯỚC mọi ownership check → một tài khoản lái xe KHÔNG phải chủ fulfillment (hoặc lượt nhấn sau khi row đã được actor khác tạo) nhận 409 idempotency thay vì lỗi ownership — toast gây hiểu nhầm 'lock kẹt'.
- Fix: pre-check ownership (`loadOwnedFulfillmentTrip` trên db, ngoài tx idempotent) TRƯỚC `runIdempotent` trong `recordDriverFulfillmentProgress` — lái xe không sở hữu fulfillment nhận đúng lỗi 404 'Không tìm thấy tác vụ được giao.' và không chạm tầng key (không thể poison replay của chủ thật). Re-check forUpdate trong tx giữ nguyên là gate chính thức. Không đổi payload hash/replay semantics (ngoài scope).
- Đây là lỗi thiết kế lớp lỗi (wrong error class), không phải 'lock kẹt toàn cục': trip 540 nhận OK lần đầu khớp — actor của key 702 khác actor đang thử.

## Ghi chú thẻ 'Đã nhận' (không sửa — không trivial)

Thẻ trên tab 'Đã nhận' là data-card + 'Xem chi tiết'; thêm nút Hoàn tất đòi nhân bản logic gate hoàn tất (chứng từ POD ≥2, sticky-bar điều kiện IN_TRANSIT/pair-lock của trang chi tiết) lên card — không phải trivial. 'Đang chạy' chip tương tự (status đang không render trên card). Để lại cho một ticket UI riêng nếu owner muốn.

## Gates

- BE `npx tsc --noEmit` sạch · scoped units **39/39 + 5/5** (sil817-completion-inference, sil638 pair-gating, trip-detail-pod-recovery, trip-factory-site-contact, sil752, sil676, expense-trip-cost, sil823 + pin mới).
