# REQ-14 — tel: link SĐT kho/nhà máy trong chi tiết NHẬN LỆNH (driver)

Ngày: 2026-10-21 · Branch: `feat-req14-tel-link` (off main c643ef1e)

## Yêu cầu

Doc khách (ManHinhLaiXe §3.1): "Tên liên hệ và số điện thoại phải cùng nhóm
với địa chỉ nhà máy, **gọi được qua liên kết điện thoại**". Trong chi tiết
nhận lệnh của tài xế, SĐT kho/nhà máy phải chạm-được để mở màn hình gọi.

## Trạng thái tìm thấy trên main

- Dòng "SĐT kho" + "SĐT liên hệ" trong grid THÔNG TIN LỆNH: đã tel-link từ
  REQ-05 (card 20261005_364, commit 26dee2d1) và sweep card 081026230540
  (commit 61f439b6).
- **Delta REQ-14 còn lại (đã làm trong branch này):**
  1. `telHref()` (components/TelLink.tsx) chỉ strip whitespace — số lưu dạng
     chấm (VN landline `028.3822.1234`) lọt nguyên dấu chấm vào URI `tel:`,
     nhiều dialer từ chối. Đã harden: strip spaces + dots, giữ `+84`.
  2. SĐT liên hệ nhà máy trong modal "Chọn liên hệ để gọi" (call sheet) vẫn
     là text thuần — chỉ nút Gọi nhỏ bên phải là tappable. Theo REQ-14, số
     hiển thị giờ cũng là link `tel:` (cùng target với nút Gọi), surface
     read-only (FactoriesConfigPage) giữ nguyên text.

## Thay đổi

| File | Nội dung |
|---|---|
| `frontend/src/components/TelLink.tsx` | `telHref`: `replace(/[\s.]+/g,'')` — spaces/dots out, `+84` giữ nguyên |
| `frontend/src/components/shipment/OperationalSiteContactsList.tsx` | `callable`: số hiển thị → `TelLink` (class `site-contact-list__phone--tel`); non-callable giữ text thuần |
| `frontend/src/components/shipment/OperationalSiteContactsList.css` | Face house tel (brand #005A2D, weight 500, underline on hover); wrap/shrink rules cũ giữ nguyên qua class chung → không phá layout mobile |
| `frontend/src/components/TelLink.test.tsx` | MỚI — 7 unit: telHref (spaces/dots/+84/kết hợp/passthrough) + TelLink (href, aria-label) |
| `frontend/src/components/shipment/OperationalSiteContactsList.test.tsx` | +2: số là link normalized khi `callable`; read-only không có link chết |
| `frontend/src/pages/DriverTripDetailPage.test.tsx` | Cập nhật contract modal: mỗi row 2 link (số + nút Gọi), giữ aria-label Gọi |

Một owner fix ở helper dùng chung → mọi consumer (dòng SĐT kho, SĐT liên hệ,
bar Gọi kho, nút Gọi modal) đều hưởng chuẩn hóa spaces/dots.

## Gates

| Gate | Kết quả |
|---|---|
| `cd frontend && npx tsgo -b` | 0 lỗi |
| vitest scoped (TelLink + OperationalSiteContactsList + DriverTaskInfoSections) | 60/60 xanh |
| vitest consumer (Forwarder/TripDetail) | 9/9 xanh |
| vitest full frontend | 5372/5373 — 1 fail PRE-EXISTING: `dev-port-contract` (script qa lane fb033/fb093 hardcode 7176/7188; chứng minh bằng `git stash` chạy trên base — fail y hệt, không thuộc scope REQ-14) |
| `make build` | thành công (thỏa gate numeric-identity pin dist/assets → 6/6) |
| `pnpm lint` (root) | 0 lỗi |

## UI DRIVEN (rung 3) — evidence

Môi trường: local dev — frontend :7175 (worktree này), backend :3002, DB
ss-prod-db/silversea. Tài khoản DRIVER `quyet` / Abc123. Viewport 390×844
mobile. Scenario data là mutation QA cục bộ (đã ghi trong db-evidence.txt):
trip 85065 (CREATED) → fulfillment 65494 → containers trỏ site 441 "Kho Biển
Bạc - Đà Nẵng" (khoPhone 02253555555, 2 contacts — 1 số dạng chấm
0901.234.567 để chứng minh strip-dots ngoài UI thật).

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| Dòng SĐT kho = `<a href="tel:02253555555">` trong grid, 390px | UI DRIVEN | `ui-1-info-grid-tel-rows.png`; DOM assert trong `ui-driver.log`; DB row trong `db-evidence.txt` | iOS/Android webview thật (jsdom+Chrome desktop headless); dialer OS không mô phỏng được |
| Dòng SĐT liên hệ = `<a href="tel:0987654321">` | UI DRIVEN | như trên | như trên |
| Số trong modal là link; số chấm giữ text "0901.234.567" nhưng href `tel:0901234567` | UI DRIVEN | `ui-2-call-modal-tel-links.png` + DOM assert (numberText vs telHref) trong `ui-driver.log` | như trên |
| Nút Gọi giữ nguyên vị trí/aria-label (không phá layout) | UI DRIVEN | DOM assert goiHref trong `ui-driver.log`; so sánh 2 screenshot | pixel-diff tự động |
| telHref chuẩn hóa spaces/dots giữ +84 | UNIT | `TelLink.test.tsx` (vitest) | — |
| Surface read-only (config) không có link chết | UNIT | `OperationalSiteContactsList.test.tsx` | — |

Driver: `ui-drive.mjs` — exit 0, 13/13 PASS (log: `ui-driver.log`).

## Phạm vi không làm (explicit)

- Không đụng script qa lane khác (pre-existing port-contract fail).
- Không drive staging (staging chạy build cũ, không có thay đổi này; deploy
  cần lệnh owner).
