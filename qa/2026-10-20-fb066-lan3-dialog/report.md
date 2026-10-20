# FB-066 lần 3 — quick-add BKS trong dialog "Phân bổ nhà xe" — QA report (2026-10-20)

Card: 201026101600 (lần 3) · QA R27 build `d39ee741` · Branch `fix-fb066-lan3` (off `main` 106a25e3).
Surface: dialog **"Phân bổ nhà xe"** (`DispatchAllocationPopover` shell, `/dispatch`
Kế hoạch Tổng quát) — field-set theo cargoMode (card 191026181942).
Môi trường: local dev — vite worktree `:7180`, backend `:3002` (shared, SSD main),
DB ss-prod-db `:5441`, role **dieuvan** (đăng nhập qua `POST /api/auth/login`, token
inject trước SPA navigation — `puppeteer-spa-auth`).

Driver: `testplan/qa/scripts/2026-10-20-fb066-lan3-dialog-repro.mjs`
(`QA_BASE=http://localhost:7180 QA_API=http://localhost:3002/api SHOT_PREFIX=before|after
QA_PLATE=<plate>`); DB proof: `2026-10-20-fb066-lan3-db-proof.mjs`.

## QA R27 verbatim → đối chiếu

> "dialog 'Phân bổ nhà xe' vẫn không có nút thêm nhanh biển số xe (CẢ BẢN FCL LẪN LCL);
> gõ biển số chưa đăng ký vào ô BKS cũng không có tuỳ chọn thêm"

| Mệnh đề | Trước | Sau |
|---|---|---|
| nút "+ Thêm nhanh biển số xe" trong dialog (LCL ô BKS) | không có (`before-lcl-dialog.png`) | **"+ Thêm nhanh" cạnh "BKS thực (xe chạy chuyến)"** (`after-lcl-dialog.png`, `after-lcl-typed-plate-dropdown.png`) |
| gõ BKS chưa đăng ký → option thêm | dropdown chỉ "Không tìm thấy kết quả" (`before-lcl-typed-plate-dropdown.png`, log `lcl-typed-unregistered-plate` options=["Không tìm thấy kết quả"]) | **option "Thêm mới: 29C-066.97"** (`after-lcl-typed-plate-dropdown.png`, log options=["Thêm mới: 29C-066.97"]) |
| quick-add flow chọn ngay vào ô, không rời dialog phân bổ | n/a | dialog "Thêm nhanh biển số xe" mở CHỒNG (dialogCount 2) → "Áp dụng" → biển mới vào ô BKS thực + auto-copy BKS ảo, dialog phân bổ giữ nguyên draft (dialogCount về 1, `after-lcl-after-quickadd-apply.png`, log `lcl-quickadd-applied`) |
| bản FCL của dialog | không có ô BKS/xe (contract cont: 20'/40' theo nhà xe theo ngày) | **giữ nguyên — xem coverage table** (không có ô BKS để gắn quick-add; biển số lô cont gán ở Kế hoạch Chi tiết, surface đó đã có quick-add) |

## Rung 3 evidence (§9 — 4/4 paths cho claim LCL)

1. **Screenshot sau click**: `qa/2026-10-20-fb066-lan3-dialog/after-lcl-typed-plate-dropdown.png`
   (nút "+ Thêm nhanh" + option "Thêm mới: 29C-066.97" trong dropdown),
   `after-lcl-quickadd-nested.png` (dialog quick-add mở chồng),
   `after-lcl-after-quickadd-apply.png` (biển đã chọn vào ô, dialog phân bổ còn mở).
2. **DOM/text assertion post-click**: `after-dialog-driver.log` —
   `lcl-typed-unregistered-plate.openListboxOptions=["Thêm mới: 29C-066.97"]`;
   `lcl-quickadd-applied`: `bksInputs[0].value="29C-066.97"` (BKS thực) +
   `bksInputs[1].value="29C-066.97"` (BKS ảo auto-copy) + `openListboxOptions=["29C-066.97","Thêm mới: 29C-066.97"]`
   (biển mới vào option list ngay — interim + refetch).
3. **DB side-effect**: `db-side-effect-proof.json` — catalog `trucks` có
   `{id: 186310, licensePlate: "29C-066.99"}` (lần drive 1) và
   `{id: 186311, licensePlate: "29C-066.97"}` (lần drive 2) — đúng API
   `POST /api/trucks` của luồng quick-add nội bộ (lô chưa có nhà xe → picker
   "Nhà xe" mặc định đội xe nội bộ).
4. **Driver log + exit status**: `before-dialog-driver.log` (exit 0,
   `run-complete`) / `after-dialog-driver.log` (exit 0, `run-complete`) — cùng
   script, 2 pha before/after.

Bằng chứng phụ: unit tests `DispatchAllocationLclDialog.quick-add.test.tsx` 5/5
(nút cả lô có/chưa nhà xe; flow nút → Xe ngoài API → chọn vào ô; option
"Thêm mới: &lt;số&gt;" → dialog seeded → chọn vào ô; picker "Nhà xe" cho lô chưa
có; draft BKS ảo sống sót qua vòng quick-add).

