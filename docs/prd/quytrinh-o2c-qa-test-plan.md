# Kế hoạch kiểm thử O2C

### Quy tắc trạng thái

| Trạng thái | Ý nghĩa | Khi dùng |
| --- | --- | --- |
| PASS | Kết quả khớp PRD và bằng chứng đầy đủ | Mọi bước của case đúng như mong đợi |
| FAIL | Có lệch PRD, thiếu control, sai dữ liệu, sai trạng thái, sai quyền, hoặc bằng chứng không đạt | Bất kỳ bước nào vi phạm |
| BLOCKED | Không thể chạy do hạ tầng, tài khoản, master data, mutation authorization, hoặc prerequisite chưa sẵn sàng | Chỉ khi nguyên nhân ngoài phạm vi test |

### Quy tắc toàn đợt chạy

1. Một đợt chạy chỉ được kết luận **PASS** khi mọi case bắt buộc đều PASS.
2. Nếu case gốc bị BLOCKED, mọi case phụ thuộc trực tiếp cũng BLOCKED.
3. Không được dùng SKIP để thay cho BLOCKED.
4. Không được báo PASS nếu còn case FAIL hoặc BLOCKED trong phạm vi bắt buộc.
5. Kết quả toàn đợt là tổng hợp của worksheet, ảnh chụp, defect log và sign-off cuối.

## 1. Thuật ngữ

| Thuật ngữ | Nghĩa dùng trong tài liệu |
| --- | --- |
| CUS | Nhân viên chứng từ |
| Điều phối / Dispatcher | Vai trò `/dispatch` |
| Shipment / Lô hàng | Hồ sơ nghiệp vụ từ Booking, tồn tại trước và có thể bao gồm nhiều chuyến |
| Fulfillment / Phần việc | Phần vận chuyển được rã từ lô; với FCL thường gắn với một container |
| Trip / Chuyến | Lần điều xe cụ thể, giữ xe, lái xe, thời gian và trạng thái thực tế |
| Driver | Lái xe, xem tại `/my-trips` |
| Ops / Forwarder | Nhân viên hiện trường, xem tại `/my-forwarder-trips` |
| e-POD | Bộ chứng từ giao nhận điện tử gắn với đúng trip và phiên bản hiện tại |
| POD giấy | Chứng từ gốc/mộc đỏ đã được thu hồi về văn phòng |
| Expense scope | Phạm vi kê khai chi phí chung hoặc riêng cho từng container; mọi scope đều phải hoàn tất |
| Debit Note / Giấy báo nợ | Chứng từ bàn giao số phải thu khách hàng từ dữ liệu đã chốt |
| AR | Công nợ phải thu `/debt` |
| AP | Công nợ phải trả `/payables` |
| P&L | Báo cáo lãi lỗ `/finance` |
| Maker / Checker / Approver | Người tạo / người kiểm tra / người phê duyệt |
| `NEW` / Mới tạo | Lô vừa được CUS tạo |
| `DISPATCHED` / Đã điều xe | Lệnh điều xe đã phát hành |
| `IN_TRANSIT` / Đang chạy | Driver đã nhận lệnh gốc và trip được kích hoạt |
| `PENDING_EXPENSE_APPROVAL` / Chờ duyệt phí | Vận hành đã bàn giao, mọi expense scope đã kê xong |
| `COMPLETED` / Hoàn thành | Đã qua e-POD/POD, chi phí và thao tác chốt trực tiếp của Kế toán hoặc CUS |
| `CANCELED` / Đã hủy | Nhánh kết thúc ngoại lệ có phê duyệt/hoàn tác khi cần; không nằm trong năm trạng thái tiến chuẩn |
| BLOCKED | Không thể kiểm thử vì điều kiện ngoài quyền của QA |

## 2. Môi trường và khởi tạo an toàn

### 2.3. Health endpoints

| Endpoint | Mục đích |
| --- | --- |
| `http://localhost:3001/api/health` | Kiểm tra backend sẵn sàng |
| `http://localhost:7174` | Mở frontend local |
| `https://vantai.tingting.vip/` | Frontend staging; chỉ dùng khi có mutation authorization |
| `https://vantai.tingting.vip/api/health` | Health staging |

### 2.4. Phiên kiểm thử

| Thiết lập | Giá trị bắt buộc |
| --- | --- |
| Cửa sổ desktop | 1440 × 900 |
| Cửa sổ mobile | 390 × 844 |
| Trình duyệt | Incognito / logout sạch |
| Múi giờ | `Asia/Ho_Chi_Minh` |
| Ảnh đính kèm | JPG hoặc PDF hợp lệ, dung lượng không quá 15 MiB |
| Ghi nhận thời gian | Dùng giờ thực tế của máy QA, không tự ước lượng |
| Chuyển vai trò | Logout hoàn toàn hoặc mở profile Incognito riêng; không dùng lại session cũ |

## 3. Tài khoản

### 3.1. Local seed

Mật khẩu local mặc định: `Abc123`.

| Username | Vai trò |
| --- | --- |
| `admin` | ADMIN |
| `giamdoc` | MANAGER |
| `ketoan` | ACCOUNTANT |
| `cus` | CLERK / CUS |
| `dieuvan` | DISPATCHER |
| `giaonhan` | FORWARDER / Ops |
| `laixe` | DRIVER |
| `thu` | DRIVER |
| `pho` | DRIVER |
| `quyet` | DRIVER |
| `customer` | CUSTOMER |

### 3.2. Staging

| Quy tắc | Nội dung |
| --- | --- |
| Mật khẩu | Lấy qua kênh bảo mật đã được duyệt |
| Dữ liệu mutation | Phải là dữ liệu dedicated đã được phê duyệt |
| Thay thế tài khoản | Không dùng `admin` để giả lập CUS, Điều phối, Ops, Driver hoặc Customer |
| Thiếu tài khoản đúng vai trò | Ghi **BLOCKED** |

## 4. Dữ liệu nền phải có trước khi chạy

### 4.1. Master-data preflight

Đọc và xác nhận các danh mục tối thiểu sau:

| Danh mục | Yêu cầu |
| --- | --- |
| Khách hàng | Có khách hàng đang hoạt động và có cấu hình chia sẻ phụ phí xăng dầu |
| Tuyến đường | Có ít nhất 1 tuyến hợp lệ |
| Bảng giá cước | Có giá theo Khách × Tuyến còn hiệu lực |
| Định mức nhiên liệu | Có định mức hợp lệ để tính phụ phí |
| Cấu hình giá dầu | Có giá dầu gốc và giá dầu hiện tại |
| Xe | Có cả `Xe nhà` và `Xe ngoài` |
| Tài xế | Có ít nhất 1 tài xế đang gán xe |
| Nhà cung cấp | Có NCC dầu và NCC cước xe ngoài |
| Bảng giá nâng/hạ | Có ma trận theo Cảng + cỡ cont + Hàng/Rỗng |

