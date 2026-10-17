# fix-171026205400 — FB-020 Bãi hạ trống + map nhầm Địa chỉ giao hàng (REGRESSION, rb1) — DONE (pending trunk commit)

Controller: this session (Paseo agent), worktree
`fix-171026205400-bai-ha-regression-rb1` (branch-off main @ 9fd0553c).
Updated: 2026-10-17 (tối). Không merge — report hash.

## Root cause (đã chứng minh bằng data staging + git)

Trip E2EROLE001/staging trip 135 (IMPORT FCL, container 256): KHÔNG có bất kỳ
nguồn cảng hạ nào — dropoff_port_id/raw name null, shipments.delivery_location
null, trips.canonical_destination null. Chuỗi `resolveDeliveryStage`
(ruling 2026-09-18 port-first) chỉ đọc port → free-text rồi trả null →
"Cảng hạ: Chưa có cảng hạ" cạnh "Địa chỉ giao hàng: <nhà máy>". Điểm hạ thật
của tác vụ nằm trong siteSnapshot.deliverySite ("LM Võ Cường" — ghi tại
decompose từ operational site của container) mà chuỗi không bao giờ đọc.

Căn cứ sửa: PRD ManHinhLaiXe §2.3 (restated 1a1a227e) "khi hai điểm là cùng
một nơi thì hai hàng cùng tên" + directive 2026-10-17 (liftDropPoints.ts,
IMPORT: Hạ = Nhà máy) + ticket FB-020. KHÔNG mâu thuẫn ruling 2026-09-18:
snapshot chỉ ĐÓNG chuỗi khi không có port/free-text, không thay thế; EXPORT
không đổi (1f1133ae).

## Thay đổi (4 file code + 1 case + 1 rung script)

- `backend/src/services/delivery-stage.ts` — IMPORT/unknown: chuỗi stage-1
  thêm bước 3 `|| snapshotSiteName` (tên điểm trả của fulfillment snapshot).
  Callers không đổi (đã truyền snapshot name). EXPORT branch nguyên vẹn.
- `backend/src/tests/unit/delivery-stage.test.ts` — repin 2 assertion cũ
  (portless+snapshot → giờ là tên site), thêm test FB-020 (trim/blank).
- `backend/src/tests/driver-journey-board-fields.test.ts` — 2 test mới:
  FB-020 portless IMPORT (card+detail = 'LM Võ Cường'), EXPORT portless
  giữ null; comment describe sửa đúng thứ tự chuỗi.
- `frontend/src/pages/driver/DriverTaskInfoSections.test.tsx` — test render
  FB-020: 2 hàng ĐÚNG RIÊNG, không cross-fallback. FE code KHÔNG đổi
  (dropPortName giờ mang giá trị từ wire).
- `testplan/2026-10-17-fb020-cang-ha-portless-import.md` — case TC-FB020-001/2/3.
- `testplan/qa/scripts/2026-10-17-fb020-cang-ha-rung.mjs` — UI rung script.

## QA (qa/2026-10-17_fb020_*)

- UI DRIVEN (rung 3, phone 390px, dvthuc, frontend :7276 → backend :3093 từ
  worktree này, CWD process đã verify): trip 67894 (fixture tạo qua API thật:
  shipment 123269 /
  container 54995 / fulfillment 53877 portless) — "Cảng hạ: LM Võ Cường" +
  "Địa chỉ giao hàng: Nhà máy Long Minh - Võ Cường, Khu 2, …"; control trip
  44277 (có port 8578): "Bãi JJ LOGISTICS FB082" ≠ "CÔNG TY NEWEB… FB082" —
  ĐÚNG RIÊNG. Ảnh: ui-1-cang-ha.png, ui-2-full.png, ui-3-control-port.png;
  log ui-driver.log; DB fixture db-fixture.txt. Wire proof: trước fix
  deliveryLocation null (backend nhầm worktree khác), sau fix
  'LM Võ Cường' cả detail + journey card.
- Gates: lint 0 lỗi (5 warning pre-existing từ scratch-census-probe.ts của
  ai đó, gitignored, không phải file này); be-tsc 0; fe-tsc 0; make build 0;
  BE node:test scoped: unit 5/5, journey-board 17/17, siblings 162/162; FE
  vitest scoped 146/146; FE vitest FULL 5059/5060 — fail duy nhất
  `dev-port-contract` là offender PRE-EXISTING `qa-20261017-qa1-007-chip-rung.mjs`
  (commit f9b36180, card khác, fail trên HEAD trước ticket này; đã fail y hệt
  ở task 171026182554). Full BE suite: xem qa/2026-10-17_fb020_gates.txt.

## Fixture dọn?

Trip 67894/shipment 123269 là dữ liệu QA trên LOCAL DB 5441 (không đụng
staging/prod). Giữ lại làm evidence; cần dọn thì hủy trip+shipment.

## Stack cục bộ + collision port

Rung chạy trên backend :3093 + frontend :7276 (của worktree này, background
shell, CWD đã verify). LƯU Ý: worktree đồng thời
`fix-171026215600-salary-mode-dialog` cũng chiếm :3092 làm alt-port — đừng
dùng 3092 nữa. Process :3002/:7175 của checkout chính không đụng. Rung script
đọc QA_FRONTEND/QA_API env (default 7175/3002 theo dev-port contract).
