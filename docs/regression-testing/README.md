# Hồi quy SilverSea — Kế hoạch kiểm thử thủ công trên website

> **Mục đích.** Thư mục này chứa **kế hoạch kiểm thử hồi quy (regression) thủ công** để QA kiểm thử
> trực quan trên website Silversea. Mỗi ca kiểm thử (test case) có mã định danh, mô tả quy tắc
> nghiệp vụ cần kiểm, các bước thao tác trên UI, kết quả mong đợi và vai trò người thử.
>
> **Nguồn chân lý.** Mọi ca kiểm thử trong thư mục này được dẫn xuất từ:
>
> - `docs/prd/Module1.docx` … `docs/prd/Module12.docx` — 12 phân hệ nghiệp vụ (8–7 nhóm chức năng mỗi phân hệ)
> - `docs/prd/business-logic-qa-proposals.md` — 23 quy tắc logic nghiệp vụ (Q01–Q23), SilverSea đã chấp thuận toàn bộ đề xuất TingTing ngày 27/07/2026
> - `docs/prd/O2C Flow.md` và `docs/prd/O2C dev-rev1.md` — quy trình Order-to-Cash end-to-end (quyết định 01/08/2026) → tệp `14-order-to-cash-workflow.md`
> - `docs/prd/sidebar-organization-by-role.txt` — sắp xếp menu theo 7 vai trò (cập nhật 01/08/2026) → tệp `15-navigation-menu-by-role.md`
> - `plans/260803-1814-overall-business-workflow/research/source-requirement-index.md` — quy trình tổng thể 27 yêu cầu, kiểm chứng đủ 8 vai trò runtime → tệp `16-overall-business-workflow.md`
>
> **Trạng thái PRD.** SilverSea đã chấp thuận Q01–Q23 theo toàn bộ đề xuất
> TingTing ngày 27/07/2026. Các ca phụ thuộc Q không còn bị chặn về thẩm quyền,
> nhưng chỉ được đánh dấu Pass khi hành vi đã được triển khai và có bằng chứng.
>
> **Supersession O2C (01/08/2026).** Quy trình O2C mới (xem `14-order-to-cash-workflow.md` §8) định nghĩa
> lại máy trạng thái lô hàng: trạng thái kết thúc là `Hoàn thành`, **loại bỏ `Đã khóa (Locked/Billed)`**,
> chi phí vẫn sửa được sau khi hoàn thành. Nếu ca M01 cũ mâu thuẫn, **quy tắc O2C là chân lý mới**.

---

## 1. Cách dùng tài liệu này

### 1.1. Vai trò QA và phạm vi

Mỗi ca kiểm thử quy định **vai trò người thử** (xem §2 bên dưới). QA đăng nhập bằng tài khoản demo tương
ứng và thực hiện các bước. Nếu vai trò không có quyền, **bước đó phải được thử với cả người có quyền và
người không có quyền** để kiểm tra cả luồng thành công lẫn phân quyền.

### 1.2. Cấu trúc mỗi ca kiểm thử

```markdown
### TC-<Mã phân hệ>-<Mã nhóm>-<Số thứ tự>

- **Vai trò:** ADMIN / MANAGER / ACCOUNTANT / DRIVER / FORWARDER / CLERK / CUSTOMER
- **Phụ thuộc:** (nếu có) Q01 đã accepted, hoặc không phụ thuộc
- **Quy tắc nghiệp vụ:** (trích từ PRD, ngắn gọn)
- **Tiền điều kiện:** dữ liệu cần có sẵn trong hệ thống trước khi thử
- **Các bước:**
  1. …
  2. …
- **Kết quả mong đợi (Pass):**
  - bullet 1 …
  - bullet 2 …
- **Bằng chứng:** ảnh màn hình / tệp xuất / mã chứng từ
```

### 1.3. Mức độ ưu tiên

| Mức   | Ý nghĩa                                                              | Khi nào phải thử                              |
| ----- | ------------------------------------------------------------------- | --------------------------------------------- |
| P0    | Chặn nghiệp vụ — sai sẽ làm hỏng sổ sách, công nợ, lương            | Mỗi release                                   |
| P1    | Luồng nghiệp vụ chính                                               | Mỗi release                                   |
| P2    | Trường hợp biên, ngoại lệ, UX                                       | Mỗi release cho phân hệ thay đổi             |
| Smoke | Tác vụ chính đăng nhập, điều hướng, xem báo cáo                     | Trước mỗi đợt regression                      |

### 1.4. Ghi nhận kết quả

Sau mỗi ca kiểm thử, điền vào Bảng nghiệm thu (template trong mỗi tệp phân hệ):