### 4.2. Điều kiện master data

Nếu thiếu bất kỳ mục nào ở trên, case phụ thuộc vào dữ liệu đó phải chuyển **BLOCKED** cho tới khi dữ liệu được tạo hoặc sửa đúng.

### 4.3. Bộ dữ liệu cho một run

Tạo `RUN_ID = MAN-O2C-<YYYYMMDD-HHMMSS>-<initials>` và dùng RUN_ID trong Booking, BL, ghi chú, tên file. Không tái sử dụng dữ liệu của run cũ.

| Dữ liệu | Giá trị cần chuẩn bị/ghi lại |
| --- | --- |
| Lô FCL chính | Booking `BK-<RUN_ID>-FCL`; BL `BL-<RUN_ID>-FCL`; 2 container khác nhau; dùng Xe nhà |
| Lô LCL đối chứng | Booking `BK-<RUN_ID>-LCL`; BL `BL-<RUN_ID>-LCL`; có bao bì, số lượng, kg, CBM; dùng Xe ngoài |
| Container/Seal | `CONT-<RUN_ID>-01/02`; `SEAL-<RUN_ID>-01/02` |
| e-POD FCL | `yard-drop-<RUN_ID>-fcl-01.jpg`; `signed-delivery-<RUN_ID>-fcl-01.pdf`; `yard-drop-<RUN_ID>-fcl-02.jpg`; `signed-delivery-<RUN_ID>-fcl-02.pdf` |
| e-POD LCL | `yard-drop-<RUN_ID>-lcl-01.jpg`; `signed-delivery-<RUN_ID>-lcl-01.pdf` |
| Ảnh vận hành | `fuel-<RUN_ID>.jpg`; `container-<RUN_ID>.jpg`; `seal-<RUN_ID>.jpg` |
| Tạm ứng | Một khoản đã duyệt **lớn hơn** khoản phí sẽ duyệt để kiểm tra số dư còn lại |
| Giá nâng/hạ | Ghi trước Cảng/Bãi, loại container, `Hàng/Rỗng`, chiều `Nâng/Hạ`, ngày hiệu lực và đơn giá master |
| Cặp kẹp hàng | Hai trip Xe nhà cùng xe + cùng driver, thời gian không chồng lấn, đủ điều kiện chạy hai chiều |

Ghi các ID/phiên bản ngay khi hệ thống sinh: `shipmentId`, `fulfillmentId`, `tripId`, `podSubmissionId`, `podSubmissionVersion`, `billingDocumentId` và trạng thái trước/sau mỗi thao tác. Chỉ ghi `governanceActionId`/`governanceActionVersion` khi kiểm thử workflow ngoại lệ được phê duyệt, không dùng cho close O2C chuẩn. Nếu UI không hiển thị ID/version, ghi URL và mã nghiệp vụ nhìn thấy; không dùng DevTools/API để tự bù hành vi UI.

## 5. Dẫn đường UI hiện hành

Các route/label sau chỉ dùng để tìm màn hình. Nếu label thực tế lệch, vẫn kiểm theo PRD.

| Vai trò | Route | Dẫn đường UI hiện hành |
| --- | --- | --- |
| CUS | `/clerk/shipments/new` | `Tạo lô hàng mới`, `Lưu bản nháp`, `Gửi sang điều phối` |
| Dispatcher | `/dispatch` | `Điều phối chuyến xe`, `Tiếp nhận`, `Phát hành lệnh điều xe` |
| Driver | `/my-trips` | Bốn milestone nghiệp vụ và nút `Gửi chờ duyệt phí` |
| Ops | `/my-forwarder-trips` | `Chi phí phát sinh`, `Thêm`, `Đã kê xong` |
| e-POD panel | `/shipments/:id` | Bảng e-POD của lô/chuyến |
| Governance | `/governance-actions` | `Trung tâm phê duyệt` |
| AR | `/debt` | Công nợ phải thu |
| AP | `/payables` | Công nợ phải trả |
| P&L | `/finance` | Báo cáo lãi lỗ |

## 6. Bằng chứng và worksheet

### 6.1. Tên run register

Tạo file run register theo mẫu:

```text
MAN-O2C-<YYYYMMDD-HHMMSS>-<initials>
```

Trong run register phải ghi:

| Trường | Nội dung bắt buộc |
| --- | --- |
| Run ID | Theo mẫu trên |
| Người chạy | Tên viết tắt hoặc chữ ký QA |
| Môi trường | Local hoặc staging |
| Thiết bị | Desktop hoặc mobile |
| Case ID | TC-MO2C-xx |
| Entity IDs | ID lô, chuyến, yêu cầu, chi phí, POD, chứng từ |
| Version | Version hiện tại của entity khi thao tác |
| Status | Trạng thái trước và sau thao tác |
| Bằng chứng | Đường dẫn ảnh / log / PDF / workbook |

Không dùng `SEED-SHIP` hoặc bất kỳ container ID E2E cố định nào; chỉ ghi entity ID sinh tại run hiện tại.

### 6.2. Quy tắc ghi bằng chứng

| Loại | Quy tắc |
| --- | --- |
| Ảnh chụp | Chụp rõ route, label, trạng thái, thông báo lỗi hoặc thông báo thành công |
| Workbook | Chỉ dùng cho worksheet đối chiếu cuối đợt |
| Defect log | Có Case ID, bước lỗi, PRD expected, actual, severity, bằng chứng |
| Cleanup | Ghi rõ dữ liệu đã tạo, đã xoá, đã hoàn tác hoặc đã để lại |
| Sign-off | Chỉ ký khi đợt chạy không còn FAIL/BLOCKED bắt buộc |

Lưu artifact theo mẫu `qa/<YYYY-MM-DD>_o2c-manual_<case-id>.<ext>`, ví dụ `qa/2026-08-02_o2c-manual_tc-mo2c-05.png`. Không chụp token, cookie, mật khẩu, Authorization header hoặc thông tin riêng tư ngoài dữ liệu test. Nếu QA không có quyền ghi repository, đóng gói cùng cấu trúc tên này thành file ZIP và ghi vị trí bàn giao trong run register.

### 6.3. Mẫu defect

