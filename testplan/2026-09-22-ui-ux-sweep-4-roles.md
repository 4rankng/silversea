# UI/UX visual sweep — 4 roles (chứng từ · điều vận · lái xe · OPS)

**Ngày:** 2026-09-22 · **Vai trò kiểm:** CUS (Nhân viên Chứng từ), DISPATCHER (Điều vận), DRIVER (Lái xe), OPS (Nhân viên vận hành)
**Môi trường:** local dev `http://localhost:7175` (API `:3002`, build HEAD `357b9ac7`) + staging `https://vantai.tingting.vip` (build `bf6e659a`)
**Tài khoản:** `cus`, `dieuvan`, `laixe`, `giaonhan` (local dev seed) · `thanhdc` (staging, CUS) — tất cả mật khẩu `Abc123`, nguồn [`testaccounts.txt`](testaccounts.txt)
**Bằng chứng:** `qa/2026-09-22_ui-ux-sweep-4roles/` (ảnh chụp đầy đủ 3 bề rộng + JSON đo DOM + `driver.log`) · báo cáo tổng hợp: `testplan/qa/evidence/2026-09-22_ui-ux-sweep-4roles/REPORT.md`

---

## 1. Phạm vi và phương pháp

Sweep **toàn bộ màn hình mà 4 vai trò nhìn thấy** (theo `frontend/src/components/Layout.tsx` `getNavItems()`), ở 3 bề rộng — desktop 1440×900, wide 1920×1080, mobile 390×844 — với 3 loại bằng chứng cho mỗi màn:

1. ảnh chụp **nguyên bố cục tại viewport** (đây là sự thật để đánh giá cắt/tràn);
2. ảnh chụp toàn bộ nội dung (khi khung ứng dụng cao hơn viewport) — chỉ để đọc nội dung, không dùng để kết luận bố cục;
3. **đo DOM tự động**: phần tử bị cắt ở mép khung cuộn, chữ bị cắt trong ô, **token bị bẻ giữa dòng** (đo bằng `Range.getClientRects`), header tràn khỏi ô / header đè nhau, cột chết (rộng > 100px mà mọi dòng đều trống), kích thước vùng bấm, tương phản màu, phần tử bị che (hit-test `elementFromPoint`), lỗi console/network.

Màn đã phủ (**29 màn** × 3 bề rộng):

| Vai trò | Màn |
|---|---|
| CUS | `/shipments`, `/shipments-detail`, `/shipments-debit`, `/shipments/new`, `/accounting/invoice-tracking`, `/accounting/deposit-tracker`*, `/recoverable-costs`*, `/config/customers`, `/config/routes`, `/config/fuel-price-periods` |
| DISPATCHER | `/dispatch`, `/dispatch-detail`, `/fleet/vehicles`, `/fleet/drivers`, `/suppliers`, `/config/customers`, `/config/routes` |
| DRIVER | `/my-trips`, `/notifications`, `/my-earnings`, `/my-penalties`, `/my-payslips`, `/my-trips/two-orders` |
| OPS | `/ops/orders`, `/ops/fleet-tracking`, `/ops/wallet`, `/my-orders`, `/my-advances`, `/my-settlements` |

\* hai màn này vai trò CUS không mở được (bị chuyển về `/shipments`) — xem `TC-UI-10`.

**Không nằm trong phạm vi (Not covered):** luồng có thao tác ghi (tạo lô, phát lệnh, khai chi phí, xác nhận POD) chỉ được quan sát ở trạng thái tĩnh; bàn phím/trình đọc màn hình; Safari/Firefox; màn hình < 360px; in ấn; 2560px; các trạng thái lỗi API (chỉ gặp trạng thái tải thành công).

---

## 2. Bộ case QA (chạy lại sau mỗi lần sửa)

Mỗi case dưới đây map 1-1 với một card trên board (`20260922_20` … `20260922_32`) và đã được ghi nhận **FAIL** trên build nêu ở trên.

