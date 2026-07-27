# M08 — Ứng dụng dành cho lái xe (Driver Mobile App)

> **Phân hệ 8** — 6 nhóm chức năng (8.1–8.6). Nguồn PRD: `docs/prd/Module8.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M08-HT-01` … `M08-HT-10` (xem `00-cross-cutting.md`).
>
> **Đây là ỨNG DỤNG LÁI XE TRÊN ĐIỆN THOẠI.** Mọi ca thử mặc định dùng DevTools Device
> Toolbar ở kích cỡ **Mobile iPhone SE (375×667)** trừ khi quy định khác. Chỉ thử trên Desktop khi
> cần kiểm tra responsive đối chiếu.
>
> **Màn hình chính (cổng lái xe):**
> - `/my-trips` — Hành trình (danh sách lệnh của lái xe)
> - `/my-trips/two-orders` — 2 lệnh điều động trong ngày
> - `/my-trips/:id` — Chi tiết hành trình (tiến độ, chi phí, chứng từ)
> - `/my-earnings` — Thu nhập
> - `/my-payslips` — Phiếu lương
> - `/my-penalties` — Kỷ luật (khoản phạt cá nhân)
>
> **Vai trò thử chính:** `laixe` (lái xe chính). Dùng `thu`, `pho`, `quyet` cho kịch bản nhiều lái xe
> (multi-driver) hoặc đối chiếu phân quyền lái-xe-vs-lái-xe.

---

## 8.1 — Giao diện dễ đọc và dễ thao tác trên điện thoại

**Quy tắc nghiệp vụ (PRD M08-8.1):** Tác vụ chính dùng được bằng một tay, chữ và nút đủ lớn, không
cần phóng to thủ công. Khi xoay màn hình hoặc tăng cỡ chữ, nội dung không bị che và nút chính vẫn dùng
được.

### TC-M08-01-01 — Hiển thị dữ liệu thông thường

- **Mã PRD:** M08-01-01
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** `laixe` có ít nhất 2 chuyến ở trạng thái "Đang chạy" và 1 phiếu lương đã phát hành.
- **Các bước:**
  1. Đăng nhập bằng `laixe` trên DevTools ở 375×667.
  2. Mở lần lượt: `/my-trips`, `/my-trips/:id` (1 chuyến đang chạy), `/my-earnings`, `/my-payslips`, `/my-penalties`.
  3. Ở mỗi màn: dùng ngón tay cái để chạm nút chính (Xem chi tiết, Cập nhật tiến độ, Xem phiếu lương).
  4. Đo đạc: cỡ chữ thân ≥ 14px; chiều cao nút chính ≥ 44px; độ tương phản chữ/nền đạt WCAG AA.
- **Kết quả mong đợi (Pass):**
  - Mọi màn hiển thị đầy đủ, không tràn ngang, không có thanh cuộn ngang.
  - Nút chính nằm trong vùng chạm một tay (nửa dưới màn hình), không cần phóng to thủ công.
  - Chữ và nút đủ lớn; nhãn tiếng Việt rõ ràng.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh 5 màn mobile + ảnh đo kích thước nút/chữ (DevTools inspect).

### TC-M08-01-02 — Không có dữ liệu

- **Mã PRD:** M08-01-02
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** `laixe` mới tạo, chưa có chuyến, chưa có phiếu lương, chưa có khoản phạt.
- **Các bước:**
  1. Đăng nhập `laixe` mới.
  2. Mở `/my-trips`, `/my-earnings`, `/my-payslips`, `/my-penalties`.
- **Kết quả mong đợi (Pass):**
  - Mỗi màn hiển thị trạng thái rỗng rõ ràng (vd: "Chưa có lệnh điều động", "Chưa có phiếu lương").
  - Các tổng = 0, không báo lỗi kỹ thuật (không stack-trace, không toast đỏ 500).
  - Trạng thái rỗng căn giữa màn, có icon/hình minh hoạ, không vỡ bố cục.

### TC-M08-01-03 — Trường hợp biên (xoay ngang, cỡ chữ lớn của hệ điều hành, mạng chậm)

- **Mã PRD:** M08-01-03
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667), thử cả xoay ngang (667×375)
- **Các bước:**
  1. Mở `/my-trips/:id` đang ở dọc. Xoay ngang thiết bị.
  2. Quay lại dọc. Bật "Large text"/cỡ chữ lớn nhất của hệ điều hành (DevTools → Rendering → không hỗ trợ thì mô phỏng bằng CSS font-scale 1.3).
  3. DevTools Network throttling = "Slow 3G". Tải lại `/my-trips`.
