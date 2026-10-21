# Lô hàng kẹp & lô hàng kết hợp

**Dự án:** TTransport — Silver Sea

Xem thêm: [mục lục PRD](README.md), [Quy trình O2C](QuyTrinhO2C.docx), [Màn hình lái xe](ManHinhLaiXe.docx).

Điều vận cần ghép các công việc phù hợp để tận dụng xe, moóc và hành trình. Lái xe cần hiểu hai công việc chạy đồng thời hay nối tiếp. CUS và Kế toán cần giữ đúng lô hàng, chứng từ, doanh thu và chi phí của từng công việc khi ghép.

## 1. Định nghĩa nghiệp vụ

### 1.1 KẸP — hai container 20FT chạy đồng thời

Ghép **hai container 20FT** lên cùng một moóc có khả năng chở hai vị trí 20FT, dùng chung đầu kéo và tài xế, vận chuyển đồng thời. Trường hợp thường gặp là một container có hàng và một container rỗng.

- Moóc 40FT phù hợp có thể chở hai container 20FT; loại moóc 40FT không phải lý do từ chối cặp.
- Container 40FT không được làm thành viên của cặp hai container 20FT này.
- **Tổng trọng lượng hàng của cả hai container** phải phù hợp với năng lực của tổ hợp đầu kéo/moóc. Từng container đủ tải riêng chưa có nghĩa cả cặp đủ tải.
- Thông tin hàng, tiến độ và bằng chứng của từng container vẫn được theo dõi riêng.

### 1.2 KẾT HỢP — tái dùng vỏ, thực hiện nối tiếp

Xe đưa container đến trả hàng Lệnh 1, giữ lại vỏ để đi đóng hàng Lệnh 2 thay vì chạy rỗng về bãi. Hai lệnh dùng chung đầu kéo, moóc và tài xế nhưng thực hiện nối tiếp.

**Cảng nâng → trả hàng tại Nhà máy 1 → giữ vỏ → đóng hàng tại Nhà máy 2 → Cảng hạ.**

Cảng nâng / Cảng hạ có thể bổ sung SAU khi điều xe (quyết định 05/10/2026, card
20261005_358): ghép chuyến cần đủ hai cảng để qua kiểm tra, nên điều vận bổ sung
trên Chi tiết lô hàng mà không phải gỡ phân xe. Tuyến đường vẫn khóa sau điều xe.

Chỉ được bắt đầu đóng hàng Lệnh 2 sau khi hoàn thành phần trả hàng Lệnh 1. Tiết kiệm hành trình rỗng không làm gộp chứng từ hoặc doanh thu của hai công việc.

## 2. Lô hàng và quan hệ ghép

Một **lô hàng nguồn có thể gồm nhiều container**. Mỗi công việc vận chuyển có phân công, lịch, tiến độ và bằng chứng riêng, đồng thời vẫn thuộc đúng lô hàng nguồn.

| Nội dung | Yêu cầu nghiệp vụ |
|----------|------------------|
| Lô hàng nguồn | Giữ đúng khách hàng, chứng từ và các container/công việc thuộc lô |
| Công việc vận chuyển | Nhận diện rõ container, lịch, phân công và kết quả thực hiện riêng |
| Cặp ghép | Nhận diện thống nhất hai công việc được ghép, loại ghép và xe/moóc/tài xế dùng chung |

Mỗi cặp chỉ có **một quan hệ ghép thống nhất** trên các màn hình. Điều vận, CUS, lái xe và Ops phải cùng thấy đúng hai công việc, loại ghép và phân công đang có hiệu lực. Cùng biển số, cùng ngày hoặc ghi chú “KẸP” không tự làm hai công việc trở thành một cặp.

Không ép tách một lô nhiều container thành nhiều lô chỉ để ghép, cũng không gộp hai lô vì chạy cùng xe. Doanh thu và chứng từ tiếp tục thuộc đúng lô/container ban đầu.

Công việc LCL được nhận diện và theo dõi riêng mà không cần container. Không tạo container giả để đưa LCL vào quy tắc ghép hai container 20FT.