| Ngày thử | Mã TC  | Người thử | Kết quả (Pass/Fail/Blocked) | Lỗi ghi chú        | Bằng chứng |
| -------- | ------ | --------- | --------------------------- | ------------------ | ---------- |
| __/__/__ | TC-... |           |                             | link Jira / ảnh    | link       |

### 1.5. Khi phát hiện lỗi

1. **Không sửa test case cho khớp.** Ghi nhận lỗi thật, link tới Jira.
2. **Tái hiện được.** Nếu không tái hiện được, ghi rõ môi trường, trình duyệt, thời điểm.
3. **Không tự approves.** QA và Dev khác người.

---

## 2. Tài khoản demo

Mật khẩu cho tất cả: `Abc123`. URL: http://localhost:7174

> **Ghi chú mật khẩu.** `AGENTS.md` (workspace contract) ghi mật khẩu demo là `Abc123`. Nếu môi trường
> thử của bạn dùng mật khẩu khác (vd `admin123`), dùng đúng mật khẩu môi trường đó và ghi rõ trong báo cáo.

| Tên đăng nhập | Vai trò     | Phù hợp thử                                                                 |
| ------------- | ----------- | --------------------------------------------------------------------------- |
| `admin`       | ADMIN       | Tất cả — superuser, dùng khi cần quyền cao nhất                            |
| `giamdoc`     | MANAGER     | Báo cáo giám đốc, duyệt ngoại lệ, bảng điều hành, công nợ                 |
| `ketoan`      | ACCOUNTANT  | Kế toán: ghi chi phí, duyệt hoàn ứng, giấy báo nợ, công nợ, lương         |
| `cus`         | CLERK       | Chứng từ/CUS: tạo lô, kiểm tra POD và hồ sơ chi phí                       |
| `dieuvan`     | DISPATCHER  | Điều vận: ghép chuyến, phân xe/lái xe và phát lệnh                         |
| `giaonhan`    | FORWARDER   | Cổng nhân viên hiện trường: tạm ứng, khoản chi hộ, tải ảnh chứng từ       |
| `laixe`       | DRIVER      | Cổng lái xe: nhận lệnh, cập nhật tiến độ, công tác phí, phiếu lương      |
| `thu`, `pho`, `quyet` | DRIVER | Lái xe dự phòng (dùng khi cần nhiều lái xe cho test multi-driver)         |
| `customer`    | CUSTOMER   | Cổng khách hàng: theo dõi lô, giấy báo nợ, xác nhận thanh toán           |

> **Ghi chú.** Tài khoản `CUSTOMER` được row-scope theo đúng một pháp nhân khách hàng. Để thử
> trường hợp "một khách xem nhiều khách hàng" (Q16) cần quản trị viên liên kết thêm và đó là test
> chuyên biệt, không có sẵn demo.

---

## 3. Môi trường & URL các màn chính

- **Frontend (người thử):** http://localhost:7174
- **Backend health:** http://localhost:3001/api/health
- **Adminer (xem CSDL):** http://localhost:8083
- Khởi động: `make dev` từ repo root.

### 3.1. Bản đồ màn hình → phân hệ