- **Kết quả mong đợi (Pass):**
  - Khi xoay ngang: nội dung không bị che, nút "Cập nhật tiến độ"/"Hoàn thành" vẫn nhìn thấy và bấm được.
  - Khi tăng cỡ chữ: text không bị cắt, không tràn khỏi nút, không đè lên nhau.
  - Khi mạng chậm: có skeleton/loader tiếng Việt; dữ liệu đã nhập không mất; không crash trắng màn.

### TC-M08-01-04 — Kiểm soát quyền xem

- **Mã PRD:** M08-01-04
- **Vai trò thử:** `ketoan`, `customer`, `laixe` (khác)
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `ketoan` mở trực tiếp `/my-trips` và `/my-payslips`.
  2. `customer` mở trực tiếp `/my-trips`.
  3. Đăng nhập `laixe` A; mở URL `/my-trips/<id-của-lai-xe-B>` (lấy id từ DB).
- **Kết quả mong đợi (Pass):**
  - `ketoan`, `customer` bị redirect về màn nhà của vai trò hoặc trang "Không có quyền".
  - API trả 403 (kiểm tra DevTools Network tab); response body không để lộ dữ liệu nhạy cảm.
  - `laixe` A không xem được chi tiết chuyến của lái xe B; không泄露 lương/chứng từ người khác.

### TC-M08-01-05 — Đối chiếu dữ liệu nguồn

- **Mã PRD:** M08-01-05
- **Vai trò:** `laixe` + `admin`
- **Thiết bị:** Mobile (`laixe`) + Desktop (`admin`)
- **Các bước:**
  1. `admin` sửa giờ chạy của chuyến C-001 từ 08:00 → 09:00 trên `/trips/C-001`.
  2. `laixe` (được giao C-001) tải lại `/my-trips` và mở `/my-trips/C-001`.
  3. So sánh giờ hiển thị trên cổng lái xe với `/trips/C-001` (admin).
- **Kết quả mong đợi (Pass):**
  - Giờ trên `/my-trips/C-001` cập nhật thành 09:00, khớp nguồn.
  - Thời điểm cập nhật hiển thị đúng; không cộng trùng lịch sử (bản cũ vẫn trong nhật ký nhưng bản hiện hành là mới).

---

## 8.2 — Nhận lệnh điều động và chứng từ hướng dẫn trực tiếp

**Quy tắc (PRD M08-8.2):** Lệnh mới hoặc thay đổi phải có thông báo; lệnh cũ vẫn lưu lịch sử; dữ liệu
nhạy cảm chỉ hiện cho đúng lái xe. Lái xe xem được chuyến, thời gian, tuyến, điểm giao nhận, liên hệ,
hướng dẫn đóng trạm và chứng từ mà không phải nhận lại qua kênh ngoài hệ thống. Nếu lệnh bị thu hồi
hoặc đổi xe, ứng dụng phải nêu rõ để lái xe không cập nhật nhầm.

### TC-M08-02-01 — Hiển thị dữ liệu thông thường

- **Mã PRD:** M08-02-01
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** điều vận đã tạo và giao 1 lệnh cho `laixe`, có đủ chứng từ đính kèm (tờ khai, lệnh giao hàng) và hướng dẫn đóng trạm.
- **Các bước:**
  1. `admin` (điều vận) tạo chuyến C-202 và giao cho `laixe`, đính kèm 2 chứng từ PDF + hướng dẫn đóng trạm.
  2. `laixe` mở `/my-trips`. Bấm vào C-202.
  3. Kiểm tra các trường: chuyến, thời gian, tuyến, điểm nhận/giao, liên hệ, hướng dẫn đóng trạm, chứng từ.
  4. Bấm vào 1 chứng từ để xem trước.
- **Kết quả mong đợi (Pass):**
  - Lái xe thấy đủ thông tin cần thiết mà không phải nhận qua Zalo/điện thoại.
  - Có thông báo (in-app, push) khi lệnh mới được giao.
  - Chứng từ xem được trên mobile (PDF viewer thu nhỏ vừa màn, không tải ngoài hệ thống).
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh màn chi tiết + ảnh thông báo + ảnh PDF viewer.

### TC-M08-02-02 — Không có dữ liệu