| Trường | Nội dung |
| --- | --- |
| Case ID | Mã case gốc |
| Môi trường | Local / staging |
| Tài khoản | Username và vai trò |
| Thiết bị | Desktop hoặc mobile |
| Quan sát | Điều gì xảy ra |
| PRD kỳ vọng | Điều gì phải xảy ra theo PRD |
| Mức độ | P0 / P1 / P2 |
| Bằng chứng | Ảnh, log, workbook, đường dẫn |

### 6.4. Mức độ lỗi

| Mức | Diễn giải |
| --- | --- |
| P0 | Chặn nghiệp vụ, sai sổ sách, lộ dữ liệu nhạy cảm, hoàn thành sai điều kiện |
| P1 | Luồng chính hỏng, không thể đi tiếp |
| P2 | Sai nhãn, sai thông báo, sai định dạng, lỗi biên |

### 6.5. Checklist đóng run

1. Xác nhận mọi case bắt buộc đã có trạng thái rõ ràng.
2. Ghi defect cho mọi FAIL.
3. Ghi BLOCKED riêng cho các prerequisite ngoài phạm vi QA.
4. Dọn dữ liệu test theo quyền cho phép.
5. Chốt worksheet, ảnh, workbook, và sign-off.

## 7. Luồng kiểm thử O2C

### Quy ước chạy

- Chạy theo thứ tự từ `TC-MO2C-00`.
- Không nhảy case trừ khi case đó có dependency đã PASS.
- Route UI lệch PRD không làm thay đổi kỳ vọng.
- Nếu case trước FAIL hoặc BLOCKED, case sau phụ thuộc phải BLOCKED.

### TC-MO2C-00 — Preflight nguồn sự thật và quyền thao tác

| Trường | Nội dung |
| --- | --- |
| Vai trò | QA, không cần quyền sản phẩm |
| Tiền điều kiện | Đã đọc Mục 0–6 của chính tài liệu này |
| Hành động | 1. Ghi người chạy, môi trường và `RUN_ID`. 2. Xác nhận chính sách PASS/FAIL/BLOCKED. 3. Xác nhận staging chỉ được mutation khi có phê duyệt. 4. Xác nhận không dùng hành vi hiện tại của app để sửa kỳ vọng. |
| PRD kỳ vọng | PRD là thẩm quyền; route/label chỉ là dẫn đường |
| FAIL nếu | Dùng route/label làm thẩm quyền, hoặc tự đổi kỳ vọng theo hành vi app |
| Bằng chứng | Run register có người chạy, môi trường, RUN_ID và xác nhận thẩm quyền |
| Phụ thuộc | Không |

### TC-MO2C-01 — Khởi tạo local, health check, account matrix

| Trường | Nội dung |
| --- | --- |
| Vai trò | QA local |
| Tiền điều kiện | Có quyền chạy shell local |
| Hành động | 1. Terminal 1: chạy `make infra && make migrate && make seed` và ghi exit status. 2. Terminal 2: chạy `make dev`. 3. Mở `http://localhost:3001/api/health`. 4. Đăng nhập lần lượt bằng đúng tài khoản CUS, Dispatcher, Driver, Ops, Accountant, Manager, Admin và Customer ở Mục 3.1; logout sạch giữa các vai trò. |
| PRD kỳ vọng | Migration/seed thành công; health trả trạng thái khỏe; từng tài khoản vào đúng surface và đúng vai trò |
| FAIL nếu | Migration hoặc seed của repo lỗi; thiếu account; health vẫn không lên sau khi stack đã khởi động; tài khoản vào sai vai trò; phải dùng `make setup` để né lỗi |
| BLOCKED nếu | Docker/Postgres hoặc hạ tầng máy QA không thể khởi động vì nguyên nhân ngoài sản phẩm |
| Bằng chứng | Log có command + exit status; ảnh health; ảnh tên vai trò sau mỗi lần đăng nhập |
| Phụ thuộc | TC-MO2C-00 |

### TC-MO2C-02 — Master-data preflight và worksheet run ID

| Trường | Nội dung |
| --- | --- |
| Vai trò | QA hoặc người chuẩn bị dữ liệu |
| Tiền điều kiện | Local seed hoặc staging có quyền đọc master data |
| Hành động | 1. Kiểm từng dòng Mục 4.1 và ghi tên/ID bản ghi sẽ dùng. 2. Chuẩn bị giá trị đầu vào cho hai lô theo Mục 4.3; chưa tạo lô trong app. 3. Tạo run register. 4. Ghi trạng thái preflight và đường dẫn bằng chứng. |
| PRD kỳ vọng | Có đủ dữ liệu nền dùng được; FCL và LCL có mã duy nhất; worksheet sẵn cột ID/version/status/evidence |
| FAIL nếu | Thiếu bất kỳ danh mục bắt buộc nào mà vẫn đẩy case phụ thuộc sang PASS |
| BLOCKED nếu | Dữ liệu chủ chưa được cấp quyền tạo hoặc không có tài khoản đúng vai trò |
| Bằng chứng | Screenshot danh mục, run register |
| Phụ thuộc | TC-MO2C-01 |

### TC-MO2C-03 — CUS tạo FCL và LCL, cước và fuel read-only

| Trường | Nội dung |
| --- | --- |
| Vai trò | CUS |
| Tiền điều kiện | Có khách, tuyến, bảng giá cước, fuel config, route dẫn đường `/clerk/shipments/new` |
| Hành động | 1. Đăng nhập `cus`, mở `/clerk/shipments/new`. 2. Tạo lô FCL với Booking/BL và 2 container/seal ở Mục 4.3; lưu bằng `Lưu bản nháp`. 3. Đối chiếu từng trường với bộ chứng từ chuẩn bị. 4. Ghi cước master, giá dầu gốc/hiện tại, số lít định mức và tỷ lệ chia sẻ; tính tay `phụ phí = (giá hiện tại − giá gốc) × số lít định mức × tỷ lệ chia sẻ`. 5. Tạo lô LCL đối chứng, nhập kho lấy hàng, loại bao bì, số lượng, kg, CBM và ghi chú; lưu nháp. 6. Mở lại cả hai lô và ghi `shipmentId`/trạng thái. |
| PRD kỳ vọng | FCL và LCL hiển thị đúng bộ trường; cước dự kiến tự lấy theo Khách × Tuyến; phụ phí xăng dầu tự tính đúng công thức; giá read-only; cả hai lô là `NEW/Mới tạo` |
| FAIL nếu | Thiếu trường FCL/LCL; không có cước hoặc phụ phí hiển thị; cho gõ tay giá; công thức sai; dữ liệu mở lại sai; lô nháp không ở `NEW` |
| Bằng chứng | Ảnh form FCL/LCL; ảnh giá read-only; phép tính tay; ảnh detail và hai shipment ID |
| Phụ thuộc | TC-MO2C-02 |