| Case | Card | Màn / phạm vi | Quan sát hiện tại (FAIL) | Mong đợi |
|---|---|---|---|---|
| `TC-UI-01` | 20 | `/shipments` (local), `/shipments-detail` (staging) | Thanh phân trang dừng **giữa bảng**, đè lên dòng dữ liệu phía dưới; còn dòng vẽ tiếp bên dưới thanh | Thanh phân trang không che dòng nào; ở đáy khung cuộn hoặc cuối bảng |
| `TC-UI-02` | 21 | `/shipments-detail` (staging `bf6e659a`) | Cột `Thao tác` = **0px**; header bẻ 7 dòng mỗi dòng 1 ký tự; nút `＋ Thêm` 16×89, `Xóa` 16×57 | Cột ≥ 88px, header ≤ 2 dòng, nút ≥ 40px ngang và bấm được |
| `TC-UI-03` | 22 | `/config/customers`, `/config/routes`, `/fleet/drivers`, `/fleet/vehicles` | 6/12, 5/6, 7/10, 2 cột rỗng "—" trên mọi dòng trong khi cột tên bẻ 3–4 dòng | Cột rỗng toàn bộ tự ẩn; bề rộng chia theo nội dung |
| `TC-UI-04` | 23 | `/accounting/invoice-tracking` (+ customers, fleet, ledger) ở 1440px **và 390px** | Desktop: header tràn +49.6px/+38.2px đè lên nhãn bên cạnh; token bị bẻ (`QATU1234\|569`, `SHP-\|2609-\|00020`, `21/09/202\|6`, MST `0107654\|321`). Mobile 390: mỗi ô chỉ 24.9–36.9px ⇒ **mọi giá trị xếp dọc từng ký tự** (tên khách hàng cao 231px) | Không header nào tràn/đè; không token nào bị bẻ; mobile chuyển sang card hoặc cuộn ngang với cột ≥ 88px |
| `TC-UI-05` | 24 | `/shipments-detail`, `/shipments` mobile | `Chờ phân xe` hiện ở 2 cột cùng dòng; badge chung "Thiếu dữ liệu" cả khi dòng đã điều xe/hoàn thành; icon xe tải lặp 2 lần | Một khái niệm một chỗ hiện; cảnh báo nêu đúng trường thiếu; không icon lặp |
| `TC-UI-06` | 25 | `/shipments`, `/shipments-detail`, `/shipments-debit` | Chữ trạng thái trống tương phản **1.88:1** (cần ≥ 4.5:1) | Mọi chữ đạt ≥ 4.5:1 |
| `TC-UI-07` | 26 | `/config/routes`, `/config/customers`, `/fleet/*`, `/suppliers`, `/shipments*`, `/dispatch-detail` | Nút sắp xếp trong header chỉ cao **14.8px**; chỉ báo là ký tự `⇅` ~10px lệch dòng, có cột có cột không | Vùng bấm ≥ 24×24px; icon ≥ 12px cùng dòng nhãn + trạng thái tăng/giảm rõ |
| `TC-UI-08` | 27 | `/dispatch-detail`, `/ops/orders`, `/ops/wallet`, `/my-orders` | Pill cho cả giá trị trống/phân loại; KPI "Chi phí đã ghi nhận" tô xanh success | Pill chỉ cho trạng thái; màu đúng ngữ nghĩa |
| `TC-UI-09` | 28 | `/fleet/drivers`, `/fleet/vehicles`, `/suppliers` | `71người`, `19xe`, `14NCC` — số dính đơn vị | Có khoảng cách số ↔ đơn vị |
| `TC-UI-10` | 29 | sidebar CUS → `/accounting/deposit-tracker` | Mục nav hiện nhưng CUS bị đá về `/shipments` (`landed=/shipments`) | Nav và route guard cùng nguồn quyền |
| `TC-UI-11` | 30 | `/my-trips` (1440px), `/my-trips/two-orders` | Trang trống ~75% ở desktop; route "hai lệnh" không có lối vào nào | Bố cục desktop dùng hết không gian; không route mồ côi |
| `TC-UI-12` | 31 | `/shipments-debit`, `/shipments/new` | Trạng thái trống tự chế; 3 kiểu điều khiển chọn; trường bắt buộc bị mờ không giải thích | Dùng `EmptyState` chung; một quy ước điều khiển; nêu lý do khoá |
| `TC-UI-13` | 32 | `/dispatch-detail` (điều vận) | Topbar ghi "Tháng 8/2026 · 01/08–31/08" (sau click chuột thật) nhưng bảng vẫn 50 dòng 02/03/2026 → 10/08/2026; đổi tháng **không** đổi dữ liệu | Đổi tháng ⇒ dữ liệu đổi, hoặc bộ chọn tháng không hiển thị ở màn này |