- **Mã PRD:** M08-02-02
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` không có lệnh nào (mới được tạo tài khoản, chưa điều động).
  2. Mở `/my-trips`.
- **Kết quả mong đợi (Pass):**
  - Hiển thị "Chưa có lệnh điều động" rõ ràng, không lỗi kỹ thuật.
  - Tổng lệnh = 0; không có thông báo nhạt về lệnh của người khác.

### TC-M08-02-03 — Trường hợp biên (cập nhật khi đang mất mạng; tài liệu nhiều trang; đổi giờ gấp)

- **Mã PRD:** M08-02-03
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` đang xem C-202. DevTools → Network → Offline.
  2. `admin` đổi giờ chạy C-202 từ 09:00 → 06:00 (đổi gấp) và thu hồi lệnh (rút phân công).
  3. Bật mạng lại. Tải lại `/my-trips`.
  4. Tạo 1 lệnh có chứng từ 10 trang PDF. Mở trên mobile và lướt các trang.
- **Kết quả mong đợi (Pass):**
  - Khi online lại, lệnh hiển thị trạng thái mới nhất (đổi giờ hoặc đã thu hồi) với nhãn rõ.
  - Nếu lệnh bị thu hồi/đổi xe, app nêu rõ "Lệnh đã thay đổi — không tiếp tục cập nhật chuyến cũ".
  - Lệnh cũ vẫn còn trong lịch sử, không bị xoá.
  - PDF nhiều trang xem được trên mobile, không crash, không buộc tải ngoài.

### TC-M08-02-04 — Kiểm soát quyền xem

- **Mã PRD:** M08-02-04
- **Vai trò thử:** `laixe` (A vs B)
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` A mở URL `/my-trips/<id-lệnh-của-B>`.
  2. Gọi trực tiếp API lấy chi tiết lệnh của B (qua DevTools, copy token của A, request id của B).
  3. `laixe` A mở thông báo in-app: kiểm tra chỉ thấy thông báo của A.
- **Kết quả mong đợi (Pass):**
  - Từ chối truy cập; không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
  - API trả 403; không hiển thị liên hệ/chứng từ/hướng dẫn đóng trạm của lái xe khác.

### TC-M08-02-05 — Đối chiếu dữ liệu nguồn

- **Mã PRD:** M08-02-05
- **Vai trò:** `laixe` + `admin`
- **Thiết bị:** Mobile (`laixe`) + Desktop (`admin`)
- **Các bước:**
  1. `admin` sửa điểm giao của C-202 trên `/trips/C-202` (từ Kho A → Kho B) + thêm 1 chứng từ.
  2. `laixe` tải lại `/my-trips/C-202`.
  3. So sánh: điểm giao, danh sách chứng từ, hướng dẫn đóng trạm.
- **Kết quả mong đợi (Pass):**
  - Số liệu mới khớp chi tiết nguồn; không cộng trùng (chứng từ cũ không nhân đôi).
  - Thời điểm cập nhật hiển thị đúng theo giờ VN.

---

## 8.3 — Hiển thị hai lệnh điều động trong ngày

**Quy tắc (PRD M08-8.3):** Hiển thị rõ lệnh đang thực hiện và lệnh kế tiếp; không trộn chứng từ
hoặc chi phí giữa hai lệnh. Lái xe thấy thứ tự, thời gian dự kiến và cảnh báo khi lệnh đầu bị trễ.
Nếu một lệnh bị hủy, lệnh còn lại vẫn giữ đúng dữ liệu và được thông báo ngay.

### TC-M08-03-01 — Hiển thị dữ liệu thông thường

- **Mã PRD:** M08-03-01
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** `admin` đã ghép 2 lệnh cùng ngày cho `laixe`: Lệnh 1 (08:00–12:00, Kho A → Kho B), Lệnh 2 (14:00–18:00, Kho B → Kho C).
- **Các bước:**
  1. `laixe` mở `/my-trips/two-orders`.
  2. Kiểm tra hiển thị thứ tự 2 lệnh, thời gian dự kiến, điểm nối tiếp.
  3. Mở Lệnh 1 → cập nhật mốc khởi hành chậm (bắt đầu 09:00 thay vì 08:00).
  4. Quay lại `/my-trips/two-orders`.
- **Kết quả mong đợi (Pass):**
  - Hiển thị rõ "Đang thực hiện: Lệnh 1" và "Kế tiếp: Lệnh 2".
  - Khi Lệnh 1 trễ: có cảnh báo "Lệnh 1 đang trễ — có thể ảnh hưởng Lệnh 2".
  - Chứng từ và chi phí của 2 lệnh tách biệt, không trộn lẫn.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh two-orders + ảnh cảnh báo trễ.

### TC-M08-03-02 — Không có dữ liệu

- **Mã PRD:** M08-03-02
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` trong ngày chỉ có 1 lệnh (không có lệnh thứ 2).
  2. Mở `/my-trips/two-orders`.
