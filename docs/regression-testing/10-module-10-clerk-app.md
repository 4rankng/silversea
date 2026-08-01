# M10 — Ứng dụng nhân viên chứng từ (Document Clerk App)

> **Phân hệ 10** — 3 nhóm chức năng (10.1–10.3). Nguồn PRD: `docs/prd/Module10.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M10-HT-01` … `M10-HT-10` (xem `00-cross-cutting.md`).
>
> **Đây là ứng dụng MOBILE của nhân viên chứng từ (CLERK).** Phần lớn thao tác xảy ra ngoài giờ, trên điện
> thoại → **mặc định thử trên DevTools Device Toolbar, iPhone SE 375×667** (xem TC-HT-07). Chỉ dùng Desktop
> cho ca kiểm soát quyền và đối chiếu danh sách văn phòng.
>
> **Màn hình chính (clerk portal):**
> - `/clerk/shipments/new` — tạo nhanh lô nháp (M10.1).
> - `/clerk/shipments/:id/docs` — nhập số vận đơn (B/L), công-te-nơ, niêm phong, readiness (M10.2).
> - `/shipments` — danh sách lô (góc nhìn văn phòng).
> - `/shipments/:id` — chi tiết lô.
>
> **Vai trò thử:** `CLERK` (nhân viên chứng từ, label tiếng Việt "Chứng từ"). **Lưu ý quan trọng:** trong
> seed hiện **chưa có tài khoản demo CLERK riêng** → dùng `admin` cho hầu hết ca (admin được phép vào clerk
> portal — xem `clerkOrAdminOnly` trong `frontend/src/App.tsx:134`). Khi cần xác minh CLERK không thấy nút
> "Điều vận", tạo một user CLERK tạm ở `/users` rồi đăng nhập lại. Ghi rõ lựa chọn này vào cột "Ghi chú".
>
> **Ngoại lệ cho bộ visual xuyên suốt mới:** khi chạy
> [`13-customer-service-finance-visual-workflow.md`](./13-customer-service-finance-visual-workflow.md),
> bắt buộc dùng tài khoản có role `CLERK` thật; không dùng `admin` làm đại diện vì bộ đó kiểm tra cả menu,
> row-scope và quyền âm của CUS.

---

## 10.1 — Tạo nhanh lô hàng ngoài giờ trên điện thoại

**Quy tắc nghiệp vụ (PRD M10-01):** Cho phép tạo bản nháp với dữ liệu tối thiểu (chỉ `customerId` là bắt
buộc ở backend `quickCreateShipmentSchema`); mã lô (`shipmentCode`) là duy nhất; ghi người tạo và thời
điểm. Lô mới hiện ngay trong danh sách của người tạo và của điều vận với trạng thái phù hợp. Mất kết nối →
báo rõ chưa lưu; gửi lại không tạo bản trùng (idempotency qua header `Idempotency-Key`).

> **Phụ thuộc Q17** (phạm vi vai trò CLERK) — xác nhận CLERK được phép tạo/sửa lô nhưng không được điều vận.

### TC-M10-01-01 — Tạo lô nháp thành công trên mobile (luồng thường)

- **Mã PRD:** M10-01-01
- **Vai trò:** `admin` (đại diện CLERK — chưa có tài khoản demo CLERK)
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** đã có ít nhất 1 khách hàng active trong `/customers` (không bị soft-delete).
- **Các bước:**
  1. Đăng nhập `admin`. DevTools → Device Toolbar → iPhone SE (375×667).
  2. Mở trực tiếp `/clerk/shipments/new`.
  3. Chọn "Khách hàng". Gõ "Số booking" = `COSU-TEST-01`. Để trống các trường còn lại.
  4. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Form một cột, nút "Tạo lô hàng" cao ≥ 44px, không bị keyboard che.
  - Sau bấm → chuyển sang `/clerk/shipments/:id/docs` (hồ sơ chứng từ đúng phạm vi CLERK).
  - Trạng thái lô = "Bản nháp" (DRAFT). `shipmentCode` được sinh ra, duy nhất.
  - Lô xuất hiện ngay trên `/shipments` (danh sách của người tạo); hồ sơ mới mở sẵn để bổ sung B/L,
    chiều hàng, loại lô, nhà máy/công trường, hãng tàu, các mốc cut-off/closing/trả hàng và ghi chú vận hành.
