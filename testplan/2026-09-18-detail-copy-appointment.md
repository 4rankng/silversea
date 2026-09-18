# Copy ngày giờ đóng trả trên trang "Chi tiết lô hàng" (2026-09-18)

## Nguyên nhân và phạm vi

Yêu cầu khách (chuyển qua Kiên, 2026-09-18):

> "những lô cus nhập chưa có lịch sau - sau vào bổ sung lịch giao có cách nào
> nhập ngày giao 1 lần cho tất cả các cont k a nhỉ trường hợp lô nhiều cont mà
> giao cùng 1 ngày lại phải nhập ngày giao đủ số lượng"

Khách chỉ đích danh **phần chi tiết của từng lô** (nút "Chi tiết" ở Tổng quan lô
hàng), không phải màn thêm mới lô hàng.

Trạng thái trước khi sửa (đã kiểm bằng bundle đang chạy của staging):

| Màn | Nút copy |
| --- | --- |
| `/shipments/new` (form tạo lô) | có (`csc-container-row__copy`) |
| Sổ container trong drawer "Chi tiết" (`/shipments`) | có (`cus-container-row__copy`) |
| Trang nav **"Chi tiết lô hàng"** (`/shipments-detail`) | **không có** |

Trên `/shipments-detail` mỗi container là một phiên chỉnh sửa riêng (mở popover
→ Lưu), nên lô N cont giao cùng ngày phải nhập N lần — đúng ca khách phàn nàn.
Case này đưa affordance copy của form tạo lô vào đúng trang đó: một dòng đã có
giờ hẹn có thể copy sang **các container còn trống của cùng lô**, và ghi thẳng
xuống server (trang này không có phiên nháp chung để "Lưu tất cả").

Ràng buộc giữ nguyên từ bản tham chiếu `/shipments/new`:

- Chỉ điền vào container **thật sự trống** — không bao giờ ghi đè lịch đã có.
- Chỉ điền container **cùng lô** với dòng nguồn.
- Icon **không che dữ liệu** (ruling 2026-09-18) và không phủ lên ô lịch trình.
- Không đổi API, schema, quyền hay luồng lưu hiện có: đường ghi vẫn là
  `POST /shipments/cus-workspace/:id/containers/:containerId` với
  `Idempotency-Key` + `expectedShipmentVersion` như mọi lần sửa lịch trình.

Hai điểm **cố ý khác** bản tham chiếu, vì đây là bảng container liên lô:

1. **Affordance theo dòng nguồn, không theo số dòng trống nhìn thấy.** Form tạo
   lô và sổ CUS luôn hiển thị trọn lô nên điều kiện "còn ≥ 2 dòng trống" là tín
   hiệu đầy đủ; ở `/shipments-detail`, bộ lọc container/ngày và phân trang có
   thể giấu các container khác của cùng lô, nên đếm trên màn hình sẽ **ẩn mất
   tính năng đúng lúc khách cần**. Icon hiện khi dòng có giờ hẹn và trường giờ
   hẹn còn quyền ghi.
2. **Đích ghi lấy từ chính lô** (`GET /shipments/cus-workspace/:id`), không lấy
   từ các dòng đang hiển thị — đúng câu "nhập 1 lần cho **tất cả** các cont".
   Nhờ vậy copy không phụ thuộc bộ lọc/phân trang. Nếu lô không còn container
   trống, hệ thống báo rõ và không ghi gì.

## Bộ case