## 3. Phân xe và quản lý cặp

### 3.1 Tạo cặp

Người làm Điều vận có quyền phân xe chọn hai công việc phù hợp, chọn loại ghép và đầu kéo, moóc, tài xế dùng chung. Hai công việc phải cùng ngày vận hành; tuyến, giờ và điểm làm hàng phải phù hợp với cách ghép.

- Với **KẸP**, đúng hai công việc trong cặp được vận chuyển đồng thời trên cùng tổ hợp xe.
- Với **KẾT HỢP**, lịch phải đáp ứng thứ tự trả hàng rồi đóng hàng.
- Mỗi công việc chỉ thuộc một cặp đang có hiệu lực. Không thêm container thứ ba vào ngoại lệ dùng chung của cặp hai container.
- Chỉ ghép công việc còn cho phép thay đổi phân công; không bỏ qua quyền thao tác hoặc ràng buộc xe, moóc và tài xế đang bận.

Sau khi lưu thành công, cả hai công việc cùng có phân công và quan hệ ghép đúng. Nếu không thể lưu đủ cả cặp, thông báo rõ lý do và không để lại một nửa phân công khiến người dùng hiểu nhầm đã ghép xong.

### 3.2 Dùng chung xe, moóc và tài xế

Cặp KẸP hợp lệ không được tự chặn công việc thứ hai vì xe đang phục vụ công việc thứ nhất trong chính cặp đó. Công việc khác ngoài cặp vẫn phải bị chặn nếu gây trùng lịch hoặc vượt năng lực; trùng khung giờ với công việc ngoài cặp thì cảnh báo và cho xác nhận lưu tiếp ("Vẫn lưu?"), không chặn cứng.

Khi hai người cùng phân xe, hệ thống không được xác nhận thành công cho các phân công mâu thuẫn. Người không thể hoàn tất phải thấy xe/moóc/tài xế nào đã được sử dụng và có thể chọn lại phương án phù hợp.

### 3.3 Sửa, hủy và phân lại

- Người có quyền được sửa hoặc bỏ ghép trực tiếp trong phạm vi trạng thái công việc cho phép; không có bước phê duyệt nội bộ.
- Khi đổi hoặc bỏ một thành viên, cập nhật quan hệ ghép, lịch sử dụng xe/moóc/tài xế, chi phí và lương của phần còn lại. Cặp đã bỏ không còn cho phép chồng lịch.
- Nếu người khác đã đổi phân công trong lúc màn hình đang mở, giữ nội dung đang nhập để đối chiếu và giải thích thay đổi trước khi người dùng tiếp tục. Không âm thầm ghi đè lựa chọn mới của người khác.
- Sau khi lưu, mở lại công việc hoặc xem từ vai trò liên quan phải thấy phân công mới mà không cần tải lại toàn bộ ứng dụng.
- Bấm lưu nhiều lần hoặc thử lại sau gián đoạn không tạo thêm cặp, phân công, chi phí hay lương trùng lặp.
- Có thể xem lại cặp ghép đang có hiệu lực và tình trạng phân công hiện hành.

Mọi thao tác cần Internet. Khi chưa thể xác định đã lưu hay chưa, trạng thái phải nói rõ và làm rõ kết quả trước khi người dùng thử lại. Không cho làm việc ngoại tuyến hoặc tự gửi lại khi có mạng.

## 4. Hiển thị cho Điều vận, CUS và lái xe

Nhãn **KẸP/KẾT HỢP** nằm cạnh đúng công việc/container và phản ánh cặp đang có hiệu lực. Khi bỏ ghép, nhãn ghép ngừng hiển thị; trạng thái hiện hành của từng công việc vẫn đọc được.

Trên app lái xe, hai thẻ đứng liền kề, có dấu hiệu cùng cặp. Mỗi thẻ vẫn thể hiện container, loại, lịch và thao tác riêng. KẸP thể hiện chạy đồng thời; KẾT HỢP thể hiện phần trước/phần sau cùng lý do chưa thể bắt đầu phần sau. Xem [Màn hình lái xe](ManHinhLaiXe.docx).

