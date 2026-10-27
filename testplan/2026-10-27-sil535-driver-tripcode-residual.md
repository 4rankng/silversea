# SIL-535 — app lái xe: mã chuyến nội bộ vẫn lọt ra (residual leak sau card 261022201006c)

Case ID: REG-SIL535-TRPCODE-RESIDUAL
Opened: 2026-10-27 · Board: SIL-535 (id 598) · Lane: fix-sil535-trpcode
Ruling: PRD `docs/prd/ManHinhLaiXe.md` §3.1 (card 261022201006c, 22/10) — "Mã
chuyến KHÔNG hiển thị trên app lái xe — danh sách lẫn chi tiết lệnh. Bill/Booking
là định danh chính; chuỗi mã thô (`TRP-…`, `SHP-…`) không hiển thị. Field mã
giữ nguyên ở DB và API payload."

## Surface

Driver app (`/my-trips`, `/my-trips/two-orders`, `/my-trips/:id`, `/my-trips/:id/pod`,
`/notifications` + NotificationBell). Driver role only.

## Context — card 261022201006c đã sửa thẻ lệnh, nhưng còn 2 khe

`6a633ed6` (22/10) gỡ dòng "Mã chuyến" khỏi thẻ lệnh + lưới chi tiết, và
`56f0a775` (27/10) xác minh thẻ lệnh sạch. Sweep toàn driver surface của lane
này tìm ra 2 khe CÒNG thuộc ruling (chuỗi mã thô lọt lên màn lái xe):

### Khe A — copy thông báo (bell + /notifications)

`frontend/src/lib/notificationText.ts` strip bằng regex `/\s*TRP-\d{6}-\d+\s*/g`
→ chỉ khớp shape chuẩn `TRP-YYYYMM-NNNN`. Backend ghép message thô từ
`trip.tripCode` (`trip-command.service.ts:62`, `dispatch-planning-utils.service.ts:471`,
`adjustment-governance.service.ts:532,593`), và DB có nhiều shape khác
(audit 21/10 `testplan/2026-10-21-req07-tripcode.md`: `TRP-YYYY-MM-NNNN` từ
`seed-dashboard.ts`, legacy `TRP-C12-53-…`, `CN-…`, `BULK-TR-…`). Shape nào
không khớp regex lọt NGUYÊN VĂN vào copy driver đọc được.

### Khe B — tên tệp e-POD

`backend/src/seed/seed-trips.ts:550` đặt tên tệp seed = `${trip.tripCode}-${fileType}`
→ "TRP-202609-0001-YARD_OR_DROP_RECEIPT.pdf". `TripPodSubmission.tsx` render
`file.originalFileName` thẳng vào text + `aria-label` + `alt` + tên file tải
xuống (`link.download`) → mã nội bộ lọt lên màn lái xe.

## Reproduction (đo local 2026-10-27, driver `dvthuc`, qa/2026-10-27_sil535-trpcode/)

### A — copy thông báo

1. Có notification driver-targeted với message chứa mã shape legacy, ví dụ
   `Chuyến TRP-C12-53-1791212851260-gvr4vb đã được điều xe`.
2. Driver mở `/notifications` (hoặc bell dropdown).

**Actual (trước fix):** mã `TRP-C12-53-1791212851260-gvr4vb` hiện nguyên văn
trong copy thông báo. Đo: `dom-driver-before-notif.json` → `/notifications`
codes=["TRP-C12-53-1791212851260-gvr4vb"].

### B — tên tệp e-POD

1. Tệp e-POD lưu với tên chứa mã (shape seed): `TRP-202609-0001-YARD_OR_DROP_RECEIPT.pdf`.
2. Driver mở `/my-trips/3/pod` (chứng từ đã nộp).

**Actual (trước fix):** tên tệp hiện nguyên văn kèm mã. Đo:
`dom-driver-before.json` → `/my-trips/3/pod`
codes=["TRP-202609-0001-YARD_OR_DROP_RECEIPT.pdf"].