### TC-COPY-DETAIL-01 — Vị trí và điều kiện hiện icon

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/shipments-detail`, tìm lô có 1 cont đã có giờ hẹn (còn quyền sửa).
  2. Hover dòng đã có giờ hẹn; sau đó hover một dòng chưa có giờ hẹn và một dòng
     có giờ hẹn nhưng `customerAppointmentEditable = false`.
  3. Soi ô `Khách hàng & lộ trình` và ô `Lịch trình` của dòng đầu.
- **Kết quả mong đợi (Pass):** icon copy là nút chữ nhật bo góc nằm ở mép phải ô
  danh tính (Khách hàng & lộ trình); chữ của ô danh tính không nằm dưới icon
  (có gutter dành riêng); ô `Lịch trình` không bị phủ, vẫn bấm mở popover được;
  hai dòng còn lại không hiện icon.
- **Kỳ vọng sai (Fail nếu):** icon nằm đè lên ô lịch trình/giá trị ngày giờ, che
  chữ khách hàng/nhà máy/tuyến, hoặc hiện trên dòng không sửa được.

### TC-COPY-DETAIL-02 — Copy đúng phạm vi và ghi thẳng server

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Với lô ở TC-COPY-DETAIL-01 (trang đang hiển thị lẫn container của lô khác),
     bấm icon.
  2. Quan sát notice đầu trang và các dòng sau khi bảng tải lại.
  3. Kiểm tra API: `GET /shipments/cus-workspace/:id` của lô nguồn và của lô khác.
- **Kết quả mong đợi (Pass):** **mọi** container trống của lô nguồn (kể cả cont
  không hiện trên trang vì bộ lọc/phân trang) nhận đúng giờ hẹn của dòng nguồn;
  container của lô khác **không đổi**; notice ghi đúng số lượng đã copy; dữ liệu
  nằm trong DB ngay (không cần mở từng dòng).
- **Kỳ vọng sai (Fail nếu):** ghi sang lô khác, hoặc chỉ đổi trên UI mà không lưu,
  hoặc số lượng trong notice sai.

### TC-COPY-DETAIL-03 — Không ghi đè, không vượt quyền

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Chuẩn bị lô: dòng nguồn có lịch, 2 dòng trống, 1 dòng đã có lịch **khác ngày**.
  2. Bấm icon copy.
  3. Lặp lại với lô có dòng trống nhưng `customerAppointmentEditable = false`.
- **Kết quả mong đợi (Pass):** dòng đã có lịch giữ nguyên giá trị; dòng bị khóa
  quyền không bị điền và không xuất hiện trong số lượng copy; không có request
  nào gửi cho dòng không được phép.
- **Kỳ vọng sai (Fail nếu):** ghi đè lịch đã có, hoặc gửi request cho dòng khóa quyền.

### TC-COPY-DETAIL-04 — Bàn phím và màn hình cảm ứng

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Tab vào dòng có giờ hẹn (focus-within), Tab tiếp tới icon, nhấn Enter.
  2. Ở 390px (hoặc pointer coarse), mở trang không hover.
- **Kết quả mong đợi (Pass):** icon hiện khi focus-within và Tab tới được, Enter
  kích hoạt copy; màn hình hẹp/cảm ứng icon luôn hiện.
- **Kỳ vọng sai (Fail nếu):** icon chỉ có bằng hover chuột, Tab bỏ qua.

### TC-COPY-DETAIL-05 — Xung đột phiên bản

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P1
- **Các bước:**
  1. Mở trang, sau đó đổi `customerAppointmentAt` của lô bằng một phiên khác
     (API) để `shipmentVersion` vượt bản đang hiển thị.
  2. Bấm icon copy trên bản cũ.
- **Kết quả mong đợi (Pass):** copy dừng, bảng tải lại bản mới nhất, thông báo
  dữ liệu vừa thay đổi và **không** ghi đè mù; bấm lại sau khi tải lại thì thành công.
- **Kỳ vọng sai (Fail nếu):** im lặng bỏ qua lỗi, hoặc ghi đè dữ liệu mới hơn.

### TC-COPY-DETAIL-06 — Lô không còn container trống

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P1
- **Các bước:** với lô đã điền lịch cho **mọi** container, bấm icon copy ở một dòng.
- **Kết quả mong đợi (Pass):** không có request ghi nào; notice nói rõ lô không
  còn container nào cần copy giờ hẹn; dữ liệu hiện có giữ nguyên.
- **Kỳ vọng sai (Fail nếu):** ghi đè lịch đã có, hoặc im lặng không phản hồi.

## Ghi chú thực thi

- Test đơn vị: `frontend/src/features/shipments/cus/use-cus-detail.copy-appointment.test.tsx`
  (đường ghi, thứ tự phiên bản, notice) và
  `frontend/src/pages/ShipmentContainersPage.copy-appointment.test.tsx`
  (hiện/ẩn icon, vị trí ô, không hiện khi đang mở phiên sửa).
- Ngữ nghĩa copy của hai surface cũ giữ nguyên:
  `ShipmentCreateWorkspace.copy-appointment.test.tsx`,
  `CusContainerLedger.copy-appointment.test.tsx`.
- Kết quả chạy ghi ở `qa/` và điền vào bảng dưới.

## Kết quả chạy (local dev, 2026-09-18)

Driver (tracked, chạy lại được): `testplan/qa/scripts/ui-detail-copy-20260918.mjs`
→ ảnh + `qa/2026-09-18-detail-copy/ui-driver.log`. Lô QA `41987`, tài khoản
`thanhdc` (CUS), nguồn `QATU9732531` = `09:00 19/09/2026`, hai đích
`QATU9732608` + `QATU9732660` để trống; trang được lọc về **đúng container
nguồn** nên hai đích không hề hiện trên màn hình.

| Case | Rung | Bằng chứng |
| --- | --- | --- |
| TC-COPY-DETAIL-01 | UI DRIVEN | `qa/2026-09-18-detail-copy/2026-09-18T04-45-21-819Z_01-before-click.png`, `…_02-hover.png` + `ui-driver.log`: icon nằm trong `th[data-label="Khách hàng & lộ trình"]`, `gutter=30px`, `overlapsText=[]` (đo theo glyph, không theo hộp block), `scheduleTriggerHit=true`; hover → `visibility: visible` |
| TC-COPY-DETAIL-02 | UI DRIVEN | `…_03-after-click.png` + log: notice `Đã copy ngày giờ đóng trả sang 2 container chưa có lịch.`; `GET /shipments/cus-workspace/41987` sau click: cả 27700/27701/27702 = `2026-09-19T02:00:00.000Z` — hai cont đích **không hiện trên trang** vẫn được ghi, container lô khác không đổi |
| TC-COPY-DETAIL-03 | Unit | `use-cus-detail.copy-appointment.test.tsx` (4 ca): chỉ ghi container trống + còn quyền của **cùng lô**; container đã có lịch và container read-only không phát sinh request; version nối tiếp từ response (nếu không sẽ 409 chính mình) |
| TC-COPY-DETAIL-04 | UI DRIVEN + Unit | log `hover-visibility "visible"`; unit test: nút `disabled` khi đang copy, icon ẩn khi có phiên chỉnh sửa mở; `ShipmentContainersPage.styles.test.ts` khoá luật `:focus-visible`, `tr:hover/focus-within` và `≤640px`/`pointer: coarse` |
| TC-COPY-DETAIL-05 | Unit | `use-cus-detail.copy-appointment.test.tsx`: 409 giữa batch → dừng, tải lại bảng, thông báo `…sau 1/2 container…`; không ghi đè mù |
| TC-COPY-DETAIL-06 | UI DRIVEN | `…_04-fully-dated.png` + log: bấm lần hai → notice `Lô này không còn container nào cần copy giờ hẹn.`; DB sau lần bấm thứ hai không đổi |

Gates đã chạy cho thay đổi này: `pnpm lint` (0 error), `cd frontend && npx tsc -b`,
`cd frontend && pnpm test` (toàn bộ), `make build`. Thay đổi thuần frontend —
không đụng API, schema, RBAC hay `shared/src/calculations` nên không cần E2E.

### Khác biệt có chủ đích so với bản tham chiếu (đã chốt với user 2026-09-18)

- Icon hiện theo **dòng nguồn** (có giờ hẹn + còn quyền ghi), không theo số dòng
  trống nhìn thấy — xem mục "Hai điểm cố ý khác" ở trên.
- Đích ghi lấy từ **lô**, không từ trang: chứng minh bằng TC-COPY-DETAIL-02 (hai
  container đích không được liệt kê mà vẫn nhận lịch).