- **Kết quả mong đợi (Pass):**
  - Hiển thị "Chỉ có 1 lệnh trong ngày" hoặc redirect về `/my-trips` với thông báo phù hợp.
  - Không báo lỗi kỹ thuật, tổng = 1 lệnh.

### TC-M08-03-03 — Trường hợp biên (2 lệnh qua ngày; cùng điểm nhận; lệnh 2 đổi xe)

- **Mã PRD:** M08-03-03
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Ghép 2 lệnh: Lệnh 1 kết thúc 23:30 hôm nay, Lệnh 2 bắt đầu 01:00 ngày mai (qua ngày).
  2. Tạo 2 lệnh có cùng điểm nhận (cùng kho) → kiểm tra cảnh báo logic ghép.
  3. Khi Lệnh 2 đang "Mới tạo", `admin` đổi xe của Lệnh 2.
  4. `laixe` tải lại `/my-trips/two-orders`.
- **Kết quả mong đợi (Pass):**
  - 2 lệnh qua ngày hiển thị đúng ngày của từng lệnh; không trộn ngày.
  - Cùng điểm nhận: app không bị nhầm lẫn chứng từ/chi phí giữa 2 lệnh.
  - Khi Lệnh 2 đổi xe: app nêu rõ "Lệnh 2 đã đổi xe"; lái xe không cập nhật nhầm lên xe cũ.

### TC-M08-03-04 — Kiểm soát quyền xem

- **Mã PRD:** M08-03-04
- **Vai trò thử:** `thu`, `pho`, `quyet` (lái xe khác) + `customer`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `thu` mở URL `/my-trips/two-orders` (chỉ `laixe` chính được ghép 2 lệnh).
  2. `thu` mở `/my-trips/<id-Lệnh-1>` (lệnh của `laixe` chính).
  3. `customer` mở `/my-trips/two-orders`.
- **Kết quả mong đợi (Pass):**
  - Mỗi lái xe chỉ thấy lệnh của mình; không thấy lệnh ghép của người khác.
  - `customer` bị từ chối; API 403; không để lộ dữ liệu trong response.

### TC-M08-03-05 — Đối chiếu dữ liệu nguồn

- **Mã PRD:** M08-03-05
- **Vai trò:** `laixe` + `admin`
- **Thiết bị:** Mobile (`laixe`) + Desktop (`admin`)
- **Các bước:**
  1. `admin` hủy Lệnh 1 trên `/trips/<id>` (lý do: khách hoãn).
  2. `laixe` tải lại `/my-trips/two-orders`.
  3. So sánh dữ liệu 2 lệnh giữa `/my-trips/two-orders` và `/trips` (admin).
- **Kết quả mong đợi (Pass):**
  - Khi Lệnh 1 bị hủy: Lệnh 2 vẫn giữ đúng dữ liệu; lái xe được thông báo ngay (in-app/push).
  - Số liệu Lệnh 2 trên cổng lái xe khớp `/trips`; không cộng trùng; thời điểm cập nhật đúng.

---

## 8.4 — Cập nhật tiến độ và chi phí phát sinh

**Quy tắc (PRD M08-8.4):** Không cho hoàn thành khi thiếu bằng chứng bắt buộc; khoản chi phải gắn
đúng chuyến và trạng thái chờ kiểm tra. Điều vận nhận tiến độ kịp thời; kế toán thấy khoản chi cùng
thời gian và người nhập. Mất mạng phải lưu tạm an toàn và đồng bộ một lần khi có kết nối.
**Mốc tiến độ:** khởi hành, hoàn thành. **Loại chi phí:** tiền nâng hạ, công tác phí.