### TC-MO2C-04 — Điều phối own/external, handoff, conflict

| Trường | Nội dung |
| --- | --- |
| Vai trò | CUS, sau đó Dispatcher |
| Tiền điều kiện | Hai lô `Mới tạo`; có xe nhà, xe ngoài và tài xế phù hợp |
| Hành động | 1. CUS mở FCL và LCL, bấm `Gửi sang điều phối`; xác nhận không còn ở nháp. 2. Đăng nhập `dieuvan`, mở `/dispatch`, bấm `Tiếp nhận`. 3. Rã FCL thành đúng 2 fulfillment/container và kiểm tra dữ liệu gán nháp đi theo từng dòng. 4. Gán FCL cho Xe nhà; gán LCL cho Xe ngoài. 5. Thử gán cùng xe nhà cho một chuyến trùng thời gian. 6. Sau khi thấy xung đột bị chặn, sửa về thời gian/xe hợp lệ và bấm `Phát hành lệnh điều xe`. 7. Ghi fulfillment/trip ID, tag xe và trạng thái. |
| PRD kỳ vọng | Handoff CUS → Điều phối rõ ràng; FCL rã đúng 2 dòng; lệnh hợp lệ được phát; xung đột xe bận bị chặn; tag `Xe nhà`/`Xe ngoài` theo đúng trip; shipment chuyển `DISPATCHED/Đã điều xe` |
| FAIL nếu | Điều phối nhìn thấy lô chưa gửi; rã sai số dòng; không chặn xe bận; sai tag; thiếu push/in-app lệnh cho Driver; phát lệnh khi thiếu quyền hoặc shipment không sang `DISPATCHED` |
| BLOCKED nếu | Chưa có xe/tài xế phù hợp để kiểm thử conflict |
| Bằng chứng | Ảnh trước/sau handoff; ảnh gộp/rã; ảnh conflict; ảnh lệnh đã phát; entity IDs và trạng thái |
| Phụ thuộc | TC-MO2C-03 |

### TC-MO2C-05 — Driver nhận lệnh, kích hoạt, 4 milestone

| Trường | Nội dung |
| --- | --- |
| Vai trò | Driver |
| Tiền điều kiện | Lô đã được điều phối sang driver; route `/my-trips` |
| Hành động | 1. Đăng nhập driver được gán, mở `/my-trips`; xác nhận lệnh mới có đúng Booking/BL, xe, container và thời gian. 2. Khi trip còn `CREATED`, bấm `Đã nhận lệnh gốc` (`ORDER_RECEIVED`) và ghi timestamp/version; không nhờ Manager/Admin kích hoạt trước. 3. Bấm lần lượt `Đã lấy vỏ / Lấy hàng` (`PICKED_UP`), `Đang đóng / Trả hàng` (`LOADING_OR_RETURNING`), `Đã hạ bãi / Giao hàng xong` (`DELIVERED`). 4. Thử bấm milestone kế tiếp trước thứ tự trên một trip đối chứng. |
| PRD kỳ vọng | `ORDER_RECEIVED` do chính Driver thực hiện kích hoạt trip từ `CREATED` sang `IN_TRANSIT`; bốn milestone lưu đúng một lần, đúng thứ tự, có timestamp/audit; shipment sang `IN_TRANSIT`; hoàn tất vận hành chưa tự biến O2C thành `COMPLETED` |
| FAIL nếu | Driver không thấy lệnh; Driver không thể tự kích hoạt; phải dùng Manager/Admin kích hoạt; milestone đảo thứ tự/ghi trùng; trạng thái hoặc timestamp sai; trip hoàn thành tài chính quá sớm |
| Bằng chứng | Ảnh trước và sau từng milestone; timestamp; trip/shipment version và audit hiển thị |
| Phụ thuộc | TC-MO2C-04 |

### TC-MO2C-06 — Driver expenses, fuel, container-seal

| Trường | Nội dung |
| --- | --- |
| Vai trò | Driver |
| Tiền điều kiện | Trip đang chạy |
| Hành động | 1. Trên trip FCL, nhập tiền đường thực tế riêng theo container. 2. Ghi nhận nhiên liệu; tải `fuel-<RUN_ID>.jpg`; kiểm tra số lít/đơn giá được bóc tách và vị trí EXIF được đối chiếu hoặc cảnh báo. 3. Ghi số container/seal và tải ảnh container/seal. 4. Kiểm tra dữ liệu vẫn đúng sau refresh. 5. Chưa bấm nút chốt tài chính ở case này. |
| PRD kỳ vọng | Driver có control nghiệp vụ để ghi tiền đường, nhiên liệu, container/seal và ảnh; chi phí gắn đúng trip/container; ảnh nhiên liệu phục vụ chống gian lận; dữ liệu tồn tại sau refresh |
| FAIL nếu | Thiếu bất kỳ control PRD nào; chi phí trộn giữa container; cho lưu thiếu ảnh bắt buộc; không có bóc tách/đối chiếu nhiên liệu; dữ liệu mất sau refresh |
| Bằng chứng | Ảnh từng control; ảnh trước/sau refresh; số tiền và file name trong worksheet |
| Phụ thuộc | TC-MO2C-05 |

### TC-MO2C-07 — e-POD hai slot và bàn giao vận hành

| Trường | Nội dung |
| --- | --- |
| Vai trò | Driver |
| Tiền điều kiện | Trip đang `IN_TRANSIT`, đã hoàn tất milestone vận hành |
| Hành động | 1. Lặp lại cho từng fulfillment FCL và trip LCL. Mở `e-POD bắt buộc`. 2. Chỉ tải `Phiếu bãi / phiếu hạ`, thử bấm `Gửi e-POD` và xác nhận bị chặn vì thiếu hồ sơ. 3. Tải thêm `Biên bản giao nhận có ký nhận`; vé cầu đường là tùy chọn. 4. Bấm `Gửi e-POD`. 5. Ghi submission ID/version/status và mở `/shipments/:id` để xác nhận đúng trip/fulfillment. |
| PRD kỳ vọng | Mỗi fulfillment/trip có hai slot bắt buộc là `Phiếu bãi / phiếu hạ` và `Biên bản giao nhận có ký nhận`; thiếu một slot không gửi được; đủ hai slot thì trạng thái `SUBMITTED/Đã gửi duyệt`; e-POD neo đúng trip, fulfillment và phiên bản hiện tại |
| FAIL nếu | Bất kỳ fulfillment/trip nào thiếu một file vẫn gửi được; sai loại file; submission gắn sai trip; không có version/history; submit tự duyệt hoặc tự hoàn thành trip |
| Bằng chứng | Ảnh chặn khi thiếu file, hai slot, status/version và binding ở shipment detail cho từng fulfillment/trip |
| Phụ thuộc | TC-MO2C-05 |

