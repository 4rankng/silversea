# Cards 211026130743 (DRI-01) + 211026130015 (DIS-09) — tel: trên /trips + Đổi nhà xe/BKS row-menu

- **Branch:** `fix-dri01-dis09-visible` (off main `9aab78d2`)
- **Ngày:** 2026-10-21
- **Quy tắc lane:** LOCAL verify. Audit ruling: "code CÓ nhưng nằm màn khác màn QA vào = bug" — tính năng phải dùng được ngay trên bề mặt QA vào.

## Case DRI-01 (card 211026130743) — SĐT kho/nhà máy tel: chạm-gọi trên /trips/:id

### Repro (before)
1. Đăng nhập ADMIN → mở `/trips/:id` (Chi tiết chuyến đi).
2. KQ trước fix: KHÔNG có dòng SĐT kho/nhà máy ở đâu trên trang; SĐT ở khối
   "Liên hệ & hướng dẫn" là anchor `href={`tel:${raw}`}` thủ công — chết với số
   có khoảng trắng/dấu chấm (đúng class bug audit nêu).
3. `/config/factories` (danh sách SĐT kho master-data): số là text chết,
   không bấm gọi được.

### Expected
- `/trips/:id`: SĐT kho/nhà máy (site của lô) hiện ở Thông tin cơ bản, là
  `tel:` link chuẩn nhà (TelLink — strip khoảng trắng/dấu chấm, giữ `+84`).
- SĐT ở "Liên hệ & hướng dẫn" đi qua CÙNG TelLink.
- Mọi danh sách hiện SĐT kho (`/config/factories`, dialog chi tiết site,
  popover nhà máy ở form nhận lô) đều bấm-gọi được.

### Fix
| Lớp | File | Nội dung |
|---|---|---|
| BE | `backend/src/services/trip-factory-site.service.ts` | `TripFactorySiteView` thêm `contactName`/`contactPhone` — LUÔN đọc LIVE site (không đóng băng SĐT vào snapshot; đúng nguồn driver channel đang gọi). Route `/api/trips/:id` đã attach sẵn `factorySite`. |
| Shared | `shared/src/types/index.ts` | `TripDetail.factorySite?` (optional, có `contactPhone`). |
| FE | `features/trip-detail/components/BasicInfoCard.tsx` | Dòng "SĐT kho/nhà máy" = TelLink (render khi site có SĐT). |
| FE | `pages/TripDetailPage.tsx` + `pages/ForwarderTripDetailPage.tsx` | SĐT "Liên hệ & hướng dẫn" → TelLink chung (bỏ raw href template). |
| FE | `pages/config/FactoriesConfigPage.tsx` | Danh sách site: `OperationalSiteContactsList callable` → số là TelLink + nút Gọi. |
| FE | `components/shipment/OperationalSiteDetailsDialog.tsx` | "Số điện thoại" → TelLink. |
| FE | `features/shipments/create/FactoryDetailPopover.tsx` | SĐT nhà máy trong peek → TelLink. |

### Verify
- **Rung 3 (UI DRIVEN)** — script `testplan/qa/scripts/2026-10-21-dri01-dis09-ui-drive.mjs`, viewport 390×844, role ADMIN `admin`, trip 194048 (`DRI-pt0939559-A`, site "NM DRI pt0939559"):
  - `dri01-01-trips-detail-tel-390.png` — dòng "SĐT KHO/NHÀ MÁY" số `02253555555` màu brand, là anchor; DOM assertion `href="tel:02253555555"`.
  - Seed qua API chính thức (`PUT /trips/194048/instructions`, SĐT có khoảng trắng `0989 130 345`) → `dri01-03-instructions-tel-390.png`: hiển thị GIỮ khoảng trắng, href `tel:0989130345` (strip) — đúng class bug audit.
  - `dri01-02-factories-list-tel-390.png` — `/config/factories`: 52 tel link + 26 nút Gọi trong 272 dòng chi tiết.
  - DB/API: `GET /api/trips/194048` trả `factorySite.contactPhone = 02253555555` (source SNAPSHOT, phone LIVE).
- **Unit:** `backend/src/tests/unit/trip-factory-site-contact.test.ts` (4 pass — pin select cột contact + nhánh SNAPSHOT gắn phone LIVE), FE `BasicInfoCard.test.tsx` (+2), `TripDetailPage.tel-source.test.ts` (5 source pins), `FactoryDetailPopover.test.tsx` (đổi pin tel:), `OperationalSiteContactsList.test.tsx` (callable đã có).

## Case DIS-09 (card 211026130015) — "Đổi nhà xe/BKS" vào ROW MENU (⋯)

### Repro (before)
1. Đăng nhập ĐIỀU VẬN → `/dispatch-detail` → dòng lô Lẻ đã ghép nhóm đã gán xe.
2. Nút "Đổi nhà xe/BKS" chỉ tồn tại TRONG modal mở bằng badge `Lẻ · Ghép (1/N)`
   ở cột Phân loại (badge → modal → nút) — audit: "Ẩn sau tương tác nhiều tầng".

### Expected
Row menu (dropdown ⋯) trên từng tác vụ đã gán chứa action "Đổi nhà xe/BKS" —
1 click tới dialog đổi (pre-filled), không phải mở badge trước.