### TC-M08-04-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M08-04-01
- **Vai trò:** `laixe` + đối chiếu `admin`/`ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** `laixe` có chuyến C-303 ở trạng thái "Đang chạy".
- **Các bước:**
  1. `laixe` mở `/my-trips/C-303`.
  2. Cập nhật mốc "Khởi hành" (chụp ảnh bổ sung nếu yêu cầu) → lưu.
  3. Thêm chi phí phát sinh: tiền nâng hạ 500.000đ (kèm ảnh) + công tác phí 200.000đ (kèm ảnh).
  4. Cập nhật mốc "Hoàn thành" (đủ ảnh bắt buộc) → lưu.
  5. Đăng nhập `admin`: kiểm tra `/trips/C-303` (tiến độ, thời gian). Đăng nhập `ketoan`: kiểm tra khoản chi ở `/expenses`.
- **Kết quả mong đợi (Pass):**
  - Điều vận nhận tiến độ kịp thời (mỗi mốc cập nhật có timestamp theo giờ VN).
  - Kế toán thấy 2 khoản chi cùng thời gian, người nhập (`laixe`), chuyến C-303, trạng thái "Chờ kiểm tra".
  - Tiền nâng hạ và công tác phí tách dòng, gắn đúng chuyến, không trộn.

### TC-M08-04-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M08-04-02
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Mở C-303 đang chạy. Bấm "Hoàn thành" **mà không có ảnh bắt buộc**.
  2. Thêm khoản công tác phí nhưng bỏ trống số tiền (hoặc nhập chữ).
  3. Thêm tiền nâng hạ với số tiền âm (-100.000đ).
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt, chỉ rõ dữ liệu cần sửa (vd: "Cần ảnh hoàn thành trước khi chốt").
  - Không chuyển sang trạng thái "Hoàn thành"; khoản chi không lưu; số âm bị từ chối.
  - Nút "Hoàn thành" bị khoá cho đến khi đủ bằng chứng.

### TC-M08-04-03 — Trường hợp ngoại lệ (mất mạng — lưu tạm an toàn + đồng bộ)

- **Mã PRD:** M08-04-03
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` mở C-303, nhập mốc khởi hành + 1 khoản công tác phí (kèm ảnh).
  2. DevTools → Network → Offline.
  3. Bấm "Lưu tiến độ".
  4. Bật mạng lại. Xem dữ liệu đã đồng bộ chưa.
- **Kết quả mong đợi (Pass):**
  - Khi offline: toast "Đang lưu tạm — sẽ đồng bộ khi có mạng".
  - Dữ liệu đã nhập còn trên form (không mất).
  - Khi online lại: đồng bộ 1 lần, không tạo bản ghi trùng; timestamp ghi đúng lúc lưu tạm hay lúc đồng bộ (theo quy tắc chốt).

### TC-M08-04-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M08-04-04
- **Vai trò thử:** `ketoan`, `customer`, `thu`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `ketoan` mở `/my-trips/C-303` và thử bấm "Hoàn thành".
  2. `customer` thử gọi API cập nhật tiến độ C-303.
  3. `thu` thử cập nhật tiến độ chuyến C-303 của `laixe` chính.
- **Kết quả mong đợi (Pass):**
  - Từ chối thao tác; dữ liệu không thay đổi.
  - Nhật ký ghi nhận thao tác thất bại (ai, khi nào, cố tình hay nhầm).
  - API trả 403; không hiển thị nút cập nhật cho vai trò không có quyền.

### TC-M08-04-05 — Gửi lại hoặc thao tác đồng thời (bấm 2 lần; đổi chuyến đang mở; ảnh tải thất bại)

- **Mã PRD:** M08-04-05
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Network throttling = "Slow 3G". Bấm "Lưu tiến độ" 2 lần liên tiếp.
  2. Mở C-303, đang cập nhật dở → chuyển sang `/my-trips/C-404` → quay lại C-303.
  3. Tải ảnh công tác phí nhưng ngắt mạng giữa chừng (ảnh tải thất bại).
- **Kết quả mong đợi (Pass):**
  - Bấm 2 lần: chỉ tạo 1 bản ghi tiến độ / 1 khoản chi (xem TC-HT-04).
  - Đổi chuyến đang mở: dữ liệu đã nhập của C-303 không dính sang C-404.
  - Ảnh tải thất bại: có thông báo tiếng Việt, cho phép thử lại; không lưu khoản chi khi thiếu ảnh bắt buộc.

---

## 8.5 — Chụp ảnh và nhận dạng mã công-te-nơ hoặc niêm phong