### TC-MO2C-08 — Ops nâng/hạ, hóa đơn/thay thế, offset tạm ứng, chia scope

| Trường | Nội dung |
| --- | --- |
| Vai trò | Ops / Forwarder |
| Tiền điều kiện | Có trip có container; route `/my-forwarder-trips`; có bảng giá nâng/hạ |
| Hành động | 1. Đăng nhập `giaonhan`, mở `/my-forwarder-trips`, chọn trip FCL và `Chi phí phát sinh` → `Thêm`. 2. Chọn đúng Cảng/Bãi + loại container + `Hàng/Rỗng` + chiều `Nâng/Hạ` + ngày hiệu lực; so đơn giá read-only với master đã ghi ở Mục 4.3. 3. Tạo một khoản CÓ hóa đơn và tải hóa đơn. 4. Tạo một khoản KHÔNG hóa đơn, nhập số tiền/ngày/người nhận/lý do và ít nhất một chứng từ thay thế hợp lệ. 5. Tạo scope chung và scope riêng cho từng container; lần lượt bấm `Đã kê xong`. 6. Trước khi duyệt, ghi số dư tạm ứng đã duyệt lớn hơn khoản chi. 7. Đăng nhập `ketoan`, duyệt khoản chi; đối chiếu bút toán cấn trừ bằng đúng khoản được duyệt và số dư tạm ứng còn lại. 8. Khi mọi scope hoàn tất, ghi hành động bàn giao do UI hiện hành cung cấp (nếu có) hoặc ghi rõ nếu trạng thái tự chuyển; xác nhận shipment chỉ sang `PENDING_EXPENSE_APPROVAL/Chờ duyệt phí` sau khi đủ scope. |
| PRD kỳ vọng | Giá nâng/hạ tự áp theo đủ khóa master và không gõ tay; chứng từ CÓ/KHÔNG hóa đơn tách đúng; mọi scope độc lập; duyệt phí tự cấn trừ đúng số tiền, không vượt số dư, giữ residual chính xác; đủ scope mới sang `PENDING_EXPENSE_APPROVAL/Chờ duyệt phí` |
| FAIL nếu | Giá cho nhập tay/sai khóa/sai ngày; thiếu bằng chứng vẫn lưu; scope trộn hoặc bỏ sót; cấn trừ sai/overdraw; thiếu scope vẫn gửi; trạng thái cuối sai |
| BLOCKED nếu | Thiếu bảng giá nâng/hạ hoặc chưa có quyền vào màn Ops |
| Bằng chứng | Ảnh khóa giá + đơn giá; ảnh hai nhóm chứng từ; ảnh từng scope; số dư/bút toán trước-sau; trạng thái shipment |
| Phụ thuộc | TC-MO2C-06 |

### TC-MO2C-09 — Paired toll once và expense group exactness

| Trường | Nội dung |
| --- | --- |
| Vai trò | Dispatcher / Ops / QA đối chiếu |
| Tiền điều kiện | Hai lệnh Xe nhà cùng xe, cùng driver, cùng lộ trình hai chiều, không chồng thời gian |
| Hành động | 1. Điều phối tích `Kẹp hàng` cho đúng cặp. 2. Ghi định mức VETC từng lệnh trước khi ghép. 3. Phát hai lệnh và mở chi phí dự kiến/thực tế. 4. Đối chiếu tổng phí đường của nhóm và từng trip; kiểm tra nhật ký liên kết cặp. 5. Tạo một cặp không đủ điều kiện để xác nhận không tự ghép. |
| PRD kỳ vọng | Cặp hợp lệ chỉ ghi một lần định mức phí đường khép kín; lệnh thứ hai mang khoản giảm/điều chỉnh rõ ràng; doanh thu, trạng thái và chi phí khác vẫn độc lập; cặp không đủ điều kiện không được ưu đãi |
| FAIL nếu | Tổng phí bị nhân đôi; người dùng phải sửa tay; ghép sai xe/driver/thời gian; một lệnh mất doanh thu/trạng thái độc lập |
| Bằng chứng | Ảnh tích kẹp; hai trip ID; phí từng dòng và tổng nhóm; ảnh cặp không hợp lệ bị chặn |
| Phụ thuộc | TC-MO2C-04, TC-MO2C-08 |

### TC-MO2C-10 — Negative close trước khi duyệt e-POD/POD giấy

| Trường | Nội dung |
| --- | --- |
| Vai trò | Kế toán hoặc CUS |
| Tiền điều kiện | Shipment `PENDING_EXPENSE_APPROVAL`; e-POD mới ở `SUBMITTED`; chưa xác nhận POD giấy |
| Hành động | 1. Mở shipment và ghi trạng thái/version. 2. Dùng `ketoan` hoặc `cus` thử bấm `Hoàn thành` trực tiếp khi e-POD chưa `ACCEPTED`. 3. Nếu UI cho đi tiếp, tiếp tục bỏ chọn `Đã thu hồi chứng từ gốc` và thử xác nhận. 4. Refresh và ghi trạng thái sau thử nghiệm. |
| PRD kỳ vọng | Hệ thống chặn thao tác hoàn thành trực tiếp và nêu đúng điều kiện thiếu; shipment vẫn `PENDING_EXPENSE_APPROVAL`; không phát sinh snapshot/ledger/Debit Note |
| FAIL nếu | Chuyển `COMPLETED`; sinh AR/AP/P&L; hoặc chặn nhưng đã ghi dữ liệu tài chính một phần |
| Bằng chứng | Ảnh thông báo chặn; trạng thái/version trước-sau; ảnh AR/AP không có run ID |
| Phụ thuộc | TC-MO2C-07, TC-MO2C-08 |

### TC-MO2C-11 — Duyệt e-POD và xác nhận POD giấy

