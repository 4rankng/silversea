# Copy ngày giờ đóng trả — vị trí và hình dạng (ruling 2026-09-18)

## Nguyên nhân và phạm vi

Tính năng "copy một giờ hẹn sang mọi container chưa có lịch" (landing
`88906f39` cho sổ container CUS, `a5645f42` cho form tạo lô) render nút Copy
như một **lớp phủ (overlay) absolute đè lên chính ô ngày giờ** của dòng nguồn:
`.csc-appointment-copy` phủ lên `top:0; left:0` của editor ngày/giờ, còn
`.cus-appointment-copy` nằm giữa lề phải ô giờ hẹn. Hệ quả: khi hover đúng
dòng đang có lịch, nút xanh bo tròn che mất giá trị `HH:mm` / `DD/MM/YYYY` mà
người dùng cần đối chiếu trước khi copy — đúng dòng người dùng đang nhìn.

Ruling của user 2026-09-18 (nguyên văn):

> the copy button should not long like cucubmer, can make it same shape as the
> input component of the time input, actually i think we can have the copy icon
> at the STT cell once mouse hover

Phạm vi sửa: chỉ vị trí/hình dạng của affordance. Ngữ nghĩa copy (chỉ điền
vào dòng thật sự trống, giữ nháp giờ/ngày dở dang, số lượng đích, toast, đường
lưu) **không đổi**. Không đổi API, schema, quyền, hay luồng lưu.

## Bộ case

### TC-COPY-PLACE-01 — Form tạo lô: icon copy nằm ở ô STT

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/shipments/new`, bấm `Thêm container` hai lần (3 dòng).
  2. Nhập ngày giờ đóng trả cho dòng 1 (ví dụ `09:00` `20/09/2026`).
  3. Hover lên dòng 1.
  4. Quan sát ô STT và ô `NGÀY GIỜ ĐÓNG TRÀ`.
- **Kết quả mong đợi (Pass):** ô STT hiện **một nút icon hình chữ nhật bo góc 8px**
  (cùng dáng với input giờ/ngày của dòng: viền 1px, nền trắng), căn giữa ô STT;
  hai ô `HH:mm` và `DD/MM/YYYY` của dòng **không bị che**, giá trị đọc được đầy đủ.
- **Kỳ vọng sai (Fail nếu):** còn nút chữ "Copy" dạng viên thuốc phủ lên ô giờ
  hoặc ô ngày; hoặc giá trị ngày/giờ bị lớp phủ che khi hover.
- **Bằng chứng:** ảnh hover ở 1440px trước/sau khi sửa.

### TC-COPY-PLACE-02 — Sổ container CUS: icon copy nằm ở ô danh tính container

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/shipments-detail` của một lô nhiều cont, tab container.
  2. Đưa một dòng có giờ hẹn, ít nhất hai dòng khác chưa có.
  3. Hover dòng có giờ hẹn; quan sát ô danh tính (số thứ tự + số container)
     và ô `Giờ hẹn đóng/trả`.
- **Kết quả mong đợi (Pass):** icon copy nằm trong ô danh tính (lề phải), cùng
  dáng chữ nhật bo góc với các control trong dòng; nút trigger giờ hẹn **không
  bị phủ**, vẫn đọc được `HH:mm DD/MM/YYYY` và vẫn mở được popover.
- **Kỳ vọng sai (Fail nếu):** nút "Copy" còn đè lên trigger giờ hẹn.
- **Bằng chứng:** ảnh hover 1440px.

### TC-COPY-PLACE-03 — Bàn phím và màn hình cảm ứng

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Ở cả hai surface, Tab vào dòng có giờ hẹn (focus-within).
  2. Ở 390px (hoặc thiết bị cảm ứng), mở form không hover.
- **Kết quả mong đợi (Pass):** focus-within làm icon hiện ra và Tab tới được
  icon, Enter kích hoạt copy (không còn nút ẩn bị Tab bỏ qua); ở màn hình hẹp/
  cảm ứng icon luôn hiện.