**Quy tắc (PRD M08-8.5):** Kết quả tự động chỉ là gợi ý; kiểm tra định dạng; bắt buộc người dùng
xác nhận hoặc sửa trước khi lưu. Lưu ảnh gốc, kết quả nhận dạng, giá trị đã xác nhận và người xác
nhận. Ảnh mờ hoặc nhiều mã phải yêu cầu chụp lại hoặc chọn đúng mã, không tự lưu kết quả không chắc
chắn.
**Lưu ý:** Kiểm tra định dạng ISO 6346 chạy trên mã công-te-nơ đã xác nhận.

### TC-M08-05-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M08-05-01
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667) — dùng camera hoặc upload ảnh giả lập
- **Tiền điều kiện:** `laixe` có chuyến C-303 có công-te-nơ và niêm phong cần chụp.
- **Các bước:**
  1. `laixe` mở `/my-trips/C-303` → mục "Chứng từ ảnh".
  2. Chụp ảnh công-te-nơ (mã rõ ràng: TGHU 1234567) → hệ thống OCR gợi ý mã.
  3. Kiểm tra gợi ý, sửa nếu cần (đổi 1 chữ số) → bấm "Xác nhận".
  4. Chụp ảnh niêm phong, làm tương tự.
- **Kết quả mong đợi (Pass):**
  - OCR chỉ là gợi ý (có nhãn "Gợi ý"), lái xe phải xác nhận/sửa trước khi lưu.
  - Hệ thống lưu đủ 4 thành phần: ảnh gốc, kết quả OCR, giá trị đã xác nhận, người xác nhận (`laixe`).
  - Kiểm tra ISO 6346 chạy trên mã đã xác nhận; cảnh báo nếu mã không hợp lệ nhưng vẫn cho người dùng quyết định.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh màn OCR + ảnh dữ liệu lưu (4 trường).

### TC-M08-05-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M08-05-02
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Bấm "Lưu" mà chưa chọn loại ảnh (công-te-nơ hay niêm phong).
  2. OCR trả mã sai định dạng (vd: "ABC12" — quá ngắn). Bấm "Xác nhận" mà không sửa.
  3. Bỏ trống chuyến khi lưu ảnh.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt chỉ rõ: "Phải chọn loại ảnh", "Mã không hợp lệ — kiểm tra lại", "Phải gắn ảnh với chuyến".
  - Không tự lưu kết quả OCR không chắc chắn; không chuyển trạng thái không hợp lệ.

### TC-M08-05-03 — Trường hợp ngoại lệ (ảnh mờ / nhiều mã → yêu cầu chụp lại hoặc chọn đúng mã)

- **Mã PRD:** M08-05-03
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Chụp ảnh mờ (blur) → hệ thống phát hiện độ mờ.
  2. Chụp ảnh có 2 công-te-nơ cạnh nhau → OCR thấy nhiều mã.
  3. Chụp ảnh quá tối (ánh sáng yếu).
- **Kết quả mong đợi (Pass):**
  - Ảnh mờ: yêu cầu chụp lại, không tự lưu.
  - Nhiều mã: hiển thị danh sách mã phát hiện, lái xe chọn đúng mã rồi xác nhận.
  - Quá tối: cảnh báo "Ảnh quá tối — đề nghị chụp lại", không tự lưu kết quả không chắc chắn.

### TC-M08-05-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M08-05-04
- **Vai trò thử:** `ketoan`, `customer`, `thu`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `ketoan` mở `/my-trips/C-303` và thử nút "Chụp ảnh công-te-nơ".
  2. `customer` gọi API upload ảnh công-te-nơ cho C-303.
  3. `thu` thử xác nhận mã công-te-nơ cho chuyến của `laixe` chính.
- **Kết quả mong đợi (Pass):**
  - Từ chối thao tác; dữ liệu không thay đổi; không hiển thị nút chụp/xác nhận cho vai trò không có quyền.
  - API trả 403; nhật ký ghi nhận thao tác thất bại.

### TC-M08-05-05 — Gửi lại hoặc thao tác đồng thời (ảnh xoay; ánh sáng yếu; nhiều container; không mạng)

- **Mã PRD:** M08-05-05
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Chụp ảnh xoay 90° → kiểm tra OCR xử lý xoay.
  2. Network throttling = "Slow 3G". Bấm "Xác nhận" 2 lần liên tiếp.
  3. Offline → chụp + bấm lưu → bật mạng lại.
- **Kết quả mong đợi (Pass):**
  - Ảnh xoay: OCR vẫn đọc được (hoặc yêu cầu chụp lại), không lưu sai.
  - Bấm 2 lần: chỉ lưu 1 bản ghi ảnh (xem TC-HT-04); không tạo bút toán trùng.
  - Offline: lưu tạm an toàn; khi online đồng bộ 1 lần; trạng thái cuối nhất quán và truy vết được.