## Coverage table

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| LCL dialog: nút "+ Thêm nhanh" cạnh ô BKS thực (QA R27 #1) | UI DRIVEN | `after-lcl-dialog.png`, `after-lcl-typed-plate-dropdown.png`, `after-dialog-driver.log` | chỉ role dieuvan; 1 lot hàng lẻ local |
| Gõ BKS lạ → option "Thêm mới: &lt;số&gt;" (QA R27 #2) | UI DRIVEN | `after-lcl-typed-plate-dropdown.png` + log options dump | option ảo (BKS báo khách) không có quick-add — chủ đích (ảo không phải xe thật, FB-094) |
| Quick-add flow chọn ngay vào ô, KHÔNG rời dialog phân bổ | UI DRIVEN | `after-lcl-quickadd-nested.png`, `after-lcl-after-quickadd-apply.png`, log `lcl-quickadd-applied`, `db-side-effect-proof.json` | đường lỗi "Biển số xe đã tồn tại" chỉ cover bằng unit test (case tự nhiên nhất: tạo trùng) |
| Lô CHƯA có nhà xe → picker "Nhà xe" ("hãng/nhà xe nếu cần") | CODE-READ + unit | `DispatchAllocationLclDialog.quick-add.test.tsx` case 4; flow thật đã đi qua picker mặc định (bản drive dùng lô chưa nhà xe — xem DB proof) | screenshot picker UuiSelectField không chụp riêng; đổi sang nhà xe ngoài trong picker chỉ cover unit test |
| **FCL cont field-set của dialog** | CODE-READ ONLY (NOT APPLICABLE) | `before-fcl-dialog.png` = `after-fcl-dialog.png` (đối chiếu trước/sau); `DispatchAllocationPopover.tsx`/`DispatchAllocationDaySection.tsx` — field-set là Nhà xe + 20'/40', KHÔNG có ô BKS/xe | Quick-add không thể "chọn ngay vào ô" khi không có ô — xem phần Quyết định FCL |

## Quyết định FCL (đọc kỹ — đây là phần gồ ghề duy nhất)

QA R27 nói "CẢ BẢN FCL LẪN LCL" nhưng bản FCL của dialog "Phân bổ nhà xe"
(cont body) **không có ô BKS/xe để gắn quick-add**: contract của nó (card
191026181942 — "FCL keeps the cont body untouched") là phân bổ SỐ CONTAINER
20'/40' theo nhà xe theo ngày; biển số của lô cont được gán ở **Kế hoạch Chi
tiết** ("Xe / biển số" trong popup "Chỉnh sửa điều phối") — surface ĐÓ đã có
đúng nút "+ Thêm nhanh" này từ card 20261004_357 (UI DRIVEN ở QA R25/R26).
Thêm nút quick-add vào cont body sẽ là nút KHÔNG có ô để chọn vào (vi phạm luật
"unwired = không nút chết") hoặc phải mở rộng contract (thêm ô BKS cấp lô cho
hàng cont — quyết định sản phẩm, không phải sửa lỗi quick-add). Nếu owner vẫn
muốn affordance BKS bên trong dialog FCL, cần một card mới chốt: ô nào, lưu
đâu, ai tiêu thụ.

## Fix summary (files)

- `frontend/src/features/dispatch/master-plan/DispatchAllocationLclDialog.tsx` —
  field-head BKS thực + `QuickAddButton` + `createOption` "Thêm mới: &lt;số&gt;";
  interim plate list + fleet nonce; `QuickAddVehicleDialog` mount chồng;
  `handleVehicleCreated` chọn biển vào ô + refetch, dialog phân bổ giữ state.
- `frontend/src/features/dispatch/detailed-plan/QuickAddVehicleDialog.tsx` —
  + `initialPlate` (seed từ option "Thêm mới"), + `carrierChoices` (hỏi "Nhà xe"
  khi lô chưa có — `UuiSelectField`, control chuẩn của house).
- `frontend/src/features/shipments/create/uui-searchable-field.tsx` — 2 fix
  hành vi chung, đúng invariant của module (typing không được đụng selectedKey;
  option tạo mới là pick thật):
  1. `chosenKey` = last REAL pick only (bỏ fallback phantom `?? value` — nguồn
     gốc dropdown đóng giữa chừng khi gõ và không gợi ý lại, đúng triệu chứng
     QA "gõ … cũng không có tuỳ chọn thêm");
  2. option `__create__` đánh dấu pick thật ở cả 2 kênh key → dropdown đóng hẳn
     khi mở dialog quick-add (không mở lại đè dialog, không giữ react-aria
     `ariaHideOutside` scope làm dialog mù với AT).
- `frontend/src/pages/ShipmentDebitPage.lcl-merge.test.tsx` — thêm bước dismiss
  suggestion menu (Escape) trước bấm submit trong case free-typed BKS (tương
  tác thật: dropdown mở thì nút submit nằm ngoài scope modal popover của
  react-aria; giá trị gõ tay vẫn submit bình thường — assertion giữ nguyên).
- Test mới: `DispatchAllocationLclDialog.quick-add.test.tsx` (5 cases).

## Design provenance

Không consultation catalog (Untitled UI PRO / Tailkit) — không layout mới nào
được phát minh: nút dùng component chung sẵn có `QuickAddButton` (FB-066),
picker "Nhà xe" dùng `UuiSelectField` (control select duy nhất được phép —
lint `@tingting/no-native-select`), field-head lặp đúng pattern vehicle-head của
`AssignTruckGroupDialog`/`LclGroupTruckEditDialog`. Design laws áp dụng:
"one concept, one place" (context nhà xe chỉ hiện ở picker khi asking mode),
ordinary control ≤40px.

## Gates

Xem `gates.log` cùng thư mục: FE `npx tsgo -b` 0 · root `pnpm lint` 0 ·
FE vitest full (sau `make build` cho 2 dist-pin tests) · `make build` OK.
