# SIL-551 — /dispatch-detail ô SỐ TỜ KHAI: click-to-edit mở cho Điều vận

- Ticket: SIL-551 (board SIL, internal id 624, In Progress) — repro role
  dungnv (Điều vận): click ô SỐ TỜ KHAI "Chưa có tờ khai" trên
  Kế hoạch Chi tiết Xe (`/dispatch-detail`) không mở editor → không sửa được
  số tờ khai. QA coi là regression của SIL-530 (retest 28/10 sáng fail đúng
  điểm này) và ticket được owner nhận vào lane với Expected: click ô → editor
  inline → nhập + lưu được.
- **Ruling của commit này**: accepted scope của SIL-551 mở per-cont tờ khai
  write (container-line command) cho **Điều vận** — supersede câu role của
  card 261013200312 ("CUS/Quản trị/Quản lý only") cho RIÊNG command per-cont.
  Luật **tờ khai cấp LÔ** (quick-edit documents / FB-005 shipment authority,
  `shipmentFieldAccess.declarationNumber`) GIỮ NGUYÊN CUS/Quản trị/Quản lý.
  Surface `/dispatch-detail` + twin drawer "Chi tiết container" (/dispatch)
  mở editor cho Điều vận; các editor per-cont trên CUS workboard (ledger
  RowEditor / CusLotView) vẫn gate theo lot-level fieldAccess (divergence chủ
  ý — cùng command, gate khác; ghi chú trong code).

## Case pin (expected sau thay đổi)

1. `/dispatch-detail` ô SỐ TỜ KHAI dòng FCL (`row.shipmentContainerId !=
   null`): Điều vận/CUS/Quản trị/Quản lý thấy text-button click-to-edit
   ("Sửa số tờ khai · <số cont>", owner ruling 20261006_537 — không nút Sửa);
   ACCOUNTANT/DRIVER/OPS/... giữ text tĩnh "Chưa có tờ khai"/số hiện có —
   không affordance (writer 403).
2. Click → input inline (aria "Số tờ khai", maxLength 50) → Enter lưu qua
   container-line command (`POST /shipments/cus-workspace/:id/containers/
   :lineId` với expectedShipmentVersion + declarationNumber + Idempotency-
   Key) → FB-109 auto-copy chạy server-side + toast đếm sibling →
   `onRowsChanged` refetch board → ô hiện số mới. Escape/blur hồi; Enter
   không đổi giá trị không ghi; 409 trùng lô khác / 409 version surface
   nguyên văn, editor giữ mở.
3. Dòng LCL (không shipmentContainerId): list tờ khai cấp lô read-only,
   không editor — unchanged.
4. Twin drawer "Chi tiết container" (/dispatch, DispatchContainerDetailDrawer)
   cùng luật: Điều vận mở được editor SỐ TỜ KHAI (một writer law cho command).
5. Luật cấp lô không đổi: `shipmentFieldAccess.declarationNumber` vẫn
   CUS/Quản trị/Quản lý (quick-edit documents giữ nguyên); message 403 của
   writer đổi thành "Chỉ CUS, Quản trị, Quản lý hoặc Điều vận được cập nhật
   tờ khai."
6. Layout /dispatch-detail không đổi (cột SỐ TỜ KHAI 7%, SIL-591); SIL-515
   wrap-full không đụng.

## Regression evidence (qa/2026-10-28_sil551-decl/)

- `qa/2026-10-28_sil551-decl_tests.log` — scoped FE vitest (detailed-plan +
  master-plan + ShipmentsPage) 70 file / 856 test PASS + BE unit
  (cus-container-declaration-copy/wire, add-tokhai-sync, line-tokhai-edit-sync)
  31/31 PASS (`node --test`); `qa/2026-10-28_sil551-decl_tsc.log` — BE
  `tsc --noEmit` 0 + FE `tsc -b` 0.
- UI drive `qa/scripts/2026-10-28-sil551-decl-dv-ui-drive.mjs` EXIT=0 (5/5,
  `run1/assertions.json`), role dungnv (Điều vận — ticket repro),
  `/dispatch-detail?q=R42RV-FCL`, cont MSKU1234565 (id 275):
  - A: dispatcher THẤY affordance "Sửa số tờ khai · MSKU1234565" (trước fix:
    text tĩnh, click không mở gì).
  - B: click → editor inline mở → gõ TK-SIL551-DV → Enter → toast "Đã lưu số
    tờ khai." → ô hiện số mới.
  - C: restore TK-R42RV-001 qua cùng đường UI.
  - Screenshots: run1/{board-open,decl-editor-open,decl-saved-1280,
    decl-saved-390,decl-restored}-*.png + ui-driver.log.
- DB proof `db-before.txt` / `db-after.txt` (psql ss-prod-db): cont 275 về
  TK-R42RV-001 sau drive (276 không đổi — FB-109 không đụng cont đã có số);
  giá trị TK-SIL551-DV đã ghi rồi restore trong phiên.
- ENV limitation như SIL-550 (ghi trong ui-driver.log): CDP keyboard
  injection chết trên trang authed Chrome 156 — typing qua DOM event
  synthesis (input/keydown thật vào control thật), click là DOM click thật.