- **Phụ thuộc:** Q17
- **Bằng chứng:** ảnh mobile form đã điền + ảnh trang chi tiết + ảnh danh sách `/shipments`.

### TC-M10-01-02 — Thiếu trường bắt buộc (khách hàng)

- **Mã PRD:** M10-01-02
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** như TC-M10-01-01.
- **Các bước:**
  1. Mở `/clerk/shipments/new`.
  2. Không chọn "Khách hàng" (giữ nguyên "— Chọn khách hàng —").
  3. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Không gọi API (không có request POST `/api/shipments/quick` trong Network tab).
  - Hiển thị thông báo tiếng Việt: "Vui lòng chọn khách hàng" (xem `ClerkShipmentCreatePage.tsx:111`).
  - Không có lô mới được tạo trong DB.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh cảnh báo + ảnh Network tab (không có POST).

### TC-M10-01-03 — Ngoại lệ: mất kết nối khi lưu, gửi lại không trùng

- **Mã PRD:** M10-01-03
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** đã có 1 khách hàng.
- **Các bước:**
  1. Mở `/clerk/shipments/new`. Chọn khách, gõ booking `OFFLINE-01`.
  2. DevTools → Network → Offline. Bấm "Tạo lô hàng" → quan sát thông báo lỗi.
  3. Bật lại Online. Bấm "Tạo lô hàng" lần nữa.
  4. Kiểm tra `/shipments` và DB: đếm số lô có booking `OFFLINE-01`.
- **Kết quả mong đợi (Pass):**
  - Lần 1 (offline): thông báo lỗi tiếng Việt dễ hiểu (vd "Không thể tạo lô hàng…"), không có toast thành công giả.
  - Lần 2 (online): tạo thành công, đúng **1 lô** với booking `OFFLINE-01`.
  - Backend dùng header `Idempotency-Key` (UUID v4 sinh client-side) để khử trùng — nếu cùng key gửi lại,
    trả về lô đã có (xem `routes/shipments.ts:155`).
- **Phụ thuộc:** Q23 (idempotency)
- **Bằng chứng:** ảnh lỗi offline + ảnh Network tab 2 request (cùng `Idempotency-Key`, cùng `shipment.id`) + ảnh `/shipments`.

### TC-M10-01-04 — Phân quyền: vai trò ngoài CLERK/ADMIN không vào được

- **Mã PRD:** M10-01-04
- **Vai trò thử:** `laixe`, `customer`, `ketoan`
- **Thiết bị:** Desktop
- **Các bước:**
  1. Đăng nhập `laixe`. Mở trực tiếp `/clerk/shipments/new`.
  2. Lặp lại với `customer`, rồi `ketoan`.
- **Kết quả mong đợi (Pass):**
  - Cả 3 đều bị `Navigate` redirect về màn nhà của vai trò (cổng nhân viên / khách).
  - Không để lộ form tạo lô hay dữ liệu khách hàng trong response body.
  - API `GET /api/config/customers` cũng chặn ở mức RBAC (kiểm tra Network tab nếu có request lọt qua).
- **Phụ thuộc:** Q17
- **Bằng chứng:** ảnh redirect + ảnh DevTools Network.

### TC-M10-01-05 — Biên: tạo liên tiếp nhiều lô & lô tạo lúc qua đêm (00:00)

- **Mã PRD:** M10-01-05
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** đã có 1 khách hàng; đồng hồ máy để sát 23:59.
- **Các bước:**
  1. Tạo lô A lúc 23:58 (booking `ROLL-A`). Ghi chú ngày tạo.
  2. Tạo lô B lúc 00:02 ngày hôm sau (booking `ROLL-B`).
  3. Tạo lô C ngay sau B (booking `ROLL-C`) — không reload trang.
  4. Trên `/shipments`, lọc theo 3 booking này. Kiểm tra `shipmentCode` và ngày tạo của mỗi lô.
- **Kết quả mong đợi (Pass):**
  - Cả 3 lô đều tạo thành công, **3 `shipmentCode` khác nhau**, không trùng.
  - Ngày tạo đúng theo múi giờ VN (lô A = hôm qua, lô B & C = hôm sau) — không lệch múi giờ.
  - Tạo liên tiếp không lỗi (form reset về `EMPTY_FORM` sau khi navigate).
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 3 lô trên `/shipments` + ảnh chi tiết ngày tạo.

---

## 10.2 — Nhập vận đơn, công-te-nơ, tờ khai và thông tin giao nhận