| Trường | Nội dung |
| --- | --- |
| Vai trò | Accountant và CUS |
| Tiền điều kiện | e-POD `SUBMITTED`; hai file bắt buộc tải được; POD giấy đã thực sự về văn phòng |
| Hành động | 1. Đăng nhập `ketoan`, mở `/shipments/:id` → `e-POD & điều kiện hoàn thành lô hàng`; tải và đối chiếu từng file. 2. Bấm `Duyệt e-POD`; xác nhận hộp thoại `Đã thu hồi chứng từ gốc (POD mộc đỏ)`. 3. Nếu Accountant bị 403/không có action, ghi defect **FAIL** vì PRD cấp quyền; sau đó dùng CUS được PRD cho phép để tiếp tục dữ liệu downstream. 4. Ghi reviewer, thời gian, submission version và `ACCEPTED`. 5. Thử xử lý lại cùng version ở tab thứ hai; phải bị từ chối. 6. Trên dữ liệu đối chứng, từ chối e-POD có lý do và xác nhận Driver phải tạo phiên bản mới. |
| PRD kỳ vọng | Accountant hoặc CUS đều có quyền review theo PRD; chỉ current submission đủ hồ sơ được `ACCEPTED`; xác nhận POD giấy là riêng biệt nhưng bắt buộc; replay/stale version bị chặn; từ chối giữ lịch sử và buộc bản mới |
| FAIL nếu | Accountant bị từ chối quyền; không cần xác nhận POD giấy; duyệt thiếu file; xử lý kép; thay thế version làm mất lịch sử; reviewer/timestamp không lưu |
| Bằng chứng | Ảnh file review; hộp thoại POD giấy; status/reviewer/version; ảnh stale/replay bị chặn; lịch sử bản bị từ chối |
| Phụ thuộc | TC-MO2C-10 |

### TC-MO2C-12 — Kế toán/CUS chốt trực tiếp

| Trường | Nội dung |
| --- | --- |
| Vai trò | Kế toán hoặc CUS |
| Tiền điều kiện | POD hợp lệ, e-POD hợp lệ, expense scope đủ, mọi file bắt buộc đã có |
| Hành động | 1. Xác nhận lại trip đang `IN_TRANSIT`, shipment `PENDING_EXPENSE_APPROVAL`, current e-POD `ACCEPTED`, POD giấy đã xác nhận, mọi scope hoàn tất, ảnh container + seal hiện diện. 2. Đăng nhập `ketoan` hoặc `cus`, chọn VAT và bấm `Hoàn thành` trực tiếp trên lô. 3. Refresh mọi màn liên quan và ghi người thao tác, thời điểm, VAT, shipment/trip ID cùng trạng thái trước/sau. 4. Kiểm tra chỉ một lần chuyển `COMPLETED` và chỉ một snapshot/ledger/posting tài chính được tạo. |
| PRD kỳ vọng | Kế toán hoặc CUS được chốt trực tiếp khi mọi gate đúng; không cần yêu cầu ở `/governance-actions`, Giám đốc hoặc Admin; trip và shipment chuyển `COMPLETED` đúng một lần; audit và posting tài chính chỉ sinh một lần |
| FAIL nếu | Bắt buộc chuỗi phê duyệt ba người hoặc `/governance-actions`; Kế toán/CUS không có action; thiếu ảnh/scope/POD vẫn hoàn thành; double posting; trip hoặc shipment sai trạng thái |
| Bằng chứng | Ảnh điều kiện close; actor/thời điểm/VAT; trạng thái `COMPLETED`; shipment/trip ID; snapshot/ledger/posting ID |
| Phụ thuộc | TC-MO2C-11 |

### TC-MO2C-13 — Debit Note export

| Trường | Nội dung |
| --- | --- |
| Vai trò | Kế toán |
| Tiền điều kiện | Trip đã hoàn thành theo PRD |
| Hành động | 1. Đăng nhập `ketoan`, mở `/debt`. 2. Chọn đúng khách hàng và chu kỳ chứa trip FCL đã hoàn thành. 3. Tạo preview/draft, xác nhận chỉ trip đủ điều kiện được chọn. 4. Lưu Debit Note và ghi `billingDocumentId`. 5. Export XLSX. 6. Mở workbook, tìm Booking/BL/RUN_ID, trip ID, doanh thu, VAT và tổng sau VAT; đối chiếu với snapshot close. |
| PRD kỳ vọng | Chỉ trip `COMPLETED` có current e-POD `ACCEPTED` được bill; không claim trùng; workbook mở được và chứa đúng run ID/trip/số tiền/VAT/tổng |
| FAIL nếu | Trip chưa đủ điều kiện xuất hiện; trip bị trùng; export lỗi/trống; sai Booking/BL/trip/số tiền/VAT; không truy ngược được nguồn |
| Bằng chứng | Ảnh builder; billingDocumentId; file XLSX; worksheet đối chiếu |
| Phụ thuộc | TC-MO2C-12 |

### TC-MO2C-14 — Snapshot AR / AP / P&L

| Trường | Nội dung |
| --- | --- |
| Vai trò | Kế toán / Giám đốc |
| Tiền điều kiện | Có trip `COMPLETED` |
| Hành động | 1. Ghi doanh thu, VAT, tổng AR, chi phí, AP và lợi nhuận tại thời điểm close. 2. Mở `/debt`, `/payables`, `/finance`, lọc theo RUN_ID/khách/kỳ. 3. Đối chiếu FCL Xe nhà và LCL Xe ngoài. 4. Xác nhận Xe ngoài có AP NCC/chủ xe phù hợp; Xe nhà không bị ghi như xe ngoài. 5. Cộng hai nhóm và so với tổng kỳ. |
| PRD kỳ vọng | Snapshot AR/AP/P&L sinh đúng một lần tại `COMPLETED`; nguồn ID truy ngược được; doanh thu − chi phí = lợi nhuận; Xe nhà/Xe ngoài tách đúng; tổng nhóm khớp tổng kỳ |
| FAIL nếu | Thiếu/trùng snapshot; lệch số/VAT; sai carrier tag; AP sai NCC; P&L không tách; không truy ngược nguồn |
| Bằng chứng | Ảnh ba màn; source IDs; worksheet số trước/sau close và công thức |
| Phụ thuộc | TC-MO2C-13 |

### TC-MO2C-15 — Cờ điều chỉnh sau hoàn thành