Ở Điều vận, từng công việc giữ thông tin cảng nâng/hạ đúng chiều nhập/xuất. Dấu hiệu dùng chung xe không che số container, loại hoặc trạng thái của từng công việc.

Trên điện thoại, máy tính bảng và máy tính, người dùng phải đọc nhanh được cặp và hành động cần làm. Trình bày xe/moóc/tài xế dùng chung gọn một lần khi phù hợp; tránh thẻ lồng nhau, khoảng trống lớn hoặc nhân đôi khối thông tin. Số container, biển số và loại container phải đọc nguyên cụm. Nút dễ chạm, có nhãn rõ và dùng được bằng bàn phím.

## 5. Chi phí, lương và doanh thu

### 5.1 Phí của hành trình dùng chung

Phí đường bộ/VETC của **cùng một hành trình thực tế dùng chung** chỉ ghi nhận một lần cho cặp. Không lấy phí một hành trình nhân với số container.

Các khoản phí thật sự khác nhau của hai chặng vẫn được ghi nhận riêng. Kế toán phải đối chiếu được tổng phí, khoản nào dùng chung và khoản nào thuộc từng công việc. Khi bỏ ghép hoặc tính lại, áp dụng cách tính phù hợp với hành trình còn lại mà không ghi thêm cùng một khoản phí.

### 5.2 Lương tài xế

**Lương chuyến ghép = Lương cuốc cơ bản + Phụ phí KẸP hoặc KẾT HỢP.**

Phụ phí lấy theo mức lương đã cấu hình cho loại ghép. Không trả tổng hai cuốc đơn cho một cặp được tính theo công thức ghép. Khi thay đổi hoặc bỏ ghép, tính lại theo quy tắc phù hợp và cho đối chiếu được thay đổi; không ghi lương hai lần khi người dùng thử lại.

Kỳ lương đã chốt và việc điều chỉnh tiếp tục theo quy tắc lương chung. Không âm thầm thay đổi lịch sử lương hoặc tạo thêm bước phê duyệt cho chuyến ghép.

### 5.3 Khoản riêng của từng lô/container

Doanh thu, công nợ khách hàng, phí nâng/hạ, vệ sinh và lưu bãi vẫn thuộc đúng lô/container phát sinh. Cùng xe không đồng nghĩa cùng khách hàng hoặc cùng bên xuất hóa đơn. Tổng hợp không được vừa cộng tổng lô vừa cộng lại các khoản của từng container.

## 6. Bảng so sánh

| Tiêu chí | Đơn | KẸP | KẾT HỢP |
|----------|-----|-----|---------|
| Thời gian | Một công việc | Đồng thời | Nối tiếp |
| Container | Theo công việc | Hai container 20FT | Một vỏ tái sử dụng qua hai công việc |
| Công việc | Theo phân công | Hai công việc trong một cặp | Hai công việc trong một cặp |
| Lô hàng nguồn | Giữ lô ban đầu | Giữ lô ban đầu của từng công việc | Giữ lô ban đầu của từng công việc |
| Xe/moóc/tài xế | Theo phân công | Dùng chung, đủ năng lực chở cả cặp | Dùng chung theo trình tự |
| Lịch | Theo công việc | Cùng ngày, phù hợp vận chuyển đồng thời | Cùng ngày, trả xong rồi đóng |
| Phí hành trình dùng chung | Một lần | Một lần | Một lần |
| Lương | Cuốc đơn | Cơ bản + phụ phí KẸP | Cơ bản + phụ phí KẾT HỢP |
| Bằng chứng/tiến độ | Theo công việc | Riêng từng công việc | Riêng từng công việc và đúng thứ tự |

## 7. Tiêu chí nghiệm thu