**Quy tắc nghiệp vụ (PRD M10-02):** Kiểm tra định dạng và trùng lặp; cho phép nhiều công-te-nơ; định nghĩa
các trường bắt buộc trước khi điều vận. Bắt buộc: số vận đơn (B/L), số công-te-nơ, số niêm phong, tờ khai,
ngày giao, địa điểm. Hồ sơ hiển thị từng công-te-nơ và chứng từ; tra cứu được theo số tham chiếu. Dữ liệu
sai → báo lỗi rõ; ngoại lệ cần người xác nhận có thẩm quyền + lý do. Biên: 1 tờ khai nhiều công-te-nơ; lệnh
giao hàng hết hạn; thay thế chứng từ.

> **Lưu ý kỹ thuật:** Số công-te-nơ được kiểm tra theo **ISO 6346** (định dạng `XXXXNNNNNNN` + chữ số kiểm
> tra) ở `shared/src/calculations/iso6346.ts` (`validateContainerNumber`). Backend còn kiểm tra trùng trong
> cùng batch → 400 với message chứa chữ "trùng" (xem `m102-container-validation.test.ts:117`). Readiness
> (client mirror): B/L không trắng + ≥ 1 công-te-nơ.

### TC-M10-02-01 — Nhập B/L + công-te-nơ hợp lệ, lưu thành công (luồng thường)

- **Mã PRD:** M10-02-01
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** có 1 lô DRAFT từ TC-M10-01-01 (ghi lại `:id`).
- **Các bước:**
  1. Mở `/clerk/shipments/:id/docs` với id lô DRAFT đó.
  2. Tại "Số vận đơn (B/L)" gõ `MAEU1234567890` → bấm "Lưu vận đơn".
  3. Bấm "Thêm công-te-nơ": loại = 20ft, số = `MSKU1234565` (hợp lệ ISO 6346), niêm phong `S-001`,
     trọng lượng `15000`. Bấm "Lưu công-te-nơ".
  4. Quan sát banner "Sẵn sàng điều vận".
- **Kết quả mong đợi (Pass):**
  - Lưu B/L thành công, thông báo "Đã lưu số vận đơn.", `version` tăng.
  - Lưu công-te-nơ thành công, thông báo "Đã lưu 1 công-te-nơ.", row có `id`.
  - Banner chuyển từ cảnh báo vàng "Còn thiếu…" sang xanh "Sẵn sàng điều vận".
  - Trên `/shipments/:id` tra cứu theo số B/L hoặc số công-te-nơ → ra đúng lô.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh trang docs sau khi lưu + ảnh banner readiness + ảnh `/shipments/:id`.

### TC-M10-02-02 — Số công-te-nơ sai định dạng / sai check digit

- **Mã PRD:** M10-02-02
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** lô DRAFT từ TC-M10-02-01.
- **Các bước:**
  1. Mở `/clerk/shipments/:id/docs`. Thêm 1 công-te-nơ.
  2. Lần lượt nhập và "Lưu công-te-nơ" với các số: `ABC123` (sai định dạng), `MSKU1234567` (định dạng đúng
     nhưng sai check digit), `MSKU1234565` (đúng — đối chứng).
  3. Lần 4: thêm 2 row **cùng số** `OOLU8312661` trong cùng batch → bấm "Lưu công-te-nơ".
- **Kết quả mong đợi (Pass):**
  - `ABC123`: lỗi tiếng Việt "Sai định dạng. Đúng: XXXXNNNNNNN (4 chữ cái + 7 số…)".
  - `MSKU1234567`: lỗi "Sai số kiểm tra — định dạng đúng nhưng mã kiểm tra không khớp".
  - `MSKU1234565`: lưu thành công.
  - 2 row trùng `OOLU8312661`: backend trả 400 với message chứa chữ "trùng", không lưu.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 3 thông báo lỗi + ảnh Network tab 400 (batch trùng).

### TC-M10-02-03 — Ngoại lệ: 1 tờ khai nhiều công-te-nơ & readiness thiếu

- **Mã PRD:** M10-02-03
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** lô DRAFT mới, chưa có công-te-nơ.
- **Các bước:**
  1. Mở `/clerk/shipments/:id/docs`. Để trống B/L.
  2. Thêm 3 công-te-nơ hợp lệ (giả lập 1 tờ khai cho nhiều cont). Bấm "Lưu công-te-nơ".
  3. Quan sát banner readiness.
  4. (Nếu đăng nhập MANAGER/ADMIN) bấm "Điều vận" khi còn thiếu B/L → quan sát dialog xác nhận.