| Trường | Nội dung |
| --- | --- |
| Vai trò | Kế toán |
| Tiền điều kiện | Trip đã hoàn thành và đã có snapshot |
| Hành động | 1. Chọn một chi phí đã duyệt; ghi giá trị và snapshot hiện tại. 2. Thử sửa trực tiếp bản đã duyệt và xác nhận bị chặn. 3. Tạo yêu cầu điều chỉnh hoặc hoàn tác qua workflow được cấp quyền, bắt buộc nhập lý do; nếu thay đổi tiền, dùng checker/approver khác maker. 4. Sau phê duyệt, mở lại expense, AR/AP và audit. |
| PRD kỳ vọng | Nghiệp vụ không bị khóa cứng vĩnh viễn, nhưng dữ liệu đã duyệt không được ghi đè trực tiếp; điều chỉnh lưu before/after, lý do, actor/version và approval; snapshot cũ giữ nguyên, có cờ cần đối soát và giá trị điều chỉnh liên kết |
| FAIL nếu | Không có workflow điều chỉnh/hoàn tác; cho ghi đè trực tiếp; mất lịch sử; không có cờ; snapshot cũ bị đổi âm thầm; actor không độc lập khi thay đổi tiền |
| Bằng chứng | Ảnh direct-edit bị chặn; yêu cầu điều chỉnh; audit before/after; cờ reconciliation; snapshot cũ và giá trị mới |
| Phụ thuộc | TC-MO2C-14 |

### TC-MO2C-16 — Hủy chuyến, double-submit, concurrency

| Trường | Nội dung |
| --- | --- |
| Vai trò | Admin / người có quyền xử lý ngoại lệ |
| Tiền điều kiện | Có một trip chưa hoàn thành để test hủy và một entity có version để test cạnh tranh |
| Hành động | 1. Thử hủy trực tiếp trip và xác nhận phải qua quyền/lý do/hoàn tác phù hợp. 2. Với fulfillment đã hủy, chọn đúng một disposition: liên kết trip thay thế hoặc phê duyệt `Không còn bắt buộc`; xác nhận không thể đóng khi chưa xử lý. 3. Double-click cùng action close/approve. 4. Mở hai tab cùng version, lưu tab A rồi lưu tab B. 5. Thử hủy trip `COMPLETED`. |
| PRD kỳ vọng | Hủy giữ audit và xử lý dữ liệu liên quan; fulfillment hủy phải được thay thế/miễn trừ rõ; double-submit chỉ tạo một hiệu ứng; tab stale nhận conflict và phải tải lại; trip completed không bị hủy/ghi đè trực tiếp |
| FAIL nếu | Tạo bản ghi/ledger kép; stale write thắng; hủy không lý do/không audit; đóng khi cancellation unresolved; completed bị xóa hoặc đổi âm thầm |
| Bằng chứng | Ảnh reason/disposition; conflict; một action/posting ID; trạng thái và audit sau hủy |
| Phụ thuộc | TC-MO2C-15 |

### TC-MO2C-17 — RBAC, security, create-only và xóa theo session

| Trường | Nội dung |
| --- | --- |
| Vai trò | CUS, Dispatcher, Ops, Driver, Accountant, Manager, Admin, Customer |
| Tiền điều kiện | Đăng nhập từng vai trò |
| Hành động | 1. Với từng tài khoản, logout sạch rồi đăng nhập. 2. Thử mở trực tiếp `/debt`, `/payables`, `/finance`, `/dispatch`, `/my-trips`, `/my-forwarder-trips`, `/governance-actions` ngoài quyền. 3. Xác nhận Dispatcher/Ops/Driver/CUS không thấy lợi nhuận, giá vốn, lương, hoa hồng hoặc định mức nhạy cảm. 4. Xác nhận Customer chỉ thấy dữ liệu thuộc chính khách đó. 5. Tạo một bản ghi create-only, thử xóa trong cùng session; logout/login rồi thử xóa bản ghi phiên cũ. 6. Thử xóa chi phí/chứng từ đã duyệt. |
| PRD kỳ vọng | Menu và direct URL/API đều cùng chặn; scope dữ liệu theo vai trò/khách; dữ liệu nhạy cảm chỉ cho Manager/Accountant/Admin; create-only chỉ xóa sai sót chưa duyệt trong session hiện tại; phiên cũ/đã duyệt phải qua phê duyệt hoặc không cho xóa |
| FAIL nếu | Chỉ ẩn menu nhưng URL vẫn mở; lộ dữ liệu nhạy cảm; Customer xem dữ liệu khách khác; cho sửa/xóa sai quyền/session; dùng admin thay vai trò thật |
| Bằng chứng | Ma trận role × route/action; ảnh menu và direct URL; ảnh delete allow/deny; username/role nhìn thấy |
| Phụ thuộc | TC-MO2C-14 |

### TC-MO2C-18 — Desktop và mobile surface

| Trường | Nội dung |
| --- | --- |
| Vai trò | QA |
| Tiền điều kiện | Có thể chạy 1440×900 và 390×844 |
| Hành động | 1. Ở 1440×900 và 390×844, chạy tối thiểu các surface: tạo lô, dispatch gộp/rã, driver milestones + e-POD, Ops expense scopes, shipment e-POD review, governance, Debit Note, AR, AP và P&L. 2. Kiểm tra không cuộn ngang toàn trang; bảng dài có vùng cuộn hợp lý. 3. Kiểm tra primary action luôn nhìn thấy/đến được, label wrap đọc đủ, modal không vượt viewport, bàn phím không che input. 4. Đo các control chạm chính tối thiểu 44×44 px. 5. Lặp bằng đúng role sở hữu surface. |
| PRD kỳ vọng | Mọi chức năng O2C dùng được ở desktop/mobile; không mất capability; không overflow; touch target đạt 44 px; nội dung tiếng Việt đọc đủ; quyền nhất quán ở hai viewport |
| FAIL nếu | Tràn ngang; nút/action bị mất/che; touch target nhỏ; label cắt; modal không dùng được; mobile thiếu chức năng desktop ngoài khác biệt quyền đã duyệt |
| Bằng chứng | Cặp ảnh desktop/mobile cho từng surface; viewport ghi trong tên/worksheet; note đo touch target |
| Phụ thuộc | TC-MO2C-04 đến TC-MO2C-17 tùy vai trò |

### TC-MO2C-19 — Reconciliation worksheet và final sign-off

