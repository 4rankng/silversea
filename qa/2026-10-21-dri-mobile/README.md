# dri-01 + dri-04 — double-verify trên viewport LÁI XE 390px (LOCAL)

Ngày: 2026-10-21 · Branch: `verify-dri-mobile` (off `main` @ `536aad6c`)
Brief: mobile double-verify — dri-01 `tel:` + dri-04 cảng hạ / địa chỉ giao hàng.

## Kết luận

**Hai mục ĐÃ CÓ trong code — QA ghi "NOT IMPLEMENTED" là nhầm. KHÔNG cần fix
source.** Cả hai đều được chứng minh bằng UI thật ở viewport lái xe 390px
(rung 3) trên stack LOCAL, không đụng staging.

| Mục | Verdict | Nơi hiện thực | Người thực hiện |
|---|---|---|---|
| dri-01 — SĐT kho/nhà máy chạm-gọi được (`<a href="tel:…">`) | **ĐÃ CÓ** | `frontend/src/pages/driver/DriverTaskInfoSections.tsx:227,234` (dòng "SĐT kho" + "SĐT liên hệ") + `frontend/src/components/TelLink.tsx` (helper dùng chung) + `frontend/src/components/shipment/OperationalSiteContactsList.tsx` (số trong modal "Chọn liên hệ để gọi") | `61f439b6` → `f0986f4c` (REQ-14) |
| dri-04 — "Cảng hạ" vs "Địa chỉ giao hàng" map đúng | **ĐÃ CÓ** | `backend/src/services/delivery-stage.ts` (chuỗi cảng hạ) + `frontend/src/features/driver/driver-display.ts` + `DriverTaskInfoSections.tsx:242-250` | `00fa92b4` → `da73a743` (card 171026205400 / FB-020) |

**Audit bề mặt lái xe (không còn màn nào thiếu `tel:`):** đây là màn DUY NHẤT
của lái xe hiển thị số điện thoại. Grep `phone|SĐT|tel:` trên toàn bộ màn
lái xe còn lại → **0 kết quả** ở `DriverTripsPage.tsx` (danh sách lệnh),
`DriverTwoOrdersPage.tsx`, `DriverTripPodPage.tsx`, `DriverEarningsPage.tsx`,
`DriverPayslipsPage.tsx`. ⇒ Không có "màn nào thiếu" để bổ sung.

## Môi trường (LOCAL — staging immutable, không đụng)

| Thành phần | Giá trị |
|---|---|
| Frontend | `http://localhost:7177` — vite, khởi động từ worktree `verify-dri-mobile`, proxy `/api` → `:3003` |
| Backend | `http://localhost:3003` — tsx, khởi động từ worktree `verify-dri-mobile`, `SCHEDULER_DISABLE=1` |
| DB | `ss-prod-db` :5441 / `silversea` (PostgreSQL 16.15) · Redis :6391 |
| Commit | `536aad6c` · node v25.8.1 · pnpm 10.33.0 |
| Browser | Google Chrome 155 headless, viewport **390×844**, `isMobile+hasTouch` |
| Tài khoản | **bqhuong** (DRIVER) — `driverId=42966`, `userId=139156` |

Stack chạy trên cổng RIÊNG (7177/3003) để không gián đoạn stack `:7175/:3002`
của session khác trên cùng máy; DB/Redis dùng chung (dev stack, như contract).

## Scenario data (mutation QA CỤC BỐ, không phải dữ liệu thật)

Mọi mục mang prefix `DRI-<serial>` — serial của lần chạy được ghi trong log.
Bản ghi chính xác của lần chạy được ship: **serial `pxz1m1898`**.

| Mục | Giá trị |
|---|---|
| Tài xế | user `bqhuong` (DRIVER) — tạo local qua `POST /api/auth/users` + bind `POST /api/config/driver-user-bindings/:driverId` (`driverId=42966`) |
| Xe + rơ-moóc | `QA-DRI-pxz1m1898` (truck id 186320) + `RM-DRI-pxz1m1898` (trailer id 20461) |
| Nhà máy | operational site id 27162 `NM DRI pxz1m1898`, địa chỉ "Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh", SĐT kho `02253555555`, 2 liên hệ (`Chị An` 02253555555 · `Bảo vệ kho` **0909.000.001** — số dạng chấm để chứng minh chuẩn hóa) |
| Bãi hạ | port id 35663 `Bãi Hạ DRI pxz1m1898` |
| Lô A (dri-01 + dri-04 nhánh "có bãi hạ") | bill `DRI-pxz1m1898-A` · container `DRIM1189813` · `dropoff_port_id=35663` · **trip 194057 (CREATED)** |
| Lô B (dri-04 nhánh portless) | bill `DRI-pxz1m1898-B` · container `DRIM1189829` · `dropoff_port_id=NULL` · **trip 194058 (CREATED)** |