### Cách chạy một case

1. `make dev` (Postgres `:5441`, backend `:3002`, frontend `:7175`).
2. Đăng nhập đúng vai trò (mục đầu file) tại `http://localhost:7175`.
3. Mở màn theo cột "Màn / phạm vi", đặt bề rộng cửa sổ theo case (mặc định 1440; case `TC-UI-02` chạy thêm 1568 trên **staging**).
4. Đối chiếu cột "Mong đợi"; ghi ảnh vào `qa/<ngày>_<scope>_ui-<bước>.png` và lưu log driver.
5. Case UI: **bắt buộc** chụp ảnh sau thao tác thật (chuột thật) + ghi lại trạng thái DOM; không kết luận bằng cách đọc mã.

---

## 3. Ma trận trạng thái đã chụp (state matrix)

`qa/2026-09-22_ui-ux-sweep-4roles/screens/{desktop,wide,mobile}/` — mỗi màn có ảnh viewport; màn có nội dung dài hơn khung cuộn có thêm ảnh `.full.png`.

- `desktop` 1440×900: 44 ảnh (29 ảnh viewport + 15 ảnh toàn nội dung) · `wide` 1920×1080: 42 ảnh (29+13) · `mobile` 390×844: 47 ảnh (29+18) — tổng 133 ảnh, 87 ảnh viewport.
- Trạng thái đã chụp: có dữ liệu (CUS/DISPATCHER/OPS) và trạng thái trống (DRIVER hôm nay không có lệnh). **Chưa chụp**: trạng thái lỗi API, trạng thái đang tải (skeleton), hộp thoại đang mở.
- Lỗi console/network: **0** trên toàn bộ 87 lượt chụp viewport. `reqFail=1` mỗi màn là `GET /api/auth/me` bị huỷ khi điều hướng sang màn kế — không phải lỗi ứng dụng.

---

## 4. Ghi chú về công cụ đo

`qa/scripts/ui-sweep-4roles-20260922.mjs` (chụp + đo) và `qa/scripts/ui-sweep-digest-20260922.mjs` (tổng hợp). Bộ đo đã phải lọc hai loại dương tính giả trước khi dùng số liệu:

- phần tử nằm ngoài màn (drawer sidebar ẩn, phần tử dưới màn) → hit-test `elementFromPoint` + bỏ qua phần tử ngoài dải viewport;
- nội dung trong `<details>` đã đóng (khung cao 0) → cùng cách lọc.

Số liệu dùng trong các card là số **sau khi lọc**, và mọi kết luận vẫn được đối chiếu bằng ảnh chụp (một ảnh mâu thuẫn với kết luận ⇒ card FAIL).

Dương tính giả đã gặp và xử lý:

- `clippedByViewport` trên mobile từng báo 47–48 phần tử — đó là **drawer sidebar nằm ngoài màn**; sau khi thêm bộ lọc hit-test, lần chạy lại mobile trả **0**. Số liệu trong `probe/mobile/` là số sau lọc.
- `overlappingText` trên mobile (`/ops/wallet` = 9, `/config/customers` ≈ 3690) là các phần tử nằm trong khối đã bị cắt (`<details>` đóng, bảng desktop còn trong DOM) mà bộ lọc hit-test chưa loại được, vì điểm đo rơi vào **phần tử cha**. Ảnh chụp mobile của cả hai màn sạch ⇒ **không** ghi thành lỗi. Cách ly: chỉ nhận là “đang hiển thị” khi điểm hit-test trả về chính phần tử đó hoặc con của nó; sửa tiếp trong harness nếu cần chạy lại sweep.
- Chữ `sr-only` (1×1px) bị loại khỏi mọi phép đo “chữ bị cắt”.