1. Ghép được hai container 20FT trên moóc 40FT phù hợp, cùng đầu kéo và tài xế. Cả hai công việc đều thể hiện đúng cặp và phân công sau khi lưu.
2. Từ chối container 40FT trong cặp hai 20FT, container thứ ba, công việc đã thuộc cặp khác và tổng trọng lượng vượt năng lực; mỗi trường hợp có lý do dễ hiểu.
3. KẸP hợp lệ không tự chặn công việc thứ hai vì xe bận trong chính cặp. Công việc ngoài cặp vẫn bị chặn khi trùng xe/moóc/tài xế.
4. Hai Điều vận cùng phân xe không tạo phân công mâu thuẫn. Lưu không thành công hoặc thử lại không để lại nửa cặp hay bản ghi trùng.
5. Sửa, bỏ ghép hoặc phân lại cập nhật đúng cả hai công việc, lịch dùng xe, nhãn, chi phí và lương; mở lại thấy kết quả mới.
6. Với KẾT HỢP, chưa trả xong Lệnh 1 thì không bắt đầu đóng Lệnh 2. Quy tắc chạy đồng thời của KẸP không làm mất điều kiện này.
7. Ghép công việc từ lô nhiều container vẫn giữ đúng nguồn, khách hàng, chứng từ, doanh thu, bằng chứng và tiến độ riêng.
8. Một hành trình dùng chung chỉ có một khoản phí tương ứng và một lần tính lương ghép. Phí độc lập của từng chặng vẫn được giữ; bỏ ghép hoặc thử lại không làm tăng tổng sai.
9. Điều vận, CUS, lái xe và Ops đọc được cùng quan hệ ghép trên điện thoại, máy tính bảng và máy tính; rõ số–loại container, cảng, lịch, thứ tự và xe dùng chung.
10. Người có quyền thao tác trực tiếp khi có Internet. Mất mạng không báo thành công giả, không tự gửi lại và không tạo bước chờ phê duyệt nội bộ.

## Spec gốc — "lclspec1-2.docx" (DEV SPEC: HOÀN THIỆN LUỒNG HÀNG LẺ (LCL) – ĐIỀU VẬN, GOM/TÁCH CƯỚC & QUẢN LÝ XE ẢO, 2026.10.15)

> **Overlay ruling 21/10 (boss 15:22 — xem [CHANGELOG](CHANGELOG.md)):** mọi điều khoản
> "nhảy tiền 100%/0₫" trong spec gốc **chỉ còn đúng cho chiều TRẢ nhà xe**. Chiều **THU
> khách** nay là **per-lot độc lập** (đơn giá bảng giá Tuyến×KH × loại xe của từng lô) —
> không dồn 100%/0₫, không chia tỷ lệ. Tách nhóm money-neutral; lãi chuyến = Σ thu − trả.

### I. Mục tiêu (text gốc)

- Tính cước Hàng lẻ theo Loại trọng tải xe tải (1.25T, 2.5T, 3.5T, 5T, 8T, 10T…) HOẶC Cont
  20'/40' (hàng lẻ lớn đóng xe container: thu khách giá nguyên cont, nội bộ ghép thêm lô lẻ).
- Quy tắc Phương tiện: hàng lẻ xe tải = 100% xe ngoài (Nhà thầu/Vendor); hàng lẻ xe cont
  20'/40' = xe nội bộ SilverSea HOẶC xe ngoài.
- Gom chuyến Đầu vào (Trả nhà xe — Điều vận): ghép nhiều lô (VD 5 lô) thành 1 chuyến, chọn
  1 loại tấn xe/loại cont trả tiền nhà xe.
- Ghép/Tách cước Đầu ra (Thu khách — CUS): cùng 5 lô, CUS ghép cả 5 thành 1 cước thu khách;
  hoặc tách thành 2, 3, 4, 5 cước riêng.
- Quy tắc nhảy tiền khi ghép (Lô 1 = 100%, Lô 2..N = 0₫) — *[theo ruling 21/10: chỉ còn áp
  dụng chiều Trả; chiều Thu per-lot]*.
- Quản lý "Xe thực tế" & "Xe ảo" khi tách cước thu khách: trường BKS Báo khách
  (billing_truck_no) — chọn từ danh mục hoặc gõ tự do — để gửi khách/in Debit Note, tách biệt
  BKS thực tế trả tiền nhà xe.

### II. Chi tiết (text gốc rút gọn theo đề mục; toàn văn trong file docx nguồn)