`trip.status = CREATED` ⇒ đây đúng là màn **NHẬN LỆNH** (chưa bấm "Nhận lệnh
vận chuyển"), không phải chuyến đang chạy.

## Driver

`qa/2026-10-21-dri-mobile/ui-drive.mjs` — puppeteer-core, 17 assertion, exit 0.
Log: `ui-driver.log` (**17/17 PASS, 0 FAIL**).

Cross-check độc lập bằng regression pack CỦA REPO (không sửa spec):
`frontend/e2e/regression/fb020-driver-cang-ha.spec.ts` → **2/2 PASS, exit 0**
(log: `regpack-fb020-driver.log`).

## Trước / sau

Brief yêu cầu evidence 390px **trước/sau**. Vì **không có fix nào được áp
dụng** (cả hai mục đã có sẵn trên `main`), "trước" và "sau" phải **giống hệt** —
và đó chính là điều được chứng minh:

| Trạng thái | Stack | Driver | Kết quả |
|---|---|---|---|
| **TRƯỚC** — stack chuẩn của cây `main` (frontend `:7175` → backend `:3002`) | code lái xe **giống hệt** `main` (đã diff: `frontend/src/pages/driver/**`, `TelLink.tsx`, `OperationalSiteContactsList*`, `liftDropPoints.ts`, `driverClient.ts` — diff RỖNG giữa cây stock và worktree) | `ui-drive-before-main.mjs` (trip 194057 / 194058) | **9/9 PASS** — `ui-driver-before-main.log`, `ui-0-before-main-tripA-390.png`, `ui-0b-before-main-tripA-cang-ha-rows-390.png`, `ui-0c-before-main-tripB-390.png` |
| **SAU** — stack riêng của worktree `verify-dri-mobile` (frontend `:7177` → backend `:3003`) | cùng code (không sửa source) | `ui-drive.mjs` (scenario tạo mới) | **17/17 PASS** — `ui-driver.log`, `ui-1*`, `ui-2*`, `ui-3*` |

⇒ Không có màn nào thiếu `tel:`, không có hàng nào map sai ⇒ **diff này không
sửa source**, chỉ mang evidence.


## Gates

| Gate | Kết quả |
|---|---|
| `cd frontend && npx tsgo -b` | **0 lỗi** (exit 0) |
| `cd frontend && npx vitest run` (scoped: TelLink · OperationalSiteContactsList · DriverTaskInfoSections · DriverTripDetailPage · driver-display) | **130/130 PASS** (5 file) |
| `cd backend && npx tsx --test src/tests/unit/delivery-stage.test.ts` | **5/5 PASS** (gồm case FB-020 portless import) |
| `npx playwright test -c playwright.regression.config.ts e2e/regression/fb020-driver-cang-ha.spec.ts` (REG_BASE_URL=:7177) | **2/2 PASS**, exit 0 |

Không sửa source ⇒ không có gate nào bị ảnh hưởng (shared/schema/RBAC/tài
chính không đổi); `pnpm lint` / `make build` không bắt buộc cho diff chỉ gồm
artifact `qa/`.

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| **dri-01** dòng "SĐT kho" trên màn nhận lệnh là `<a href="tel:02253555555">` | **UI DRIVEN** | `ui-1-tripA-nhan-lenh-390.png` (390px, banner "Kiểm tra thông tin chuyến rồi chọn Nhận lệnh" + CTA "Nhận lệnh vận chuyển"), DOM assert `ui-driver.log` check #2-#3, DB `db-evidence.txt` (site 27162 `contact_phone=02253555555`), **trước** `ui-0-before-main-tripA-390.png` + `ui-driver-before-main.log` | iOS/Android thật (dialer OS không mô phỏng được); WebView Safari/Firefox; viewport 768/1440 |
| **dri-01** dòng "SĐT liên hệ" là `<a href="tel:0909000001">` (số dạng chấm trên màn, href đã bỏ dấu chấm) | **UI DRIVEN** | `ui-1-tripA-nhan-lenh-390.png`, DOM assert check #4-#6, DB `db-evidence.txt` (shipment 312324 `contact_phone=0909.000.001` ≠ site phone), **trước** `ui-driver-before-main.log` check #4-#5 | như trên; trường hợp site KHÔNG có SĐT (dòng hiện "—") chưa drive |
| **dri-01** số trong modal "Chọn liên hệ để gọi" là link tel: (2 liên hệ) | **UI DRIVEN** | `ui-2-call-modal-tel-links-390.png` (bấm nút "Gọi kho" → mở modal), DOM assert check #10-#14 | modal 1 liên hệ (khi đó hiện nút Gọi dạng anchor, không mở modal) chưa drive |
| **dri-04** container CÓ bãi hạ → "Cảng hạ" = tên bãi hạ, "Địa chỉ giao hàng" = nhà máy (điểm nhận), hai hàng KHÁC nhau | **UI DRIVEN** | `ui-1c-tripA-cang-ha-rows-390.png` (390px, cận cảnh 2 hàng), `ui-1b-tripA-full-390.png`, DOM assert check #7-#9, DB `db-evidence.txt` (trip 194057 `dropoff_port_id=35662`), **trước** `ui-0b-before-main-tripA-cang-ha-rows-390.png`, `ui-5-regpack-fb020-02-control-co-cang-ha.png` + `regpack-fb020-driver.log` (TC-FB020-002 control của repo) | hướng EXPORT (chỉ IMPORT); LCL; quyền role khác (CUS/OPS/FORWARDER không mở màn lái xe) |
| **dri-04** container KHÔNG có bãi hạ (portless) → "Cảng hạ" = tên điểm trả, KHÔNG phải "Chưa có cảng hạ"; "Địa chỉ giao hàng" = nhà máy đầy đủ + địa chỉ (2 hàng cùng tên — PRD ManHinhLaiXe §2.3) | **UI DRIVEN** | `ui-3c-tripB-cang-ha-rows-390.png` (390px), `ui-3b-tripB-full-390.png`, DOM assert check #15-#17, DB `db-evidence.txt` (trip 194058 `dropoff_port_id` NULL + site 27162), **trước** `ui-0c-before-main-tripB-390.png`, `ui-4-regpack-fb020-01-portless-cang-ha.png` + `regpack-fb020-driver.log` (TC-FB020-001 của repo) | như trên; trường hợp thiếu cả port lẫn snapshot (kỳ vọng "Chưa có cảng hạ") chưa drive |
| Màn lái xe khác có thiếu `tel:` không | CODE-READ ONLY (grep 0 kết quả trên 5 màn lái xe còn lại) | grep `phone\|SĐT\|tel:` trên `DriverTripsPage.tsx`, `DriverTwoOrdersPage.tsx`, `DriverTripPodPage.tsx`, `DriverEarningsPage.tsx`, `DriverPayslipsPage.tsx` → 0 | các màn lái xe dựng động ở route khác (nếu có) chưa rà |

## Phạm vi không làm (explicit)

- **KHÔNG đụng staging** — staging immutable theo rule của owner; mọi verify ở
  LOCAL trên stack riêng của worktree này.
- **KHÔNG sửa source** — cả hai mục đã có; chỉ bổ sung evidence. Commit chỉ
  mang artifact `qa/` + script driver.
- Fixture QA tạo trong DB local vẫn còn (site/port/xe/rơ-moóc/lô/trip prefix
  `DRI-`/`QA-DRI-`/`RM-DRI-`); dọn bằng `pnpm --dir backend db:sweep-fixtures`
  nếu cần.
- Không chạy sweep toàn bộ regression pack (12 spec) — chỉ chạy spec FB-020
  liên quan; các spec khác không bị thay đổi bởi diff này.

## Kết luận cho QA

Verdict "NOT IMPLEMENTED" của QA cho cả dri-01 và dri-04 **bị bác** — có bằng
chứng rung 3 (screenshot 390px + DOM assert + DB side-effect + driver log).
Nếu QA vẫn thấy thiếu, nguyên nhân có thể là **dữ liệu**: chỉ khi site/nhà
máy có `contact_phone` thì dòng "SĐT kho" mới render link (không có → "—"),
và chỉ khi container có `dropoff_port` thì "Cảng hạ" mới là tên bãi hạ.
