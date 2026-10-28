# SIL-550 — DV drawer "Chi tiết container": thêm cont vào lô + sửa Số cont + sửa Giờ hẹn

- Ticket: SIL-550 (board SIL, internal id 623, In Progress) — drawer
  "Chi tiết container" của Kế hoạch Tổng quát (`/dispatch`,
  `DispatchContainerDetailDrawer`, mở từ "Chi tiết container" trên dòng lô):
  3 gap so với các ô Nâng/Hạ ĐÃ sửa được trong cùng drawer.
- Repro ticket: role dungnv (Điều vận / DISPATCHER), lô 1×40DC chưa số cont.
- Không đụng cột SỐ TỜ KHAI của drawer (role law riêng, ticket SIL-551/id 624).

## Case pin (expected sau thay đổi)

1. **Gap 1 — Thêm container**: drawer có control "Thêm container" (footer dưới
   bảng) cho role ADMIN/MANAGER/CUS/DISPATCHER trên lô FCL chưa khóa kế toán
   (gate khớp endpoint `POST /shipments/cus-workspace/:id/containers`).
   Bấm → form compact nhập **Số container** (bắt buộc, ≤50 ký tự) → submit gọi
   `addCusShipmentContainerRow` (expectedShipmentVersion + containerNumber +
   Idempotency-Key) → drawer refetch, dòng mới xuất hiện trong bảng (BE inherit
   loại/tuyến/cảng/site/giờ hẹn/tờ khai từ sibling), toast "Đã thêm container
   vào lô.", board `/dispatch` refetch qua `onSaved`. Lỗi (400 số không hợp
   lệ / trùng số trong lô, 409 version, 403) surface nguyên văn qua toast +
   refetch resync. Lô LCL hoặc đã khóa kế toán: KHÔNG có control.
2. **Gap 2 — Số cont click-to-edit**: ô CONTAINER của dòng có
   `fieldAccess.containerNumber.mode === 'DIRECT'` (law CUS/Điều vận, pre-lock,
   kể cả khi cont đã có chuyến — identity correction) là text-button click-to-
   edit (owner ruling 20261006_537: click ô là affordance, không nút Sửa).
   Click → input inline (label "Số container", maxLength 50) → Enter lưu
   `containerNumber` qua container-line command → refetch → ô hiện số mới;
   Escape/blur hồi; Enter không đổi giá trị không ghi; giá trị rỗng = xóa số
   ("Chưa có số container"). READ_ONLY (khóa / role khác): text tĩnh
   "Chưa có số container"/số hiện có, không affordance.
3. **Gap 3 — Giờ hẹn click-to-edit**: ô GIỜ HẸN ĐÓNG/TRẢ của dòng có
   `fieldAccess.customerAppointmentAt.mode === 'DIRECT'` (pre-lock, pre-trip)
   là text-button click-to-edit → editor ngày + giờ (both-or-neither) → Enter
   lưu `customerAppointmentAt` (`localDateTimeToIso` → `…+07:00`) → refetch;
   cả hai ô trống = xóa hẹn; nhập thiếu nửa kia báo lỗi, không ghi. Dòng đã
   có chuyến (fieldAccess READ_ONLY "hãy dùng luồng điều chỉnh điều vận"):
   text tĩnh.
4. Nâng/Hạ giữ nguyên hành vi dropdown như cũ (DIRECT/READ_ONLY y hệt).
5. SIL-515: mọi cell/value/editor mới wrap-full — không ellipsis, không
   overflow:hidden/clip, không line-clamp trong scope bảng drawer; header
   drawer không claim "Chỉ xem tại đây" khi vẫn còn editor mở.
6. Không đổi quyền/khóa nào khác: Số tờ khai giữ nguyên law 261013200312 ở
   commit này (SIL-551 mở role Điều vận ở commit riêng).

## Regression evidence (qa/2026-10-28_sil550-drawer/)

- `qa/2026-10-28_sil550-drawer_vitest.log` — scoped vitest 28 file / 289 test
  PASS (drawer + styles pins + master-plan suites + DispatchDeclarationCell),
  EXIT 0; `qa/2026-10-28_sil550-drawer_tsc.log` — `npx tsc -b` EXIT 0.
- UI drive `qa/scripts/2026-10-28-sil550-drawer-add-edit-ui-drive.mjs` EXIT=0
  (16/16 checks, `run1/assertions.json`), role dungnv (DISPATCHER — ticket
  repro), lô SHP-2610-00157 / R42RV-FCL (id 240), cont MSKU1234565 (id 275):
  - Gap 2: click "Sửa số container" → editor mở → gõ MSKU6234568 (ISO 6346
    hợp lệ, check-digit tính theo shared/src/calculations/iso6346.ts) → Enter
    → toast "Đã lưu số container." → ô hiện số mới → restore MSKU1234565.
  - Gap 3: click "Sửa giờ hẹn đóng/trả" → editor ngày+giờ → 30/10 09:30 →
    Enter → toast → ô hiện "09:30 30/10/2026" → restore "08:00 27/10/2026".
  - Gap 1: click "Thêm container" → form Số container → MSKU7234562 → dòng
    mới vào bảng (3 rows) + toast → cleanup xóa dòng qua container-remove
    (SIL-177: phải gỡ tờ khai inherit trước).
  - Screenshots 1280×900 + 390×844: `run1/{drawer-open,scont-editor-open,
    scont-saved,giohen-editor-open,giohen-saved,them-form-open,them-saved}-*.png`.
- DB proof `db-before.txt` / `db-after.txt` (psql ss-prod-db): 275/276 về đúng
  giá trị pre-drive (số cont + giờ hẹn + tờ khai), dòng thêm đã xóa — DB sạch
  như trước drive (chỉ updated_at + shipments.version tiến).
- ENV limitation (ghi trong ui-driver.log + header script): CDP keyboard
  injection chết trên trang authed của Chrome 156.0.8078.48 (login gõ được,
  trang app không nhận key event nào kể cả capture listener) — typing đi qua
  DOM event synthesis (input/keydown y hệt phím thật, React handlers thật);
  click là DOM click thật trên control thật.