---

## 8.6 — Xem phiếu lương, thu nhập và khoản phạt cá nhân

**Quy tắc (PRD M08-8.6):** Chỉ hiển thị kỳ đã phát hành; không cho xem dữ liệu người khác; mỗi dòng
liên kết được tới căn cứ. Phiếu lương có tổng rõ ràng, lịch sử các kỳ và trạng thái đã xem. Kỳ bị
điều chỉnh phải hiển thị phiên bản mới và lý do, vẫn giữ lịch sử bản cũ.

### TC-M08-06-01 — Hiển thị dữ liệu thông thường

- **Mã PRD:** M08-06-01
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** `ketoan` đã phát hành phiếu lương kỳ 07/2026 cho `laixe`: lương cơ bản 10.000.000đ, lương chuyến 5.000.000đ, phụ cấp 1.000.000đ, khoản phạt 500.000đ → thực lĩnh 15.500.000đ.
- **Các bước:**
  1. `laixe` mở `/my-payslips`. Chọn kỳ 07/2026.
  2. Xem phiếu: lương cơ bản, lương chuyến, phụ cấp, khoản phạt, thực lĩnh.
  3. Bấm vào 1 dòng (vd lương chuyến) để xem căn cứ.
  4. Mở `/my-earnings` xem tổng quan thu nhập. Mở `/my-penalties` xem khoản phạt.
  5. Đánh dấu "Đã xem" phiếu (nếu có nút) hoặc chỉ cần mở.
- **Kết quả mong đợi (Pass):**
  - Phiếu lương có tổng rõ ràng (tổng từng nhóm + thực lĩnh), dấu phân cách VNĐ đúng (`15.500.000 ₫`).
  - Có lịch sử các kỳ; trạng thái "Đã xem" cập nhật sau khi mở.
  - Mỗi dòng liên kết được tới căn cứ (lương chuyến → danh sách chuyến; khoản phạt → biên bản).
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh phiếu lương + ảnh click-through căn cứ.

### TC-M08-06-02 — Không có dữ liệu