1. **Danh mục Loại xe & Bảng giá:** mở rộng danh mục trọng tải (1.25T…15T) bên cạnh
   cont 20'DC/40'DC/40'HC; bảng giá Tuyến × Khách hàng/Nhà thầu cấu hình đơn giá Cước thu
   khách + Cước trả nhà xe theo các mức trọng tải.
2. **Điều vận:**
   - 2.1 Kế hoạch Tổng quát: cột Cảng nâng/hạ hiển thị Kho lấy/Điểm trả (nếu có, không thì
     "—"); cột Tổng quan hàng hóa lấy đúng dữ liệu CUS: [Số lượng] [Bao bì] | [kg] · [CBM]
     (VD "5 PALLET | 1.922 kg · 4 CBM") — không hiển thị "Chưa có cont".
   - 2.2 Kế hoạch Chi tiết Xe: cột CONTAINER đủ 3 dòng (dòng 1 "Lô hàng lẻ" hoặc "Lẻ · Xe 5
     Tấn"; dòng 2 SL+bao bì; dòng 3 kg · CBM); tích chọn nhiều lô hiện tổng nhanh "Đang chọn
     N lô: Tổng X kg | Y CBM"; popup Gán xe 3 trường — Loại xe tính cước trả (cost_vehicle_type),
     Nhà xe & BKS thực (actual_truck_no; xe tải = chỉ xe ngoài; cont = nội bộ hoặc ngoài),
     BKS Báo khách/xe ảo (billing_truck_no; mặc định copy từ BKS thực, combobox + gõ tự do,
     sửa được per-lô); logic nhảy tiền cước trả khi ghép (cost_group_id): Lô 1 = 100% đơn giá
     trả (tra bảng giá hoặc nhập tay), Lô 2..N = 0₫; tag "Lẻ · Ghép (i/N)"; cont nội bộ
     SilverSea: tiền đường/lương lái xe chỉ tính 1 lần vào Lô 1.
3. **CUS:**
   - 3.1 Chi tiết lô hàng: cột THÔNG SỐ CONTAINER hiển thị loại xe (VD "Lô hàng lẻ | Thu:
     Xe 3.5T | Trả: Xe 10T"); cột PHÂN XE 2 dòng — "[Nhà xe] - BKS Thực: 15C-111.11" /
     "BKS Báo khách (Ảo): 15C-999.99" (click sửa nhanh, combobox + gõ tự do).
   - 3.2 Chi phí – Quyết toán: checkbox đầu dòng + nút [Ghép cước thu khách]; thu riêng từng
     lô (chọn loại xe thu + BKS ảo riêng, cước AUTO nhảy 100% đơn giá lô đó) hoặc ghép
     (validation cùng 1 khách hàng; popup chọn loại xe thu + BKS ảo chung). *[Nhảy tiền thu
     100%/0₫ của spec gốc được thay bằng luật per-lot theo ruling 21/10; Total chi hộ của lô
     phụ vẫn giữ nguyên và cộng vào Tổng phải thu.]* Ghi chú gốc yêu cầu "Ghép cước cùng Bill
     [Số Bill Lô 1]" — giữ làm nhận diện nhóm.
4. **Kế toán chốt debit & Debit Note:** cột THÔNG SỐ CONTAINER ("Lẻ · Thu: 5T / Trả: 10T"
   hoặc "Ghép cùng Bill…"); cột PHÂN XE 2 dòng (Thực + badge cam "Báo khách (Ảo)"); PHẢI THU
   theo nhóm rev của CUS, PHẢI TRẢ theo nhóm cost của Điều vận; Debit Note gửi khách BẮT
   BUỘC in BKS Báo khách (billing_truck_no), tuyệt đối không in BKS thực; loại xe + tiền cước
   theo cước thu; bảng kê nhà xe lọc theo BKS thực + loại xe trả.
5. **Edge case:** Hủy ghép/Xóa Lô 1 → tự chuyển quyền Lô chính + 100% tiền cước sang Lô 2
   (bảo toàn tiền, không rơi về 0₫).

### Trạng thái land (21/10/2026)

| Đề mục | Trạng thái | Bằng chứng |
|---|---|---|
| I Quy tắc tính cước + phương tiện | LAND | `docs/lcl-spec-coverage-2026-10-17.md` §1.1 DONE (vehicle_size_classes, LclVehicleSourcing) |
| 1 Bảng giá Tuyến×KH theo trọng tải | LAND | §1.2 DONE (pricing.ts, CarrierPricingConfigPage) |
| 2.1 Tổng quát: kho/điểm trả + tổng quan hàng hóa | LAND | §2.1 DONE (list-summaries, MasterPlanGrid) |
| 2.2 Chi tiết: 3 dòng cont, tổng nhanh, popup 3 trường, tag Ghép, trả 100%/0₫ | LAND (trả giữ 100%/0₫) | §2.2 DONE + AssignTruckGroupDialog; endgame check (b) P |
| 3.1 CUS chi tiết: loại xe + phân xe 2 dòng | LAND | §3.1 DONE (ShipmentContainerLedger) |
| 3.2 Ghép/tách thu khách | LAND **theo luật mới** (thu per-lot; validation cùng KH giữ) | `d375239b` endgame (a)(c)(d) P; fb093-tach-nhom |
| 4 Kế toán + Debit Note BKS ảo | LAND | §4 DONE (billing-document-draft, AccountingDebitClosePage) + FB-094 |
| 5 Edge: hủy ghép/xóa Lô 1 promote | LAND | §Edge PARTIAL→DONE: backend `0e325cc4` + nút Hủy ghép/Tách nhóm; FB-095 `903ec1cc` (xóa lô) |
| Cargo-fit advisory (thêm sau spec) | LAND (advisory, không chặn) | `ea200241` (assessLclCargoFit) |

## Spec gốc — "lclspec2-2.docx" (Gán xe nhóm hàng lẻ (LCL) — Điều vận & Ghép cước, 18/10/2026)

> Cùng overlay ruling 21/10 như trên: §2.4 (trả) giữ 100%/0₫; §3.4 (thu) thay bằng per-lot.

### Text gốc (theo đề mục)

1. **Tổng quan:** Điều vận gom nhiều lô LCL thành 1 chuyến xe thực tế để trả tiền nhà xe;
   CUS ghép/tách cước thu khách. *"Quy tắc cốt lõi: khi ghép N lô, Lô 1 giữ 100% tiền cước,
   các lô còn lại = 0đ."* *[→ ruling 21/10: quy tắc này giờ chỉ áp chiều trả.]*
2. **Điều vận — Gán xe nhóm (trả nhà xe):** (2.1) bảng Kế hoạch Tổng quát có cột checkbox
   đầu dòng; tích nhiều lô hiện "Đang chọn N lô: Tổng X kg | Y CBM" + dòng gợi ý "Lô 1 giữ
   100% tiền trả nhà xe". (2.2) Nút "Gán xe nhóm"/[Ghép] hiển thị và bấm được sau khi chọn.
   (2.3) Popup 3 trường bắt buộc: Loại xe tính tiền trả nhà xe (1,25T…15T hoặc 20'/40');
   Nhà xe & BKS thực (xe tải = 100% xe ngoài, dropdown liệt kê biển nội bộ, biển ngoài gõ
   tay; cont = nội bộ hoặc ngoài); BKS báo khách/xe ảo (mặc định copy từ BKS thực, sửa
   per-lô). (2.4) Nhảy tiền trả khi ghép (cost_group_id): Lô 1 = 100% đơn giá trả; Lô 2..N =
   0đ; tag "Lẻ · Ghép (i/N)"; cont nội bộ: tiền đường/lương tính 1 lần Lô 1. (2.5) Cột
   CONTAINER 3 dòng như lclspec1 §2.2.
3. **CUS — Ghép/tách cước thu khách:** (3.1) checkbox đầu dòng + nút [Ghép cước thu khách].
   (3.2) Chỉ ghép cùng 1 khách hàng — khác KH thì từ chối rõ ràng. (3.3) Popup: loại xe thu
   + BKS ảo chung. (3.4) Nhảy tiền thu (rev_group_id): Lô 1 = 100%, lô kia 0đ + ghi chú
   "Ghép xe cùng Bill [số Bill Lô 1]"; Tổng chi hộ lô phụ giữ nguyên. *[→ per-lot theo
   ruling 21/10; ghi chú nhóm giữ làm nhận diện.]*
4. **Edge case:** Hủy ghép/Xóa Lô 1 → tự chuyển 100% tiền sang lô tiếp theo (thăng cấp Lô 2
   thành Lô 1). Tách nhóm (unmerge): mỗi lô trở về cước độc lập.
5. **Debit Note:** BKS bắt buộc từ BKS Báo khách (xe ảo), tuyệt đối không in BKS thực; loại
   xe theo cước thu; Lô 1 hiện 100%, lô ghép 0đ.
6. **Hiển thị bổ sung:** (6.1) CUS Chi tiết lô: THÔNG SỐ CONTAINER hiển thị loại xe; PHÂN
   XE 2 dòng (BKS Thực / BKS Báo khách Ảo click sửa). (6.2) Kế toán chốt debit: THÔNG SỐ
   CONTAINER "Lẻ · Thu: 5T / Trả: 10T"; PHÂN XE dòng 1 [Nhà xe thực] · Thực: [BKS], dòng 2
   badge cam "Báo khách (Ảo)"; PHẢI THU theo nhóm CUS, PHẢI TRẢ theo nhóm Điều vận.
7. **Form tạo lô hàng lẻ (bổ sung 17/10, Trung Kiên):** (7.1) Label động theo chiều — Nhập:
   "Nhà máy (Điểm trả hàng) *" + "Kho lấy hàng (CFS/Cảng) *" (placeholder "Chọn hoặc nhập
   kho CFS lấy hàng..."); Xuất: "Nhà máy (Điểm lấy hàng) *" + "Kho trả hàng (CFS/Cảng) *"
   (placeholder "Chọn hoặc nhập kho CFS hạ/giao hàng..."). (7.2) Hàng lẻ: Nhà máy bắt buộc
   (trừ "Lệnh chạy ngoài"); cả 2 ô là combobox chọn danh mục HOẶC gõ tự do + nút "+ Thêm
   kho"/"+ Thêm nhà máy". (7.3) Ô Kho nằm chung card "Điểm vận hành & tuyến" (dưới dòng
   Tuyến đường và Nhà máy). (7.4) Đồng bộ sang Điều vận — Nhập: Cảng nâng = Kho lấy (CFS),
   Cảng hạ = Nhà máy; Xuất: Cảng nâng = Nhà máy, Cảng hạ = Kho trả (CFS); áp dụng cả Kế
   hoạch Tổng quát và Chi tiết Xe.

### Trạng thái land (21/10/2026)

| Đề mục | Trạng thái | Bằng chứng |
|---|---|---|
| §2 Gán xe nhóm (checkbox cột CHỌN, tổng nhanh, popup 3 trường, trả 100%/0₫, tag Ghép, 3 dòng cont) | LAND | AssignTruckGroupDialog + DetailedPlanGrid (a5e0039b, 181026145000); evidence 9cards lcl-07; endgame (b) P |
| §3 Ghép/tách thu khách (cùng KH, BKS ảo chung) | LAND theo luật mới (per-lot) | `d375239b`; fb093-tach-nhom; endgame (a)(c)(d) P |
| §4 Edge: hủy ghép/xóa Lô 1 promote + unmerge độc lập | LAND | `0e325cc4` (Hủy ghép confirm); FB-095 `903ec1cc`; FB-095-C2 nhóm ma `161026054700` đóng |
| §5 Debit Note BKS ảo | LAND | FB-094 `239556ec`/`150acee0` + billing-export-shared |
| §6 Hiển thị CUS + Kế toán | LAND | ShipmentContainerLedger + AccountingDebitClosePage (coverage §3–§4) |
| §7 Form LCL label động + combobox + layout + đồng bộ điều vận | LAND | `032145a2` + audit card 211026011500 (0-gap, driver 9/9 + 3/3) |