| Trường | Nội dung |
| --- | --- |
| Vai trò | QA lead / người ký nghiệm thu |
| Tiền điều kiện | Đã có run register `MAN-O2C-...` và mọi case bắt buộc đã chạy |
| Hành động | 1. Hoàn tất result register ở Mục 9.1. 2. Hoàn tất đối chiếu năm điểm ở Mục 9.2 cho FCL chính và LCL đối chứng. 3. Kiểm tra tổng doanh thu, chi phí, VAT, AR, AP, lợi nhuận và source IDs. 4. Kiểm tra mọi FAIL có defect; mọi BLOCKED có owner gỡ chặn. 5. Ghi cleanup và sign-off ở Mục 10. |
| PRD kỳ vọng | Năm điểm Shipment → Trip → Expenses → Debit Note → AR khớp và truy vết hai chiều; AP/P&L khớp nguồn; mọi case có bằng chứng; chỉ sign-off PASS khi không còn FAIL/BLOCKED bắt buộc |
| FAIL nếu | Thiếu ID/version/status/evidence; sai tổng; không truy ngược nguồn; còn case treo; hoặc ký PASS dù còn FAIL/BLOCKED |
| Bằng chứng | Run register; worksheet năm điểm; defect log; cleanup log; chữ ký |
| Phụ thuộc | Tất cả case trước |

## 8. Trình tự chạy gợi ý

| Nhóm | Case |
| --- | --- |
| Chuẩn bị | TC-MO2C-00 → TC-MO2C-02 |
| CUS | TC-MO2C-03 |
| Điều phối | TC-MO2C-04 |
| Driver | TC-MO2C-05 → TC-MO2C-07 |
| Ops | TC-MO2C-08 → TC-MO2C-09 |
| POD / Kế toán / chốt | TC-MO2C-10 → TC-MO2C-15 |
| Governance / ngoại lệ | TC-MO2C-16 |
| RBAC và surface | TC-MO2C-17 → TC-MO2C-18 |
| Kết thúc | TC-MO2C-19 |

## 9. Biểu mẫu kết quả bắt buộc

### 9.1. Result register

Sao chép một dòng cho mỗi case. Không để ô kết quả trống.

| Case ID | Vai trò | Thiết bị | Prerequisite | Kết quả | Defect ID / Blocker owner | Entity IDs + versions | Evidence path | Người chạy | Thời gian |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-MO2C-00 | QA | N/A | N/A | NOT RUN | — | RUN_ID | — | — | — |

### 9.2. Worksheet đối chiếu năm điểm

Tạo một bảng cho lô FCL chính và một bảng cho LCL đối chứng. Mỗi số phải kèm đơn vị VND và source ID; không dùng số rút gọn `k/M/B`.

| Điểm đối chiếu | Source ID | Trạng thái/version | Doanh thu trước VAT | VAT | AR sau VAT | Chi phí | AP | Lợi nhuận | Kết quả |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1. Shipment |  |  |  |  |  |  |  |  | NOT RUN |
| 2. Trip |  |  |  |  |  |  |  |  | NOT RUN |
| 3. Expenses |  |  |  |  |  |  |  |  | NOT RUN |
| 4. Debit Note |  |  |  |  |  |  |  |  | NOT RUN |
| 5. AR |  |  |  |  |  |  |  |  | NOT RUN |
| AP / P&L cross-check |  |  |  |  |  |  |  |  | NOT RUN |

Quy tắc tính: `AR sau VAT = doanh thu trước VAT + VAT`; `lợi nhuận = doanh thu trước VAT − tổng chi phí`. Nếu hệ thống có thêm thành phần theo hợp đồng, ghi riêng từng dòng, công thức và nguồn; không ép số cho khớp.

### 9.3. Điều kiện kết luận

1. Không ghi “PASS” cho case nào chưa có ảnh/bằng chứng tương ứng.
2. Không đổi PRD để hợp thức hóa UI đang có.
3. Không chấp nhận BLOCKED do thiếu kiểm thử viên mà không ghi nguyên nhân gốc.
4. Không dùng tài khoản sai vai trò để thay thế quyền thật.
5. Nếu màn hình khác label hiện hành, ghi sự lệch đó vào defect hoặc note bằng chứng.
6. Case FAIL vẫn có thể dùng dữ liệu đã tạo để chạy downstream nếu việc tiếp tục không làm sai sổ sách; phải giữ nguyên FAIL và ghi rõ workaround được PRD cho phép.
7. Kết quả run là `FAIL` nếu có ít nhất một FAIL; là `BLOCKED` nếu không có FAIL nhưng còn case bắt buộc BLOCKED; chỉ là `PASS` khi mọi case bắt buộc PASS.

## 10. Cleanup và bàn giao

### 10.1. Cleanup an toàn

1. Không xóa hoặc sửa trực tiếp audit, ledger, AR, AP, Debit Note, expense đã duyệt hoặc snapshot để làm sạch run.
2. Trên local, chỉ xóa dữ liệu disposable qua UI/chức năng được hỗ trợ nếu đúng quyền; nếu không, để nguyên dữ liệu có RUN_ID để truy vết.
3. Trên staging, không reset, hủy, xóa hoặc hoàn tác dữ liệu nếu chưa có phê duyệt mutation/cleanup riêng.
4. Nếu cần hoàn tác dữ liệu đã duyệt, dùng workflow điều chỉnh/hoàn tác và giữ bằng chứng; không coi đó là cleanup kỹ thuật.
5. Ghi từng entity: `đã giữ lại`, `đã xóa qua UI`, `đã hoàn tác có phê duyệt`, hoặc `chờ owner xử lý`.

### 10.2. Checklist gói bàn giao

| Việc | Kết quả cần có |
| --- | --- |
| Run register | Đủ mọi case, role, viewport, result, entity/version và evidence path |
| Reconciliation | Có hai worksheet FCL/LCL và công thức năm điểm |
| Defect package | Mọi FAIL có defect ID, severity, PRD expected, actual và ảnh |
| Blocker package | Mọi BLOCKED có nguyên nhân, owner và điều kiện để chạy lại |
| Cleanup log | Mọi entity test có disposition rõ ràng |
| Artifacts | File mở được, tên theo Mục 6.2, không chứa secrets |
| Final handover | Người nhận biết kết quả run và các case phải rerun |

### 10.3. Sign-off

| Trường | Giá trị |
| --- | --- |
| Run ID |  |
| Môi trường / build hoặc commit |  |
| Kết quả cuối | PASS / FAIL / BLOCKED |
| Tổng case PASS / FAIL / BLOCKED |  |
| Defect mở |  |
| Blocker còn lại và owner |  |
| Vị trí artifact |  |
| Cleanup disposition |  |
| QA thực thi / ngày giờ |  |
| QA lead xác nhận / ngày giờ |  |
| BA/UAT xác nhận / ngày giờ |  |

**Cấm ký PASS** nếu còn case bắt buộc FAIL/BLOCKED, thiếu bằng chứng, thiếu đối chiếu năm điểm hoặc chưa ghi rõ cleanup.