- **Kết quả mong đợi (Pass):**
  - 3 công-te-nơ lưu thành công (cho phép nhiều cont/lô).
  - Banner vàng: "Còn thiếu: Số vận đơn (B/L)".
  - Dialog "Điều vận" cảnh báo: "Lô hàng còn thiếu: Số vận đơn (B/L). Điều vận tiếp tục?" — có nút hủy an toàn.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 3 cont đã lưu + ảnh banner thiếu + ảnh dialog cảnh báo.

### TC-M10-02-04 — Phân quyền: CLERK không thấy nút "Điều vận"

- **Mã PRD:** M10-02-04
- **Vai trò thử:** `CLERK` (tạo user tạm ở `/users`), đối chiếu `admin`/`MANAGER`
- **Thiết bị:** Desktop
- **Các bước:**
  1. Tạo user `clerk-test` với role CLERK ở `/users`. Đăng xuất, đăng nhập lại bằng user này.
  2. Mở `/clerk/shipments/:id/docs` (lô DRAFT đã có B/L + cont).
  3. Kiểm tra có nút "Điều vận" hay không.
  4. Đăng nhập lại `admin` → mở cùng URL → kiểm tra nút "Điều vận".
- **Kết quả mong đợi (Pass):**
  - CLERK: **không** thấy nút "Điều vận" (chỉ MANAGER/ADMIN mới thấy, `canDispatch` ở
    `ClerkShipmentDocsPage.tsx:86`). CLERK vẫn sửa được B/L và cont.
  - ADMIN/MANAGER: thấy nút "Điều vận".
  - Điều vận là quyết định của điều vận viên (Q17).
- **Phụ thuộc:** Q17
- **Bằng chứng:** ảnh màn CLERK (không nút) + ảnh màn ADMIN (có nút).

### TC-M10-02-05 — Gửi lại/đồng thời: lưu B/L 2 lần nhanh; sửa cont khi dispatch đang xem

- **Mã PRD:** M10-02-05
- **Vai trò:** `admin`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** lô DRAFT có version hiện tại.
- **Các bước:**
  1. Mở `/clerk/shipments/:id/docs`. Gõ B/L = `BL-RETRY`. DevTools throttle = "Slow 3G".
  2. Bấm "Lưu vận đơn" **2 lần liên tiếp** trước khi request đầu trả về.
  3. Quan sát `version` và số request trong Network.
  4. Thử lưu công-te-nơ khi cùng lô đang mở ở tab điều vận (mô phỏng sửa khi người khác đang xem — xem thêm
    TC-M10-03-03 về cảnh báo version).
- **Kết quả mong đợi (Pass):**
  - Backend version-gated: chỉ 1 lưu thành công, request sau nhận lỗi version conflict nếu `version` đã thay đổi.
  - Mọi lỗi là tiếng Việt, người dùng không mất dữ liệu đã gõ trên form.
  - Toast/thông báo "Đã lưu" chỉ hiện đúng 1 lần (TC-HT-04).
- **Phụ thuộc:** Q23
- **Bằng chứng:** ảnh Network tab (version conflict) + ảnh thông báo.

---

## 10.3 — Chuyển dữ liệu ngay cho điều vận

**Quy tắc nghiệp vụ (PRD M10-03):** Sau khi gửi, điều vận nhận thông báo và thấy đúng phiên bản; thay đổi
quan trọng yêu cầu thông báo mới. Hiển thị trạng thái: chưa xem / đã xem / đã nhận / người xử lý. Nếu dữ
liệu sửa khi điều vận đang xem → cảnh báo phiên bản mới. Biên: gửi ngoài giờ; nhiều điều vận viên; thu hồi
lô trước khi gán xe.

> **Lưu ý kỹ thuật:** Bảng `dispatch_handoffs` lưu vòng đời `UNSEEN → SEEN → ACCEPTED | REJECTED`
> (xem `dispatch-handoff.service.ts`). `createHandoff` snapshot `handoffVersion` = `shipment.version`;
> `markSeen` chuyển UNSEEN→SEEN (idempotent); `resolveHandoff` cần `rejectReason` khi REJECTED;
> `checkVersionConflict` phát hiện shipment bị sửa sau khi bàn giao. Mỗi lô chỉ có **một handoff active**
> (unique index `dispatch_handoffs_shipment_active_uniq`). `createHandoff` phát notification kiểu
> `SHIPMENT_HANDOFF`. (Lưu ý: PRD dùng từ "Unread/Read/Accepted" — code dùng "UNSEEN/SEEN/ACCEPTED".)