### Fix
| Lớp | File | Nội dung |
|---|---|---|
| FE | `features/dispatch/detailed-plan/DispatchRowActionsMenu.tsx` (mới) | Menu ⋯ trên dòng đã gán: item "Đổi nhà xe/BKS" (lô ghép) + "Phân xe lại" (chuyến đã phát, cùng luật live-trip như editor trigger). Danh sách portal ra body, `position: fixed` — cell `.detailed-plan-grid__cell-body` là `overflow: hidden` (absolute bị cắt = tái diễn "action invisible"). Đóng qua tầng dismiss chung (`useDropdownDismiss` + `data-dropdown-root`). |
| FE | `features/dispatch/detailed-plan/DetailedPlanGrid.tsx` | `openGroupTruckEdit(row)` — mở CÙNG edit state với nút badge (modal + draft pre-filled từ BKS nhóm), gắn menu vào `.detailed-plan-grid__note-actions`. |
| FE | `DetailedPlanGrid.css` | Style menu (trigger 28px khớp hàng action; list surface house tokens). |

### Verify
- **Rung 3 (UI DRIVEN)** — cùng script, 1440×900, role ĐIỀU VẬN `dieuvan`, deep link `/dispatch-detail?q=FB095UI-482D6671-A`, nhóm `8038cabd…` (2 lô 109225/109226, BKS thực `29X-QA482D`):
  - `dis09-01-row-menu-open-1440.png` — menu ⋯ mở ngay trên dòng, item "Đổi nhà xe/BKS" nhìn thấy (fixed portal, KHÔNG bị cell cắt).
  - `dis09-02-truck-edit-prefilled-1440.png` — 1 click: modal "Nhóm ghép trả ĐV · Lẻ (1/2)" mở sẵn `BKS thực = BKS báo khách = 29X-QA482D`.
  - Đổi `29X-QA-D9A` → "Lưu xe nhóm" → toast "Đã đổi xe nhóm — 2 lô cập nhật BKS", modal đóng; **DB proof:** cả HAI thành viên `actual_truck_no = 29X-QA-D9A`.
  - Revert qua CÙNG đường UI: mở lại menu → dialog pre-filled `29X-QA-D9A` (refetch coherence) → lưu `29X-QA482D` → DB proof khôi phục nguyên trạng cả 2 lô.
  - Driver log: `dri01-dis09-ui-driver.log` — 18/18 PASS, exit 0.
- **Unit:** `DetailedPlanGrid.row-menu.test.tsx` (5 case: menu hiện trên dòng đã gán, item mở dialog pre-filled + save qua `updateLclTruck`, "Phân xe lại" raise đúng tripId, cả 2 item khi vừa ghép vừa đã phát, ẩn với dòng chưa gán/đã hoàn thành), `DetailedPlanGrid.row-menu.styles.test.ts` (2 pin chống cắt: không `position: absolute`, bắt buộc portal + fixed).

## Local DB mutation note
- Nhóm `8038cabd…` đổi BKS rồi revert qua UI → dữ liệu về nguyên trạng (version tăng, audit-log append — noise QA chấp nhận được theo tiền lệ lane fb019).
- Trip 194048 được seed `instructions` (tên "Chị An (QA)", SĐT `0989 130 345`) qua endpoint quản lý — giữ lại làm fixture DRI-01.

## Gates (toàn bộ artifact trong `qa/2026-10-21-dri01-dis09/`)
| Gate | Kết quả |
|---|---|
| `pnpm lint` | 0 error (`gate-root-lint.txt`) |
| BE `tsc --noEmit` | 0 (`gate-be-tsc.txt`) |
| BE unit | 348/348 pass (`gate-be-tests.txt`) |
| BE integration | 335/335 pass (`gate-be-integration.txt`) |
| FE `tsc -b` | 0 (`gate-fe-tsc.txt`) |
| FE vitest FULL | **5429/5429 pass** (`gate-fe-tests.txt`; run đầu dính 40 fail = 38 do thiếu `dist/` + flake load đã xử lý bằng build + run lại tới xanh) |
| `make build` | OK (`gate-build.txt`) |

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| DRI-01: SĐT kho/nhà máy tel: trên /trips/:id | UI DRIVEN | dri01-01 PNG, driver log PASS R1–R4, API factorySite | Role khác ADMIN (MANAGER/CUS xem cùng trang — cùng component); iOS/Android dialer thật (headless không có handler — href + SPA-still-put là bằng chứng) |
| DRI-01: SĐT "Liên hệ & hướng dẫn" TelLink strip khoảng trắng | UI DRIVEN | dri01-03 PNG, PASS R5/R6 (seed `0989 130 345` → `tel:0989130345`) | Số dạng dấu chấm không seed được (schema chặn `.`) — pin unit `TelLink.test.tsx` |
| DRI-01: /config/factories + dialog site + popover nhà máy tel: | UI DRIVEN (list) / UNIT (dialog+popover) | dri01-02 PNG PASS R7/R8; `FactoryDetailPopover.test.tsx`, `OperationalSiteContactsList.test.tsx`; dialog site chưa có vitest riêng — pin source `TripDetailPage.tel-source.test.ts` | Dialog/popover chưa drive UI thật (cùng TelLink pattern đã unit-pin) |
| DIS-09: "Đổi nhà xe/BKS" trong row menu, 1 click tới dialog | UI DRIVEN | dis09-01/02 PNG, driver log PASS DIS09-R1–R5, DB1/DB2 | Viewport 390px cho màn điều vận (màn desktop-first; menu fixed-portal render độc lập bề rộng — chưa drive 390); role MANAGER/CUS |
| DIS-09: menu ẩn đúng với dòng chưa gán / đã hoàn thành | UNIT | `DetailedPlanGrid.row-menu.test.tsx` case 4–5 | — |