| Phân hệ PRD | Màn hình chính (URL)                                                  | Tài khoản thử              |
| ----------- | --------------------------------------------------------------------- | -------------------------- |
| M01 Tổng quan & Điều vận | `/dashboard`, `/dispatch`, `/trips`, `/fleet`            | admin / giamdoc / ketoan   |
| M02 Báo giá cước & doanh thu phi VT | `/config/pricing-tables`, `/config/weight-pricing-tiers`, `/config/lift-pricing`, `/config/ancillary-revenue` | ketoan / admin |
| M03 CUS — chăm sóc khách hàng | `/customers`, `/customers/:id`, `/shipments`, `/portal/shipments`, `/portal/debit-notes` | admin / customer |
| M04 Quy trình chi hộ — thu hộ khép kín | `/shipments/:id`, `/expenses`, `/customers/:id/billing/new` | giaonhan / ketoan / admin |
| M05 Công nợ phải thu (AR) | `/debt`, `/debt/:id`, `/debt/:id/billing/new`            | ketoan / admin             |
| M06 Công nợ phải trả (AP) | `/payables`, `/payables/:id`, `/suppliers`, `/config/suppliers` | ketoan / admin    |
| M07 Lương, chấm công, kỷ luật | `/salary`, `/config/salary-periods`, `/penalties`       | ketoan / admin / laixe    |
| M08 Ứng dụng lái xe | `/my-trips`, `/my-trips/two-orders`, `/my-trips/:id`, `/my-earnings`, `/my-payslips`, `/my-penalties` | laixe |
| M09 Ứng dụng nhân viên hiện trường | `/my-forwarder-trips`, `/my-advances`, `/my-settlements`, `/my-settlements/new` | giaonhan |
| M10 Ứng dụng nhân viên chứng từ | `/shipments/new`, `/clerk/shipments/:id/docs`, `/shipments` | tài khoản CUS |
| M11 Báo cáo tài chính & lãi lỗ | `/finance`, `/profit`, `/dashboard`                    | giamdoc / ketoan / admin   |
| Admin application settings | `/config/app-settings` | admin |
| Thông tin công ty | `/config/company-info` | admin / giamdoc / ketoan |
| M12 Nhiên liệu & số hóa chứng từ dầu | `/config/fuel-norms`, `/config/fuel`, `/trips/:id` (ảnh cột bơm), `/payables` (hóa đơn dầu) | ketoan / admin / laixe |
| O2C Quy trình end-to-end | `/shipments`, `/dispatch`, `/trips`, `/expenses`, `/debt`, `/payables`, `/finance` | admin / ketoan / clerk / giaonhan / laixe |
| Điều hướng & menu theo vai trò | `/dashboard`, `/accounting`, `/dispatch`, `/shipments`, `/my-trips`, `/my-forwarder-trips`, `/portal/shipments`, `/finance/treasury`, `/credit-overrides`, `/governance-actions`, `/chatbot-monitoring`, `/recoverable-costs`, `/portal/statement` | tất cả 8 vai trò |

> **Cổng khách hàng** (`/portal/...`) và **cổng nhân viên** (`/my-...`) dùng role-specific layout. Để
> thử, đăng nhập bằng đúng role (customer / laixe / giaonhan) — guard sẽ tự chuyển hướng.

---

## 4. Cấu trúc tệp trong thư mục này

```
docs/regression-testing/
├── README.md                          ← Bạn đang ở đây
├── 00-cross-cutting.md                ← 12 tiêu chí HT-01..12 + 23 câu hỏi logic Q01..Q23
├── 01-module-01-overview-dispatch.md  ← M01: Tổng quan & Điều vận chuyến xe
├── 02-module-02-pricing-revenue.md    ← M02: Báo giá cước & doanh thu phi VT
├── 03-module-03-cus.md                ← M03: Chăm sóc khách hàng (CUS)
├── 04-module-04-disbursement-recovery.md ← M04: Quy trình chi hộ — thu hộ khép kín
├── 05-module-05-ar.md                 ← M05: Công nợ phải thu
├── 06-module-06-ap.md                 ← M06: Công nợ phải trả
├── 07-module-07-payroll.md            ← M07: Lương, chấm công, kỷ luật
├── 08-module-08-driver-app.md         ← M08: Ứng dụng lái xe
├── 09-module-09-field-app.md          ← M09: Ứng dụng nhân viên hiện trường
├── 10-module-10-clerk-app.md          ← M10: Ứng dụng nhân viên chứng từ
├── 11-module-11-finance-pnl.md        ← M11: Báo cáo tài chính & lãi lỗ
├── 12-module-12-fuel.md               ← M12: Nhiên liệu & số hóa chứng từ dầu
├── 13-customer-service-finance-visual-workflow.md ← Visual QA Booking → CUS → tài chính
├── 14-order-to-cash-workflow.md       ← O2C: Quy trình end-to-end (Bước 0-4 + đối chiếu liên phân hệ)
├── 15-navigation-menu-by-role.md      ← Bộ điều hướng 7 vai trò lịch sử; dùng tệp 16 để bổ sung DISPATCHER và đủ 8 vai trò
└── 16-overall-business-workflow.md    ← Quy trình tổng thể: 27 yêu cầu × 8 vai trò × tài chính/QA khép kín
```

### 4.1. Ma trận phân hệ ↔ ca kiểm thử