- **Kỳ vọng sai (Fail nếu):** icon chỉ hiện bằng hover chuột, Tab không tới được.
- **Bằng chứng:** log bàn phím + ảnh 390px.

### TC-COPY-PLACE-04 — Ngữ nghĩa copy không đổi

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Với 1 dòng đã có giờ hẹn + 2 dòng trống: hover icon, bấm.
  2. Lặp lại khi một dòng đích có nháp giờ dở dang (`14:`) hoặc nháp ngày dở
     dang (`20/09`), và khi chỉ còn **một** dòng trống.
- **Kết quả mong đợi (Pass):** chỉ dòng thật sự trống được điền; nháp dở dang
  giữ nguyên; số lượng trong toast khớp số dòng đã điền; ít hơn hai dòng trống
  thì không hiện affordance.
- **Kỳ vọng sai (Fail nếu):** ghi đè nháp dở dang, hoặc sai số lượng.
- **Bằng chứng:** test đơn vị hiện có + log UI.

## Ghi chú thực thi

- `SIS-ROLE-07` (audit sisprod) giữ nguyên hiệu lực cho phần bàn phím/cảm ứng;
  case đó được đọc cùng bộ này.
- Ngữ nghĩa copy đã có test riêng:
  `ShipmentCreateWorkspace.copy-appointment.test.tsx`,
  `CusContainerLedger.copy-appointment.test.tsx`.

## Kết quả chạy (local dev, 2026-09-18)

Driver scripts (tracked, chạy lại được):
`testplan/qa/scripts/ui-copy-icon-create-20260918.mjs`,
`testplan/qa/scripts/ui-copy-icon-ledger-20260918.mjs`.

| Case | Rung | Bằng chứng |
| --- | --- | --- |
| TC-COPY-PLACE-01 | UI DRIVEN | `qa/2026-09-18T01-58-29-171Z_copy-icon-hover.png` + `_ui-driver.log`: icon 26×26 radius 8 viền 1px nằm trong `th.csc-container-row__index`, `elementFromPoint` tại tâm ô giờ **và** ô ngày trả về chính input đó (không bị che); sau khi bấm: 3/3 dòng nhận `20/09/2026 09:00` |
| TC-COPY-PLACE-02 | UI DRIVEN | `qa/2026-09-18T02-12-46-329Z_ledger-copy-icon-clip.png` + `_ui-driver.log`: icon 20×20 nằm trong `th.cus-container-cell--identity`, `copyOverlapsGlyphs=false`, `copyOverlapsTrigger=false`, số container `QATU9732531` vẫn một dòng; bấm → 3/3 trigger đổi sang `04:02 19/09/2026` |
| TC-COPY-PLACE-03 | UI DRIVEN | `qa/2026-09-18-copy-icon-ledger/03-keyboard-focus-within-1440.png`, `04-mobile-390-no-hover.png`: focus-within hiện icon và Tab tới được; 390px icon luôn hiện |
| TC-COPY-PLACE-04 | Unit | 9/9 (`ShipmentCreateWorkspace.copy-appointment`, `CusContainerLedger.copy-appointment`) — thêm 2 assertion vị trí, **đỏ trước khi sửa** (2 failed | 7 passed), xanh sau khi sửa |

### Defect phát hiện trong lúc kiểm (đã sửa)

`COPY-PLACE-02-D1` — bản đầu đặt icon ở **mép phải** ô danh tính concontainer:
hover làm icon che đuôi số container (`QATU9732531` → `QATU9732[icon]`), đúng
lỗi "che dữ liệu" mà ruling muốn bỏ. Sửa: icon vào **đúng slot số thứ tự**
(`left: 0`, 20×20, thu nhỏ để không tràn vào track số container) và ẩn số thứ
tự khi hover — đúng luật "thay giá trị STT bằng icon". Không mở rộng track
`auto` (track rộng hơn làm số container 11 ký tự xuống hai dòng).

