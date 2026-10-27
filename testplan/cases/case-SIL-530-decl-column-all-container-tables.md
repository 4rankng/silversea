# SIL-530 — Cột Số tờ khai vào TẤT CẢ bảng liệt kê container theo dòng

- Ticket: SIL-530 (board SIL, internal id 593, QA) — mở rộng cột SỐ TỜ KHAI
  click-to-edit ra mọi bảng liệt kê container từng dòng, theo model per-cont
  SIL-521 (trùng 1 phần/toàn bộ OK, sửa từng cont).
- dispatch-detail (DetailedPlanGrid) ĐÃ có từ SIL-591 — không đụng lại.
- Surface duy nhất còn thiếu sau audit: drawer **Chi tiết container** của
  Kế hoạch tổng quát (`/dispatch` — `DispatchContainerDetailDrawer`), mở từ
  nút "Chi tiết" trên dòng có nhu cầu cont (grid + card list cùng mở drawer
  này).

## Case pin (expected sau thay đổi)

1. Drawer carries the SỐ TỜ KHAI column (header + `td[data-label="Số tờ
   khai"]` từng dòng) giữa LOẠI CONT và ĐIỀU VẬN; giá trị = số tờ khai CỦA
   container đó (`shipment_containers.declaration_number` — per-cont), dòng
   thiếu số hiện "Chưa có tờ khai", không bao giờ "—".
2. Role law 261013200312: ADMIN/MANAGER/CUS thấy affordance click-to-edit
   (button "Sửa số tờ khai · <số cont>"); DISPATCHER/ACCOUNTANT chỉ thấy text
   tĩnh — không affordance (server sẽ 403).
3. Click → input inline (placeholder "Nhập số tờ khai", maxLength 50) → Enter
   lưu qua container-line command (`expectedShipmentVersion` +
   `declarationNumber` + Idempotency-Key) → drawer tự refetch → ô hiển thị số
   mới; toast "Đã lưu số tờ khai." (hoặc đếm sibling khi FB-109 điền thêm dòng
   trống); Escape/blur hoàn nguyên; Enter không đổi giá trị không ghi.
4. Lỗi lưu (409 trùng lô khác / 403 vai trò / 409 version) surface nguyên văn
   message backend qua toast error, editor MỞ để sửa tiếp, không refetch.
5. Không đè sibling đang giữ số (FB-109 chỉ điền dòng TRỐNG) — proven: sửa
   cont 275 không đổi cont 276 (DB proof 2 updated_at khác nhau).
6. Bố cục: table min-width 1050px (44 + 3×150 + 6×≥92) — header vẫn 1 dòng;
   card mode ≤760px giữ ô qua data-label band.

## Regression evidence (qa/2026-10-28_sil530-decl-drawer/)

- `vitest-scoped.log` — 7 file / 120 test (drawer + styles pins + DispatchDeclarationCell
  + DetailedPlanGrid + 3 MasterPlanPage suites); `tsgo-fe.log` — 0 errors.
- UI drive `qa/scripts/2026-10-28-sil530-decl-drawer-ui-drive.mjs` EXIT=0:
  run `set/`+`restore/` (trước fix) và `set-fixed/`+`restore-fixed/` (sau fix)
  — admin ghi TK-SIL593-DRAWER/TK-SIL593-FIX lên cont 275 @1440 + 390,
  dispatcher read-only; run `restore-fixed/` còn pin luồng RE-EDIT cùng phiên
  drawer (click lại cùng ô sau save thành công phải mở lại editor — regression
  của bug `saving` không reset do reviewer bắt, đã sửa cả 2 cell cùng class:
  DispatchContainerDetailDrawer + DispatchDeclarationCell SIL-591).
- DB proof `db-side-effect-proof-run1-set.txt` (275 = TK-SIL593-DRAWER, 276
  giữ TK-R42RV-001) → `-run2-restore.txt`, `-run3-set-fixed.txt` (275 =
  TK-SIL593-FIX) → `-run4-restore-fixed.txt` (275 về TK-R42RV-001 — DB sạch
  như trước drive).