| Tệp                         | Số nhóm chức năng | Số ca tối thiểu | Tiêu chí nghiệm thu toàn phân hệ |
| --------------------------- | ----------------- | --------------- | --------------------------------- |
| `00-cross-cutting.md`       | —                 | ~50             | HT-01..HT-12 + Q01..Q23           |
| `01-module-01-overview-dispatch.md` | 8 nhóm (1.1–1.8) | ~40      | M01-HT-01..M01-HT-10              |
| `02-module-02-pricing-revenue.md`   | 5 nhóm (2.1–2.5) | ~25      | M02-HT-01..M02-HT-10              |
| `03-module-03-cus.md`        | 7 nhóm (3.1–3.7)  | ~42 (6 ca/nhóm) | HT-01..HT-12                       |
| `04-module-04-disbursement-recovery.md` | 7 nhóm (4.1–4.7) | ~35   | M04-HT-01..M04-HT-10              |
| `05-module-05-ar.md`         | 8 nhóm (5.1–5.8)  | ~40            | M05-HT-01..M05-HT-10              |
| `06-module-06-ap.md`         | 4 nhóm (6.1–6.4)  | ~20            | M06-HT-01..M06-HT-10              |
| `07-module-07-payroll.md`    | 4 nhóm (7.1–7.4)  | ~20            | M07-HT-01..M07-HT-10              |
| `08-module-08-driver-app.md` | 6 nhóm (8.1–8.6)  | ~30            | M08-HT-01..M08-HT-10              |
| `09-module-09-field-app.md`  | 5 nhóm (9.1–9.5)  | ~25            | M09-HT-01..M09-HT-10              |
| `10-module-10-clerk-app.md`  | 3 nhóm (10.1–10.3) | ~15           | M10-HT-01..M10-HT-10              |
| `11-module-11-finance-pnl.md` | 6 nhóm (11.1–11.6) | ~30           | M11-HT-01..M11-HT-10              |
| `12-module-12-fuel.md`       | 3 nhóm (12.1–12.3) | ~15           | M12-HT-01..M12-HT-10              |
| `13-customer-service-finance-visual-workflow.md` | Luồng xuyên phân hệ | 50 ca visual bổ sung | Role × route × viewport + đối chiếu tài chính |
| `14-order-to-cash-workflow.md` | Luồng O2C (Bước 0-4) | ~38 ca | O2C-HT-01..O2C-HT-10 |
| `15-navigation-menu-by-role.md` | 7 vai trò lịch sử; được tệp 16 mở rộng thành 8 | ~30 ca | NAV-HT-01..NAV-HT-10 |
| `16-overall-business-workflow.md` | 27 yêu cầu tổng thể + ca xuyên phân hệ | 27 ca chính + 8 ca kiểm soát | OVR-001..OVR-027 + TC-WB-901..908 |
| **Tổng PRD + visual workflow** | | **~470 + 50 ca bổ sung** | |

> Con số "~400" phản ánh độ phủ đậm đặc mà PRD yêu cầu: mỗi nhóm chức năng cần ≥5 ca (luồng thường,
> thiếu/sai dữ liệu, ngoại lệ, phân quyền, gửi lại/đồng thời) cộng thêm các ca biên riêng của nhóm.

---

## 5. Tiêu chí nghiệm thu dùng chung (HT)

Mỗi phân hệ có một bảng tiêu chí nghiệm thu dùng chung (`M0X-HT-01` đến `M0X-HT-10`, Module 3 dùng
`HT-01` đến `HT-12`). Các tiêu chí này được tóm tắt trong `00-cross-cutting.md` và áp dụng **cho mọi
phân hệ**. Khi thử, đặt kết quả Pass cho từng HT-x trong ô riêng của bảng nghiệm thu toàn phân hệ.

10/12 nhóm HT lặp lại ở mọi phân hệ:

| Mã            | Nhóm kiểm tra           | Tóm tắt tiêu chí đạt                                                            |
| ------------- | ----------------------- | ------------------------------------------------------------------------------- |
| HT-01         | Ngôn ngữ                | Tiếng Việt, chỉ giữ CUS/tên riêng/mã chuẩn                                       |
| HT-02         | Phân quyền              | Người dùng chỉ xem/thao tác đúng dữ liệu giao; URL trực tiếp không vượt quyền   |
| HT-03         | Nhật ký                 | Tạo/sửa/duyệt/chốt/hủy/ngoại lệ ghi đủ người, thời điểm, thay đổi, lý do       |
| HT-04         | Tính toàn vẹn           | Mạng chập/bấm 2 lần không tạo bản ghi/chứng từ/bút toán trùng                   |
| HT-05         | Tiền tệ                 | VNĐ không lẻ; dấu phân cách đúng; màn hình khớp tệp xuất                       |
| HT-06         | Ngày giờ                | Giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không đổi giữa các màn             |
| HT-07         | Thiết bị                | Tác vụ chính dùng được trên máy tính & điện thoại, không che nút/vỡ bảng       |
| HT-08         | Khôi phục lỗi           | Mất kết nối/máy chủ lỗi có thông báo dễ hiểu; không mất dữ liệu đã lưu         |
| HT-09         | Tìm kiếm & xuất dữ liệu | Kết quả đúng quyền; tệp xuất mở được, đủ cột, đúng tổng                       |
| HT-10         | Đối chiếu liên phân hệ  | Dữ liệu khớp nguồn/đích; chênh lệch truy ngược được tới chứng từ/thao tác      |