- **Mã PRD:** M08-06-02
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` mở kỳ chưa phát hành (vd 12/2026).
  2. `laixe` mới, chưa có kỳ nào → mở `/my-payslips`.
- **Kết quả mong đợi (Pass):**
  - Kỳ chưa phát hành: không hiển thị (chỉ hiện kỳ đã phát hành).
  - Chưa có kỳ nào: hiển thị "Chưa có phiếu lương", tổng = 0, không lỗi kỹ thuật.

### TC-M08-06-03 — Trường hợp biên (lái xe nghỉ việc; kỳ không phát sinh chuyến; thực lĩnh = 0)

- **Mã PRD:** M08-06-03
- **Vai trò:** `laixe`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `laixe` nghỉ việc từ giữa kỳ 07/2026 → mở `/my-payslips` kỳ 07.
  2. Tạo kỳ mà lái xe không có chuyến nào (chỉ có lương cơ bản + phụ cấp).
  3. Tạo kỳ mà thực lĩnh = 0 (khoản phạt = tổng lương).
- **Kết quả mong đợi (Pass):**
  - Lái xe nghỉ việc: vẫn xem được các kỳ đã phát hành trước đó; không thấy kỳ sau ngày nghỉ.
  - Kỳ không có chuyến: lương chuyến = 0, hiển thị rõ, không lỗi.
  - Thực lĩnh = 0: hiển thị `0 ₫` đúng, không âm, không lỗi kỹ thuật.

### TC-M08-06-04 — Kiểm soát quyền xem

- **Mã PRD:** M08-06-04
- **Vai trò thử:** `thu`, `pho`, `quyet`, `customer`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. `thu` mở URL `/my-payslips/<kỳ-của-lai-xe-chính>`.
  2. `pho` mở `/my-earnings` của `laixe` chính (lấy URL/id từ DB).
  3. `customer` mở `/my-payslips`.
  4. `laixe` chính gọi API lấy phiếu lương của `thu` (qua DevTools).
- **Kết quả mong đợi (Pass):**
  - Mỗi lái xe chỉ xem dữ liệu của mình; không xem được lương/thu nhập/phạt của lái xe khác.
  - `customer` bị từ chối; API 403; không để lộ dữ liệu trong response body.

### TC-M08-06-05 — Đối chiếu dữ liệu nguồn

- **Mã PRD:** M08-06-05
- **Vai trò:** `laixe` + `ketoan`/`admin`
- **Thiết bị:** Mobile (`laixe`) + Desktop (`ketoan`)
- **Các bước:**
  1. `ketoan` tạo khoản điều chỉnh kỳ 07/2026 cho `laixe`: tăng phụ cấp 500.000đ (lý do: bổ sung phụ cấp đêm), phát hành phiên bản mới.
  2. `laixe` mở lại `/my-payslips` kỳ 07/2026.
  3. So sánh: phiên bản mới vs cũ; tổng thu nhập kỳ.
- **Kết quả mong đợi (Pass):**
  - Kỳ bị điều chỉnh hiển thị phiên bản mới (+ lý do điều chỉnh), vẫn giữ lịch sử bản cũ.
  - Số liệu mới khớp `/salary` (ketoan/admin); không cộng trùng (không cộng cả bản cũ và bản mới).
  - Thời điểm cập nhật đúng theo giờ VN; mỗi dòng vẫn link tới căn cứ.

---

## Bảng nghiệm thu M08

Sau khi thử các TC theo nhóm và các TC-HT, điền:

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M08-01-01 |           |         |         |            |
| __/__/__ | TC-M08-01-02 |           |         |         |            |
| __/__/__ | TC-M08-01-03 |           |         |         |            |
| __/__/__ | TC-M08-01-04 |           |         |         |            |
| __/__/__ | TC-M08-01-05 |           |         |         |            |
| __/__/__ | TC-M08-02-01 |           |         |         |            |
| __/__/__ | TC-M08-02-02 |           |         |         |            |
| __/__/__ | TC-M08-02-03 |           |         |         |            |
| __/__/__ | TC-M08-02-04 |           |         |         |            |
| __/__/__ | TC-M08-02-05 |           |         |         |            |
| __/__/__ | TC-M08-03-01 |           |         |         |            |
| __/__/__ | TC-M08-03-02 |           |         |         |            |
| __/__/__ | TC-M08-03-03 |           |         |         |            |
| __/__/__ | TC-M08-03-04 |           |         |         |            |
| __/__/__ | TC-M08-03-05 |           |         |         |            |
| __/__/__ | TC-M08-04-01 |           |         |         |            |
| __/__/__ | TC-M08-04-02 |           |         |         |            |
| __/__/__ | TC-M08-04-03 |           |         |         |            |
| __/__/__ | TC-M08-04-04 |           |         |         |            |
| __/__/__ | TC-M08-04-05 |           |         |         |            |
| __/__/__ | TC-M08-05-01 |           |         |         |            |
| __/__/__ | TC-M08-05-02 |           |         |         |            |
| __/__/__ | TC-M08-05-03 |           |         |         |            |
| __/__/__ | TC-M08-05-04 |           |         |         |            |
| __/__/__ | TC-M08-05-05 |           |         |         |            |
| __/__/__ | TC-M08-06-01 |           |         |         |            |
| __/__/__ | TC-M08-06-02 |           |         |         |            |
| __/__/__ | TC-M08-06-03 |           |         |         |            |
| __/__/__ | TC-M08-06-04 |           |         |         |            |
| __/__/__ | TC-M08-06-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M08-HT-01 … M08-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` áp dụng trên màn hình của M08 (ưu tiên mobile
iPhone SE 375×667). Lưu ý: M08-HT-07 (Thiết bị) là tiêu chí trọng tâm của phân hệ này — tất cả 6 màn
lái xe đều phải pass trên mobile.

| Mã HT     | Nhóm kiểm tra          | Kết quả | Bằng chứng |
| --------- | ---------------------- | ------- | ---------- |
| M08-HT-01 | Ngôn ngữ               |         |            |
| M08-HT-02 | Phân quyền             |         |            |
| M08-HT-03 | Nhật ký                |         |            |
| M08-HT-04 | Tính toàn vẹn          |         |            |
| M08-HT-05 | Tiền tệ                |         |            |
| M08-HT-06 | Ngày giờ               |         |            |
| M08-HT-07 | Thiết bị (trọng tâm)   |         |            |
| M08-HT-08 | Khôi phục lỗi          |         |            |
| M08-HT-09 | Tìm kiếm & xuất dữ liệu |        |            |
| M08-HT-10 | Đối chiếu liên phân hệ |         |            |