### TC-M10-03-01 — Bàn giao lô cho điều vận, nhận thông báo (luồng thường)

- **Mã PRD:** M10-03-01
- **Vai trò:** `admin` (tạo handoff) + `FORWARDER`/điều vận (nhận)
- **Thiết bị:** Desktop (vì cần 2 phiên)
- **Tiền điều kiện:** lô DRAFT đã sẵn sàng (B/L + ≥1 cont) từ TC-M10-02-01; có 1 user FORWARDER.
- **Các bước:**
  1. Đăng nhập admin. Mở `/shipments/:id`. Bàn giao lô cho điều vận (tạo handoff).
  2. Đăng nhập user FORWARDER ở tab khác. Mở bảng thông báo / màn điều vận.
  3. Quan sát: thông báo, trạng thái handoff, version snapshot.
- **Kết quả mong đợi (Pass):**
  - FORWARDER nhận notification kiểu `SHIPMENT_HANDOFF` cho đúng lô (liên kết được tới lô).
  - Handoff có `status = UNSEEN`, `handoffVersion` = version hiện tại của lô, `createdBy` = admin.
  - FORWARDER mở lô → `markSeen` chuyển sang `SEEN`, có `seenAt` (giờ VN).
- **Phụ thuộc:** Q17
- **Bằng chứng:** ảnh thông báo FORWARDER + ảnh DB row handoff (UNSEEN→SEEN).

### TC-M10-03-02 — Thiếu/sai: bàn giao lô không tồn tại hoặc đã có handoff active

- **Mã PRD:** M10-03-02
- **Vai trò:** `admin`
- **Thiết bị:** Desktop
- **Tiền điều kiện:** như TC-M10-03-01.
- **Các bước:**
  1. Cố tình gọi `createHandoff` với `shipmentId = 99999999` (không tồn tại).
  2. Với lô đã có handoff UNSEEN/SEEN, cố tình tạo handoff thứ 2 cho cùng lô.
- **Kết quả mong đợi (Pass):**
  - Lô không tồn tại: lỗi 404 "Không tìm thấy…" (xem `dispatch-handoff.service.ts` test 404).
  - Lô đã có handoff active: unique index chặn → lỗi rõ ràng (không tạo trùng).
  - Mọi lỗi bằng tiếng Việt.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh Network tab 404 + ảnh lỗi trùng handoff.

### TC-M10-03-03 — Ngoại lệ: sửa lô khi điều vận đang xem → cảnh báo version conflict

- **Mã PRD:** M10-03-03
- **Vai trò:** `admin` (sửa lô) + FORWARDER (đang xem)
- **Thiết bị:** Desktop (2 phiên)
- **Tiền điều kiện:** lô đã có handoff `SEEN` (FORWARDER đã mở).
- **Các bước:**
  1. Admin sửa B/L hoặc cont trên lô → `version` tăng (PUT `/api/shipments/:id`).
  2. FORWARDER mở lại lô / gọi `checkVersionConflict`.
  3. Quan sát cảnh báo.
- **Kết quả mong đợi (Pass):**
  - `checkVersionConflict` trả `hasConflict = true` vì `shipment.version ≠ handoffVersion`.
  - UI cảnh báo FORWARDER: "lô đã có phiên bản mới" (sửa sau khi bàn giao).
  - FORWARDER không thao tác tiếp dựa trên dữ liệu cũ mà không được cảnh báo.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh cảnh báo conflict + ảnh DB (`version` > `handoffVersion`).

### TC-M10-03-04 — Phân quyền: chỉ người xử lý / vai trò đúng mới được resolve

- **Mã PRD:** M10-03-04
- **Vai trò thử:** `CLERK`, `laixe`, `customer`, `FORWARDER` (handler)
- **Thiết bị:** Desktop
- **Các bước:**
  1. Đăng nhập CLERK → cố gắng `resolveHandoff` (ACCEPTED/REJECTED) handoff của người khác.
  2. Đăng nhập `laixe`, `customer` → thử `markSeen`/`resolveHandoff`.
  3. Đăng nhập FORWARDER đúng handler → `resolveHandoff REJECTED` **không** kèm `rejectReason`.
