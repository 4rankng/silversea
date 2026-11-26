# SIL-1086 (id 1262) — e-POD thay thế file đã lưu + lịch sử thay thế (K2.57) (regression case)

Case ID: TC-SIL1086-01
Feature: Trang e-POD lái xe (`/my-trips/:id/pod`, `DriverTripPodPage` → `TripPodSubmission`) — thay thế tệp đã lưu và xem lịch sử các lần thay thế.

## Đặc tả (nguồn: thẻ SIL-1086, quy tắc K2.57)
- Chuyến đã hoàn thành, e-POD đã lưu (SUBMITTED/ACCEPTED): dòng tệp đã lưu phải có **nút thay thế** và **liên kết xem lịch sử thay thế**.
- Trước fix (build d568cbae): 0 lần "Lịch sử", 0 lần "Thay thế" trên toàn trang; bấm dòng file đã lưu không mở thao tác nào (chỉ xem/tải).
- Thay file mới = ghi đè bản hiển thị NHƯNG giữ lịch sử: ai thay, khi nào, file cũ còn xem/tải được.

## Thiết kế đã chọn (đọc cấu trúc POD upload hiện tại trước khi chọn — ưu tiên ít migration)
- `trip_pod_files` giữ nguyên hình dạng: thay thế cập nhật in-place (slot unique `(submission_id, file_type)` giữ nguyên, mọi reader hiện tại không đổi).
- Bảng append-only mới `trip_pod_file_revisions` (migration `backend/drizzle/20261126160000_sil1086_trip_pod_file_revisions.sql`, house convention IF NOT EXISTS): bản cũ chuyển xuống đây kèm storage key cũ — **blob cũ GIỮ nguyên trong storage** (không enqueue delete) nên file cũ tải lại được.
- Chỉ e-POD đã nộp/lưu (SUBMITTED/ACCEPTED) mới đi đường thay thế; DRAFT giữ nguyên attach/remove cũ (re-upload draft vẫn xoá blob cũ, không ghi lịch sử — đúng law card 071026212500).
- Accounting lock + canceled + version conflict giữ nguyên như mọi mutation POD khác (`assertTripShipmentAccountingUnlocked`, 409 phiên bản).
- Idempotent: `IDEMPOTENCY_ENDPOINTS.TRIP_POD_FILE_REPLACE` + Idempotency-Key retry fingerprint phía FE.

## Endpoints mới
- `POST /api/driver/me/fulfillments/:fulfillmentId/pod/:submissionId/files/:fileId/replace` (multipart file + expectedVersion) → trả submission view.
- `GET /api/driver/me/fulfillments/:fulfillmentId/pod-file-revisions/:revisionId` → stream blob bản cũ.
- Lịch sử đính kèm wire: `GET /driver/me/fulfillments/:id` podSubmissions[].fileRevisions (driver path only).

## Automated pins
- `frontend/src/components/trip/TripPodSubmission.replace-history.test.tsx` (7 case):
  - file đã lưu (ACCEPTED) hiện "Thay thế <tên tệp>" + "Lịch sử thay thế"; ẩn remove (draft-only);
  - DRAFT không hiện Thay thế/lịch sử (giữ upload/remove);
  - không wire handler → không render control chết;
  - pick file qua Thay thế gọi `onReplaceFile(submission, fileId, file)` + reset input;
  - panel lịch sử: tên tệp cũ, "Tải lên <lúc> · <người tải>", "Thay thế <lúc> · bởi <người thay>", nút "Tải" gọi `downloadPodRevision(fulfillmentId, revisionId)`;
  - chưa có lần thay thế → "Chưa có lần thay thế nào." (link vẫn hiện theo K2.57);
  - ảnh bản cũ mở fullscreen qua PhotoViewer (prefetch khi mở panel).
- `backend/src/tests/material-write-registry-exhaustive.test.ts` — route thay thế khai báo durable boundary `TRIP_POD_FILE_REPLACE` (registry map).
- `frontend/src/components/trip/TripPodSubmission.styles.test.tsx` — card read-only giữ đúng shape mới (head + input luôn-mounted + file list).

## Quy tắc hiển thị (shipmate-uiux doctrine)
- Không truncate: tên tệp dùng `.trip-pod__file-name` (wrap/anywhere), internal code bị strip trước khi hiển thị (card 261022201006c).
- Mobile-first 390px: control 32px band cạnh remove, history toggle ≤40px, panel accordion trong card.
- Không hiển thị hành động mà BE sẽ từ chối: accounting-lock/canceled → page không wire `onReplaceFile` (control biến mất, không để nút chết).

## Not covered bởi hồ sơ này
- UI DRIVEN rung 3 trên app thật với tài khoản bqhuong, chuyến 110: cần `make dev` + migration chạy lên DB local/staging trước; lane này chỉ chạy vitest + tsc (theo phân công orchestrator).
- Lặp lại thay thế nhiều lần (revision 2, 3, ...): logic `(max revision)+1` + unique `(file_id, revision)` chặn race qua row lock `trip_pod_files.for('update')`, nhưng chưa có fixture nhiều vòng.
- Người thay khác tài khoản lái xe (ví dụ điều vận thay hộ): hiện chỉ driver-owned fulfillment mới gọi được replace; role khác chưa có đường vào.