Module 3 (CUS) thêm 2 nhóm:
- **HT-11 Bảo mật:** Phiên hết hạn đúng quy định; URL không vượt quyền; chứng từ không công khai ngoài hệ thống.
- **HT-12 Đối chiếu cuối kỳ:** Tổng giấy báo nợ, khoản đã thu, số còn phải thu và chi hộ khớp báo cáo chi tiết.

---

## 6. Khuyến nghị chạy regression

### 6.1. Trước mỗi release (smoke)

1. Đăng nhập lần lượt bằng 8 vai trò (admin, giamdoc, ketoan, cus, dieuvan, giaonhan, laixe, customer) và xác nhận **trang bắt đầu đúng theo PRD sidebar** (xem `15-navigation-menu-by-role.md` §9): admin/giamdoc → `/dashboard`, ketoan → `/accounting`, cus → `/shipments`, dieuvan → `/dispatch`, laixe → `/my-trips`, giaonhan → `/my-forwarder-trips`, customer → `/portal/shipments`.
2. Mở màn hình nhà của mỗi vai trò — phải load không lỗi, nhóm quan trọng nhất mở sẵn.
3. Mở `/dashboard` với admin — phải hiển thị 4 chỉ số chính.
4. Mở `/finance` với giamdoc — phải hiển thị báo cáo lãi lỗ kỳ hiện tại.
5. Mở `/portal/debit-notes` với customer — phải thấy đúng giấy báo nợ của customer đó.
6. Chạy 1 ca end-to-end O2C (TC-O2C-06-01) — xác nhận dữ liệu chảy đúng từ lô đến AR.

### 6.2. Khi một phân hệ thay đổi

1. Chạy **toàn bộ ca kiểm thử trong tệp phân hệ đó**.
2. Chạy `00-cross-cutting.md` các HT có liên quan (tiền tệ, ngày giờ, nhật ký…).
3. Chạy các ca **đối chiếu liên phân hệ** trong tệp phân hệ liên quan (xem cột "Liên phân hệ" mỗi tệp).
4. Nếu thay đổi ảnh hưởng **sổ sách/công nợ/lương**, chạy thêm E2E: `cd e2e && ./run_all.sh`.

### 6.3. Khi dữ liệu master thay đổi (giá, định mức, hạn mức)

1. Tạo/chỉnh sửa bản ghi master.
2. Mở các chuyến/lô đã có và kiểm tra **số liệu tạm tính** có tự tính lại không (HT đối chiếu nguồn).
3. Kiểm tra **số liệu đã chốt** không đổi (HT tính toàn vẹn).

---

## 7. Quy ước viết ca kiểm thử

- **Mã ca:** `TC-<Phân hệ>-<Nhóm>-<STT>` — ví dụ `TC-M01-03-02` = ca thứ 2 trong nhóm 1.3 của M01.
- **Mã PRD:** `M0X-0Y-ZZ` như đã quy ước trong PRD (sẽ được dẫn chiếu trong cột "Mã PRD").
- **Vai trò:** dùng mã ENUM (`ADMIN`, `MANAGER`, `ACCOUNTANT`, `CLERK`, `DISPATCHER`, `DRIVER`, `FORWARDER`, `CUSTOMER`).
- **Ngôn ngữ:** mô tả ca kiểm thử bằng tiếng Việt để QA dễ đọc; tên field kỹ thuật giữ tiếng Anh khi cần.
- **Mỗi ca phải có ≤6 bước** để dễ theo dõi; tách thành nhiều ca nếu phức tạp.
- **Kết quả mong đợi phải quan sát được trên UI** (văn bản, số liệu, màu trạng thái, toast, dialog).
  Nếu cần kiểm tra CSDL, ghi rõ "mở Adminer xem bảng X".

---

## 8. Cập nhật tài liệu

Khi mã nguồn hoặc PRD thay đổi:

1. Cập nhật ca kiểm thử bị ảnh hưởng trong tệp phân hệ tương ứng.
2. Nếu thêm tính năng, thêm ca mới với STT tiếp theo.
3. Nếu bỏ tính năng, đánh dấu ca là `@deprecated` (không xóa) và ghi lý do.
4. Khi một Q01..Q23 chuyển trạng thái, cập nhật cột *Phụ thuộc* của các ca liên quan.
5. Commit cùng nhánh với thay đổi mã nguồn tương ứng.
