# Case QA-2026-10-19-create-form-fb111-a3-d4 — /shipments/new: append-copy, chứng từ order, nút thêm ngày giao

Reported as three cards on the CREATE form (surface distinct from the
Chi tiết/Tổng quan fixes landed in earlier waves):

- **FB-111 + 181026200100 (A.1):** bấm "Thêm container" trên form tạo lô —
  dòng mới KHÔNG copy trường từ dòng trước. QA expectation: dòng 2/3/4 hiện
  40DC (copy LOẠI CONT), các trường khác (tuyến/nhà xe/biển số/nâng-hạ/trọng
  lượng nếu form có) cũng copy; chỉ để trống Số container. Supersedes card
  071026100800's blank-type ruling on this create form.
- **181026200200 (A.3):** mục "Nhận diện lô" — thứ tự trường
  Số booking → Số tờ khai → Nhập/Xuất → Hãng tàu (same order FB-113 set on
  the ledger popup; this is the create form).
- **181026200700 (D.4):** mục "Lịch & ghi chú" hàng lẻ — BỎ nút
  "+ Thêm ngày giao" còn sót sau wave D (0f7e1dfa), chỉ giữ 1 trường
  "Ngày giao hàng".

## Reproduce (pre-fix defect)

1. Local stack up; CUS login; open `/shipments/new` (FCL default).
2. FB-111: fill row 1 (Loại 40DC, trọng lượng, ngày giờ đóng trả) → set
   "Số container cần thêm" = 3 → bấm "Thêm container". Actual pre-fix: rows
   2/3/4 arrive with Loại container blank ("Chọn loại") — only route/ports/
   factory/appointment/weight rode.
3. A.3: read the "Nhận diện lô" band. Actual pre-fix DOM order:
   Hình thức xuất nhập khẩu → Số Bill/Booking → (Hãng tàu) → Số tờ khai.
4. D.4: switch "Hàng lẻ". Actual pre-fix: a lone dashed "Thêm ngày giao
   hàng" button (the section was already removed; the button survived).

## Expected

1. FB-111: every added row mirrors the previous row — Loại cont (40DC),
   tuyến, nhà máy, cảng nâng/hạ, trọng lượng, ngày giờ đóng trả; ONLY
   Số container is blank.
2. A.3: DOM order Số Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu
   (Khách hàng leads, untouched).
3. D.4: no add button; exactly ONE always-visible "Ngày giao hàng" field
   (id `shipment-expected-delivery`).

## Fix

- `frontend/src/features/shipments/create/shipment-create-model.ts` —
  `createContainerFromPrevious` blanks only `containerNumber` (FB-111
  supersedes 071026100800 on this form).
- `frontend/src/features/shipments/create/ShipmentCreateIdentitySection.tsx`
  — band reorder: customer+booking (6/6) → tờ khai strip → XNK+hãng tàu
  (6/6) → flags solo.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx` +
  `ClerkShipmentCreatePage.css` — LCL block = one always-visible field; add
  button, reveal state, extra-delivery rows, `Trash2` import and the
  `.csc-extra-dates*` / `.csc-lcl-delivery__issue` CSS retired.

## Verification

- Scoped vitest: model + identity + append-action + mode-toggle +
  asterisk-contract + page + styles — all green (incl. new pins:
  full-copy model test, 4-row copy page test, A.3 DOM-order test, D.4
  single-field page test, new 6/6 column map). `npx tsgo -b` exit 0.
- UI rung (fresh-tab puppeteer, CUS login, local dev): 3/3 PASS —
  `qa/2026-10-19_create-form_ui-driver.log`, shots
  `qa/2026-10-19_create-form_a3-identity-order.png`,
  `qa/2026-10-19_create-form_fb111-copy-3-rows.png` (4 rows × 40DC, số
  container blank), `qa/2026-10-19_create-form_d4-single-delivery-field.png`,
  `qa/2026-10-19_create-form_d4-lcl-full-context.png`.