- **Kết quả mong đợi (Pass):**
  - CLERK / laixe / customer bị chặn RBAC (redirect hoặc 403), không resolve được.
  - REJECTED thiếu lý do → 400 "Lý do từ chối là bắt buộc khi từ chối lệnh điều vận".
  - FORWARDER đúng handler + có lý do → resolve thành công, `status = REJECTED`, có `resolvedAt`.
- **Phụ thuộc:** Q17
- **Bằng chứng:** ảnh 403/redirect + ảnh lỗi 400 thiếu lý do + ảnh DB row REJECTED.

### TC-M10-03-05 — Gửi lại/đồng thời & biên: ngoài giờ, nhiều dispatcher, thu hồi trước gán xe

- **Mã PRD:** M10-03-05
- **Vai trò:** `admin` + 2 FORWARDER
- **Thiết bị:** Desktop (nhiều phiên)
- **Tiền điều kiện:** 1 lô DRAFT sẵn sàng; 2 user FORWARDER (A, B).
- **Các bước:**
  1. Tạo handoff ngoài giờ (đồng hồ máy để tối muộn) → kiểm tra notification vẫn phát đúng.
  2. FORWARDER A `markSeen`, sau đó FORWARDER B cũng `markSeen` cùng handoff → kiểm tra idempotent.
  3. Hai người cùng `resolveHandoff` đồng thời → kiểm tra chỉ 1 thắng, người kia nhận "Lệnh đã kết thúc ở …".
  4. Thu hồi lô (rút handoff / REJECTED) **trước** khi gán xe → kiểm tra không sinh chuyến (trip).
- **Kết quả mong đợi (Pass):**
  - Notification phát đúng ngoài giờ (`createHandoff` phát sự kiện `SHIPMENT_HANDOFF`).
  - `markSeen` idempotent: SEEN rồi thì gọi lại không lỗi, không đổi `seenAt`.
  - Resolve đồng thời: 1 thành công, 1 nhận 400 "Lệnh đã kết thúc ở ACCEPTED/REJECTED".
  - Thu hồi trước gán xe: không có trip mới sinh ra cho lô này; lô về trạng thái cho phép tạo handoff lại.
- **Phụ thuộc:** Q23
- **Bằng chứng:** ảnh notification + ảnh 2 request resolve (1 OK, 1 lỗi) + ảnh `/trips` (không có trip mới).

---

## Bảng nghiệm thu M10

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M10-01-01 |           |         | Dùng admin (chưa có demo CLERK) |            |
| __/__/__ | TC-M10-01-02 |           |         |         |            |
| __/__/__ | TC-M10-01-03 |           |         | Q23 idempotency |            |
| __/__/__ | TC-M10-01-04 |           |         | Q17 RBAC |            |
| __/__/__ | TC-M10-01-05 |           |         |         |            |
| __/__/__ | TC-M10-02-01 |           |         |         |            |
| __/__/__ | TC-M10-02-02 |           |         | ISO 6346 |            |
| __/__/__ | TC-M10-02-03 |           |         |         |            |
| __/__/__ | TC-M10-02-04 |           |         | Q17 — tạo user CLERK tạm |   |
| __/__/__ | TC-M10-02-05 |           |         | Q23 |              |
| __/__/__ | TC-M10-03-01 |           |         | Q17 |              |
| __/__/__ | TC-M10-03-02 |           |         |         |            |
| __/__/__ | TC-M10-03-03 |           |         | version conflict |       |
| __/__/__ | TC-M10-03-04 |           |         | Q17 RBAC |            |
| __/__/__ | TC-M10-03-05 |           |         | Q23 concurrency |        |

### Tiêu chí toàn phân hệ M10-HT-01 … M10-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` áp dụng trên màn hình của M10. **Đặc biệt lưu ý
M10-HT-07 (thiết bị):** thử mọi màn clerk ở cả iPhone SE 375×667 và Desktop.

| Mã HT      | Kết quả | Bằng chứng |
| ---------- | ------- | ---------- |
| M10-HT-01  |         |            |
| M10-HT-02  |         |            |
| M10-HT-03  |         |            |
| M10-HT-04  |         |            |
| M10-HT-05  |         |            |
| M10-HT-06  |         |            |
| M10-HT-07  |         |            |
| M10-HT-08  |         |            |
| M10-HT-09  |         |            |
| M10-HT-10  |         |            |