## Expected

- Không màn lái xe nào hiện chuỗi mã thô (`TRP-…`, `SHP-…`, `CN-…`, `BULK-TR-…`)
  hay nhãn "Mã chuyến" — ở thẻ lệnh, chi tiết, e-POD, thông báo.
- Số Bill/Booking vẫn là định danh hiển thị chính (không đổi).
- Copy thông báo và tên tệp e-POD vẫn đọc được (không rỗng, không mất nghĩa).
- DB + API payload giữ nguyên field mã (chỉ hiển thị được làm sạch).

## Fix (shared owner)

`frontend/src/lib/internalCode.ts` (mới) — owner DUY NHẤT của "chuỗi này là mã
nội bộ": nhận diện mọi shape (SHP/TRP/TRIP/BULK-TR/DSP/GBN + legacy `CN-`
shape có nhóm dash-digit), strip khỏi prose, và strip mã đầu tiên khỏi tên
tệp. `notificationText.ts` + `TripPodSubmission.tsx` + `DriverTripPodPage.tsx`
dùng chung owner này. `CN-` có thật là mã hay chỉ là "Lô CN-09" trong địa
chỉ → phân biệt bằng nhóm dash-digit (mã luôn có, địa chỉ không).

## Cases

### SIL535R-01 — copy thông báo không lộ mã (mọi shape)
1. Notification driver-targeted với message chứa mã shape chuẩn / seeded /
   legacy / bulk / container / shipment code.
2. Driver mở `/notifications`.

**Expected:** copy hiện "Chuyến đã được điều xe" — không còn chuỗi mã. Số
Bill/Booking và địa chỉ "Lô CN-09" trong copy được giữ nguyên.

### SIL535R-02 — tên tệp e-POD không lộ mã
1. Tệp lưu tên `TRP-202609-0001-YARD_OR_DROP_RECEIPT.pdf`.
2. Driver mở `/my-trips/:id/pod`.

**Expected:** tên hiện "YARD_OR_DROP_RECEIPT.pdf" (giữ phần chứng t),
`aria-label`/`alt`/tên file tải xuống cũng sạch. Tệp driver tự tải lên
("IMG_7804.jpeg") hiện nguyên vẹn.

### SIL535R-03 — thẻ lệnh + chi tiết vẫn sạch (không regression)
1. Driver mở `/my-trips`, `/my-trips/:id`, `/my-trips/two-orders`, `/my-penalties`.

**Expected:** không "Mã chuyến", không chuỗi mã; Bill/Booking vẫn dẫn đầu.

### SIL535R-04 — desktop/điều phối/kế toán giữ nguyên hiển thị mã
Các bảng desktop (Kế hoạch, Điều phối, Kế toán) vẫn hiện mã chuyến như trước —
lane này KHÔNG đụng các bảng đó.

## Gates

- `frontend/src/lib/internalCode.test.ts` (mới, 15 case) — owner: mọi shape,
  kể cả "Lô CN-09" không bị ăn.
- `frontend/src/pages/NotificationsPage.test.tsx` — +2 case (mọi shape; giữ
  Bill/Booking + địa chỉ).
- `frontend/src/components/trip/TripPodSubmission.test.tsx` — +1 case (tên tệp
  không lộ mã, label còn, DOM sạch).
- `frontend/src/components/trip/TripPodSubmission.file-name-wrap.styles.test.ts` —
  pin cập nhật: span render tên ĐÃ LÀM SẠCH (không còn render thẳng
  `file.originalFileName`), vẫn không truncate/ellipsis/title.
- UI DRIVEN @390px: `qa/2026-10-27_sil535-trpcode/` — before/after trên
  `/notifications` + `/my-trips/:id/pod`, probe script
  `qa/2026-10-27_sil535-trpcode/driver-trpcode-probe.mjs`.

## Status

FIXED (chưa deploy). Khe A + Khe B đã vá; gates xanh; UI DRIVEN before/after
xanh. Màn desktop/điều phối/kế toán không đổi.
