#!/usr/bin/env python3
"""Generate Kanban-PROD TODO tickets (.docx) for the 2026-09-20 OPS/pricing QA findings."""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path('/Users/dev/Library/CloudStorage/GoogleDrive-frankng.sg@gmail.com/My Drive/SilverSea/Kanban-PROD/TODO')
EV = 'qa/2026-09-20_ops-pricing-docx-qa'
SPEC = 'testplan/2026-09-20-ops-pricing-docx-qa.md'

CARDS = [
    dict(
        num='52',
        slug='ops-khai-chi-phi-403-thieu-phan-cong-lo', case_id='TC-OPS-BUG-01',
        title='Ops không ghi được chi phí phát sinh: 403 do thiếu phân công lô, nút vẫn hiện trên mọi dòng',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'`2026.9.6_Man_hinh_ops.docx` (MÀN HÌNH 1 — Thao tác Nhập phí). Phiên QA: `{SPEC}`, case **TC-OPS-BUG-01**. Tài khoản theo `testplan/testaccounts.txt` (local: `giaonhan` OPS / Abc123).',
        desc=[
            'Trên `/ops/orders`, mọi lô đều có nút **[Khai chi phí]**, nhưng lưu chỉ thành công khi lô nằm trong bảng phân công `user_shipment_links` của user OPS đó. Bảng này chỉ được ghi từ form người dùng (Admin) và từ seed — **không có đường nào sinh phân công từ luồng điều vận / gán xe**.',
            'Dev seed để `giaonhan` có **0** dòng phân công ⇒ bấm Lưu ở **bất kỳ** lô nào đều trả `403 Bạn không còn được phân công lô hàng này.` Khi Admin gán lô cho user (hoặc QA gán trực tiếp), cùng thao tác đó trả `201` và khoản chi vào quỹ bình thường.',
            'Hệ quả nghiệp vụ: Ops không thể ghi chi phí phát sinh tại cảng ⇒ ví, nợ chứng từ và phiếu quyết toán trống trên dữ liệu thật.',
        ],
        evidence=[
            ('qa/2026-09-20_ops-pricing-docx-qa/02-ops-expense-out-of-scope-403.png',
             'Ảnh TRƯỚC — khai chi phí lô ngoài phạm vi: toast đỏ “Bạn không còn được phân công lô hàng này. Tải lại danh sách công việc.”'),
        ],
        facts=[
            '`POST /api/ops/expenses` → **403** `{"error":"Bạn không còn được phân công lô hàng này. Tải lại danh sách công việc."}` (network log trong `facts.json.steps[ops-expense-out-of-scope-403].posts`).',
            'Sau khi Admin gán lô (`PATCH /api/auth/users/7` với `shipmentIds`) → cùng thao tác **201**, `id=2`, 250.000đ, nhóm `OPS_INCIDENTAL`.',
            '`select count(*) from user_shipment_links` = 0 trên dev seed; chỉ `backend/src/seed/seed-trips.ts` và `user.service.ts#syncShipmentLinks` ghi bảng này.',
        ],
        ac=[
            'Không hiện/không cho lưu [Khai chi phí] ở lô ngoài phạm vi — hoặc phạm vi phải được sinh tự động khi điều vận gán chuyến cho xe thuộc Ops quản lý (docx MÀN HÌNH 2).',
            'Thông báo 403 phải nói rõ nguyên nhân và cách xử lý (liên hệ Admin/điều vận gán lô), không chỉ “Tải lại danh sách công việc”.',
            'Lưu hợp lệ → khoản chi xuất hiện ngay trong `/ops/wallet` (nhật ký + số dư) và trong `expense_accounting_sources`.',
            'Bổ sung regression cho phân công: Ops A không ghi được cho lô của Ops B, và ngược lại sau khi được gán.',
        ],
        verify=[
            'Đăng nhập `giaonhan` / Abc123 trên local, mở `/ops/orders`, chọn ngày có lô chưa gán cho user, bấm [Khai chi phí] → điền loại phí + số tiền → [Lưu].',
            'Hiện tại: toast đỏ 403, DevTools Network có `POST /api/ops/expenses` 403. Sau khi sửa: hoặc nút không còn cho lô ngoài phạm vi, hoặc lưu thành công và khoản chi hiện ở `/ops/wallet`.',
        ],
    ),
    dict(
        num='53',
        slug='cuoc-fcl-khong-khoa-snapshot', case_id='TC-CUOC-BUG-01',
        title='Lô FCL tạo từ màn CUS không bao giờ khóa cước tự động (thiếu shipments.route_id)',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'`Phương án tính cước tự động.docx` §3 (Khóa giá cước hệ thống) + `testplan/flows/12-cuocphi-phuphi-dau.md` TC-CUOC-009/010. Phiên QA: `{SPEC}`, case **TC-CUOC-BUG-01**.',
        desc=[
            'Lô FCL do CUS tạo gửi tuyến **ở cấp container** (`shipment-create-model.ts`: `routeId: form.cargoMode === "LCL" && form.routeId ? Number(form.routeId) : null`), nên `shipments.route_id` = `null`.',
            '`lockShipmentFreightRate()` (gọi ở bước tạo lô, ở bước ghi container, ở bước phát lệnh) thoát sớm khi `shipment.customerId == null || shipment.routeId == null` ⇒ **không có dòng `freight_rate_snapshots`** nào cho lô FCL, ở cả ba mốc. Engine vẫn tính đúng nếu gọi trực tiếp (preview 3.978.000 + 813.480 = 4.791.480).',
            'Chỉ sau khi set `route_id` cho lô **và** đổi Ngày giao dự kiến thì mới sinh snapshot — nghĩa là cước “đóng băng tại Ngày vận chuyển” không xảy ra trên luồng thật.',
        ],
        evidence=[
            ('qa/2026-09-20_ops-pricing-docx-qa/07-debit-l1-list.png',
             'Ảnh — bảng kê Lớp 1 của lô `SHP-2609-00020` sau toàn bộ luồng CUS → điều vận → phát lệnh; số cước chỉ có được nhờ QA set route thủ công.'),
        ],
        facts=[
            'Chuỗi thao tác thật: CUS tạo lô (routeId null) → phân bổ nhà xe → gán xe → `POST /api/shipments/298/dispatch` **201** ⇒ `GET /api/shipments/298` trả `freightRate: { latest: null, snapshotCount: 0 }`.',
            'Sau khi `PUT /api/shipments/298 { routeId: 1 }` rồi đổi `expectedDeliveryDate` ⇒ `snapshotCount` 0 → 1 → 2 (INSERT mới, không UPDATE).',
            'Preview engine độc lập: `GET /api/pricing/freight-preview?customerId=1&routeId=1&vehicleSizeClassCode=CONT20&transportDate=2026-09-20` → `total 4791480`, `billedKm 260`, `liters 83.2`, `fuelPricePeriodId 2`.',
            'DB: `select id, route_id from shipments where id=298` → `route_id` null trước khi QA set; 11/270 lô dev đang ở trạng thái `route_id` null (tất cả đều FCL).',
        ],
        ac=[
            'Lô FCL có tuyến (ở container) + Ngày vận chuyển ⇒ phải có snapshot `source=AUTO` với đủ `rate_terms_id`, `pricing_table_id`, `fuel_norm_id`, `fuel_price_period_id`, `billed_km`, `liters`, `fuel_delta`.',
            'Bước phát lệnh phải supersede bằng INSERT (row cũ giữ nguyên), không được để lô không có bản chốt nào.',
            'Không được “chữa” bằng cách đổi engine bỏ qua route — phải chọn nguồn tuyến đúng (container khi lô FCL) và giữ nguyên quy tắc lô chạy ngoài (ad-hoc) không khóa.',
            'Regression: lô LCL (route cấp lô) vẫn khóa như trước; lô FCL nhiều container khác tuyến phải chốt theo container/chuyến.',
        ],
        verify=[
            'Local: `cus`/Abc123 tạo lô FCL có tuyến + ngày giờ đóng trả → `dieuvan` gán xe → [Phát lệnh].',
            'Hiện tại `GET /api/shipments/<id>` trả `freightRate.snapshotCount = 0`. Sau khi sửa: `snapshotCount ≥ 1` ngay sau khi tạo lô (có Ngày vận chuyển), và tăng thêm 1 dòng khi phát lệnh.',
        ],
    ),
    dict(
        num='54',
        slug='debit-l1-cong-don-snapshot-cuoc', case_id='TC-CUOC-BUG-02',
        title='Bảng kê Lớp 1 “CƯỚC VẬN TẢI (AUTO)” cộng dồn mọi bản chốt cước cũ → phải thu khách sai bội số',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'`Phương án tính cước tự động.docx` §3–§4 (chốt cước, đối soát trên bảng kê). Phiên QA: `{SPEC}`, case **TC-CUOC-BUG-02**.',
        desc=[
            '`shipment-debit-summary.service.ts` tính cước tự động cho Lớp 1 bằng `sum(freight_rate_snapshots.total_amount)` theo lô. Mô hình snapshot là **INSERT-only, supersede** (mỗi lần đổi Ngày vận chuyển hoặc phát lệnh sinh một dòng mới), nên phép cộng nhân bản số cước theo số bản chốt.',
            'Quan sát: lô 298 có 3 bản chốt × 4.791.480 ⇒ Lớp 1 hiển thị **14.374.440**, trong khi Lớp 2/Bảng 2.1 hiển thị đúng **4.791.480**; `receivableTotal` thành **14.624.440**.',
            'Hệ quả: chỉ cần một lần đổi Ngày vận chuyển (hoặc phát lệnh sau khi đã có bản chốt lúc nhập) là bảng kê gửi khách bị nhân số cước.',
        ],
        evidence=[
            ('qa/2026-09-20_ops-pricing-docx-qa/07-debit-l1-list.png',
             'Ảnh — Lớp 1 lô `QATEST-IMP-20260920`: CƯỚC VẬN TẢI (AUTO) 14.374.440 · TỔNG PHẢI THU KHÁCH 14.624.440'),
            ('qa/2026-09-20_ops-pricing-docx-qa/08-debit-l2-tables.png',
             'Ảnh — Lớp 2 cùng lô: Bảng 2.1 = 3.978.000 + 813.480 = 4.791.480 (đúng)'),
        ],
        facts=[
            '`GET /api/shipments/debit-summary?customerId=1` → lô 298: `freightAuto "14374440"`, `receivableTotal "14624440"`, `chiHoTotal "0"`.',
            '`GET /api/shipments/298/debit-detail` → `freightRows[0].contractFreightTotal 4791480`.',
            'DB: `select shipment_id, count(*), sum(total_amount) from freight_rate_snapshots group by 1` → lô 298: `3 | 14374440` ⇒ Lớp 1 = tổng mọi bản chốt.',
        ],
        ac=[
            'Mỗi container/chuyến chỉ lấy **bản chốt mới nhất** (bản bị supersede không cộng vào bất kỳ tổng nào).',
            'Lớp 1 = Σ theo container/chuyến của bản chốt mới nhất; phải khớp Lớp 2 và khớp `debit_note_overrides.final_debit_freight` khi có nhập đè.',
            'Lô đã khóa kỳ vẫn dùng số đóng băng; không đổi lịch sử snapshot.',
            'Regression bắt buộc: lô có 2+ bản chốt (đổi Ngày vận chuyển rồi phát lệnh) — Lớp 1 không được nhân số.',
        ],
        verify=[
            'Local: mở `/shipments-debit` (vai trò `ketoan`/Abc123), chọn khách LONG MINH, đọc dòng `QATEST-IMP-20260920` ở cột CƯỚC VẬN TẢI (AUTO).',
            'Hiện tại 14.374.440; sau khi sửa phải là 4.791.480 (khớp Bảng 2.1 cùng màn).',
        ],
    ),
    dict(
        num='55',
        slug='debit-bang-2-3-chua-xac-dinh-phat-sinh', case_id='TC-CUOC-BUG-03',
        title='Bảng 2.3 “Phí HQGS / Phí Phát sinh” hard-code “Chưa xác định” — chi phí Ops đã nhập không lên bảng kê',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'`Phương án tính cước tự động.docx` §4 (đối soát trên bảng kê) + `testplan/2026-09-18-chi-phi-quyet-toan.md` TC-DN-18-04. Phiên QA: `{SPEC}`, case **TC-CUOC-BUG-03**.',
        desc=[
            '`PayablesTable` (Bảng 2.3 — Phí Phải trả) render cứng `Chưa xác định` cho `Cước trả`, `Phí HQGS`, `Phí Phát sinh`, `Ghi chú`, không đọc `detail.payables`.',
            'API đã trả số thật: `payables.hqgsFee = 250000`, `opsExpenseTotal = 250000` (khoản Ops “Ship Lạch Huyện” của lô 298). Người dùng nhìn bảng kê thấy “Chưa xác định” ⇒ không biết chi phí Ops đã nhập, dễ gửi khách thiếu chi hộ.',
            'Đây là điểm nối còn thiếu giữa màn Ops (“chi phí phát sinh”) và bảng kê/debit note.',
        ],
        evidence=[
            ('qa/2026-09-20_ops-pricing-docx-qa/08-debit-l2-tables.png',
             'Ảnh — Bảng 2.3 lô `QATU1234569 20\'DC`: PHÍ HQGS “Chưa xác định”, PHÍ PHÁT SINH “Chưa xác định” dù Ops đã ghi 250.000đ'),
        ],
        facts=[
            '`GET /api/shipments/298/debit-detail` → `payables: { hqgsFee: 250000, phatSinhFee: 0, opsExpenseTotal: 250000, payableTotal: null }`.',
            '`GET /api/expense-accounting/entries?shipmentId=298` → 1 dòng `sourceKind OPS`, `costGroup OPS_INCIDENTAL`, `feeName "Ship Lạch Huyện"`, `amount 250000`.',
            'Mã nguồn: `frontend/src/features/shipments/debit/ShipmentDebitTables.tsx` → `PayablesTable` (chuỗi `Chưa xác định` cố định).',
        ],
        ac=[
            'Bảng 2.3 hiển thị số theo container: `Cước trả`, `Phí HQGS`, `Phí Phát sinh` lấy từ `detail.payables` (và nguồn chi tiết Ops/điều vận), giữ “Chưa xác định” **chỉ khi** dữ liệu thật sự chưa có.',
            'Số trên bảng phải khớp `/expenses` của kế toán và khớp phiếu quyết toán Ops cùng lô.',
            'Vẫn chỉ-đọc ở mọi kích thước; không mở đường sửa trực tiếp từ bảng kê.',
            'Regression: lô có 1 khoản HQGS + 1 khoản phát sinh → cả hai cột hiện đúng số; lô không có khoản nào → “Chưa xác định”.',
        ],
        verify=[
            'Local: `ketoan`/Abc123 → `/shipments-debit` → chọn LONG MINH → mở `+` dòng `QATEST-IMP-20260920` → đọc Bảng 2.3.',
            'Hiện tại cả ba cột “Chưa xác định”; sau khi sửa, PHÍ HQGS = 250.000 (khoản “Ship Lạch Huyện” đã nhập ở `/ops/orders`).',
        ],
    ),
    dict(
        num='56',
        slug='phai-thu-khach-cong-chi-phi-ops', case_id='TC-CUOC-BUG-04',
        title='“TỔNG PHẢI THU KHÁCH” cộng thẳng chi phí Ops dù số thu khách = 0',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'PRD `docs/prd/OpsVanHanh.md` AC-CP-OPS-02/03 + `Phương án tính cước tự động.docx` §4. Phiên QA: `{SPEC}`, case **TC-CUOC-BUG-04**.',
        desc=[
            '`shipment-debit-summary.service.ts` cộng `hqgsByLot` — tổng `ops_expense_entries.amount` của các loại phí có `forwarder_expense_types.category = "HQGS"` — vào `receivableTotal` (phải thu khách), **không** dùng `customer_charge_amount`.',
            'Khoản Ops mặc định có số thu khách = 0 (`createOpsExpense`: chỉ nhóm `INVOICED_*` mới gán `customerChargeAmount = amount`), nên khoản “Ship Lạch Huyện” 250.000đ bị tính vào tiền phải thu của khách: 4.791.480 → 14.624.440 (kèm sai số bội của ticket #54).',
            'PRD yêu cầu rõ: chi 100.000đ với số thu khách 0đ thì chi phí vẫn 100.000đ nhưng **không** thêm vào debit của khách; hai số độc lập.',
        ],
        evidence=[
            ('qa/2026-09-20_ops-pricing-docx-qa/07-debit-l1-list.png',
             'Ảnh — Lớp 1: TỔNG PHẢI THU KHÁCH 14.624.440 = 14.374.440 (cước, sai bội) + 250.000 (chi phí Ops có số thu khách 0)'),
        ],
        facts=[
            '`debit-summary` lô 298: `receivableTotal "14624440"`, `chiHoTotal "0"`.',
            '`expense-accounting/entries?shipmentId=298` → `customerChargeAmount: 0` cho khoản 250.000.',
            'Mã nguồn: `receivableValue = otherSell + derived + freightByLot + ps + hqgsByLot` (dòng ~231–241).',
        ],
        ac=[
            'Phải thu khách = Σ số thu khách đã chốt (mặc định 0 với khoản Ops không hóa đơn); chi phí Ops chỉ vào phần phải trả/nội bộ.',
            'Khi kế toán/CUS nhập số thu khách > 0 cho khoản chi hộ thì số đó mới vào debit, và chỉ tính một lần.',
            'Không được sửa bằng cách đổi `category` của danh mục phí; sửa ở tầng tính toán.',
            'Regression: 1 khoản Ops số thu khách 0 → debit không đổi; 1 khoản có số thu khách 150.000 → debit +150.000 đúng một lần.',
        ],
        verify=[
            'Local: mở `/shipments-debit` (ketoan) → LONG MINH → dòng `QATEST-IMP-20260920`: so TỔNG PHẢI THU KHÁCH với cước hợp đồng 4.791.480.',
            'Hiện tại 14.624.440; sau khi sửa phải bằng cước hợp đồng (khi số thu khách = 0).',
        ],
    ),
    dict(
        num='57',
        slug='gia-dau-khong-ghi-nguoi-nhap', case_id='TC-CUOC-BUG-05',
        title='Kỳ giá dầu nhập mới không lưu người nhập (created_by = null)',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'`Phương án tính cước tự động.docx` §5.1 (Kế toán/CUS nhập [Ngày hiệu lực] – [Giá dầu DO]) + `testplan/flows/12-cuocphi-phuphi-dau.md` TC-CUOC-020. Phiên QA: `{SPEC}`, case **TC-CUOC-BUG-05**.',
        desc=[
            '`POST /api/config/fuel-price-periods` tạo kỳ giá dầu trả 201 nhưng bản ghi có `created_by = null`; `GET /fuel-price-periods` cũng trả `createdBy: null`.',
            'Kế toán/CUS là người nhập giá dầu — mốc ảnh hưởng trực tiếp tới cước của mọi chuyến sau đó, nên thiếu người nhập làm mất truy vết kiểm toán (không trả lời được “ai nhập 28.000đ từ 19/9?”).',
        ],
        evidence=[],
        facts=[
            '`POST /api/config/fuel-price-periods {effectiveFrom:"2026-09-19", unitPrice:28000}` (ketoan) → **201** `{ id: 5, createdBy: null }`.',
            'DB: `select id, unit_price, effective_from, created_by from fuel_price_periods` → dòng id=5 có `created_by` rỗng (2 dòng seed cũng rỗng).',
            'Đối chứng hành vi đúng: trùng `effective_from` → 409; DRIVER → 403 (đã đạt).',
        ],
        ac=[
            '`fuel_price_periods.created_by` = id người gọi cho mọi bản ghi tạo qua API; hiển thị “Người nhập” trên màn “Giá dầu theo kỳ”.',
            'Giữ nguyên 409 khi trùng `effective_from` và 403 với vai trò không có quyền.',
            'Bản ghi cũ không có người nhập hiển thị “Không xác định”, không gán bừa cho user hiện tại.',
        ],
        verify=[
            'Local: `ketoan`/Abc123 → `/config/fuel-price-periods` → [Thêm mới] một kỳ giá mới → kiểm tra cột “Người nhập” (hiện tại trống).',
        ],
    ),
    dict(
        num='58',
        slug='ghim-thieu-ten-lo-a11y', case_id='TC-OPS-BUG-02',
        title='Nút ghim lệnh mất định danh lô khi lô chưa có mã lô (aria-label “Ghim ”)',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source=f'`2026.9.6_Man_hinh_ops.docx` MÀN HÌNH 1 (nút Action [📍 Ghim]). Phiên QA: `{SPEC}`, case **TC-OPS-BUG-02**.',
        desc=[
            'Trên `/ops/orders`, nút ghim dùng `aria-label` ghép từ `shipment_code`. Phần lớn lô bulk có `shipment_code = null` ⇒ nhãn thành `"Ghim "` (rỗng định danh); lô có mã hiển thị đúng `"Bỏ ghim SHP-2609-00020"`.',
            'Người dùng trình đọc màn hình không biết đang ghim/bỏ ghim lô nào; cũng không đối chiếu được với Bill/Booking đang thấy trên dòng.',
        ],
        evidence=[],
        facts=[
            'DOM dump `/ops/orders` ngày 04/09/2026 (3 lô không có mã lô): `[{"code":"Khai chi phí","pin":"Ghim "}, …×3]` — `qa/scripts/local-pin-aria-20260920.mjs`.',
            'Lô có mã: `aria-label = "Bỏ ghim SHP-2609-00020"` (đúng).',
        ],
        ac=[
            'Nhãn nút ghim luôn kèm định danh dòng: mã lô khi có, ngược lại dùng Bill/Booking (đang hiển thị trên dòng).',
            'Trạng thái ghim/bỏ ghim đọc được từ nhãn (đã đúng: “Ghim …” ↔ “Bỏ ghim …”).',
        ],
        verify=[
            'Local: `giaonhan`/Abc123 → `/ops/orders` → đổi ngày sang 04/09/2026 → inspect `button.ops-pin` của 3 dòng: hiện tại `aria-label="Ghim "`.',
        ],
    ),
    dict(
        num='59',
        slug='qa-env-contract-lech-cong-va-tai-khoan-local',
        case_id='TC-QA-ENV-01',
        title='Lệch hợp đồng môi trường QA: cổng local và danh sách tài khoản local không khớp thực tế checkout',
        status='TODO — phát hiện qua QA 2026-09-20 (local dev, buildHash dev)',
        source='`AGENTS.md` (Local dev quick reference) + `testplan/testaccounts.txt` (mục `local:`). Phiên QA: `testplan/2026-09-20-ops-pricing-docx-qa.md`, case **TC-QA-ENV-01**.',
        desc=[
            '`AGENTS.md` ghi Backend `:3001` · Frontend `:7174`, `testplan/testaccounts.txt` cũng ghi `baseUrl: http://localhost:7174`, nhưng `Makefile` của checkout này chạy backend `:3002` và frontend `:7175` (`docker-compose.dev.yml`, target `dev`). Probe theo tài liệu trả `000/404`; phải đọc Makefile mới biết cổng thật.',
            '`testaccounts.txt` mục `local:` liệt kê `thanhdc/tiepvv/anhdtv…` (CUS), `dungnv/bacdk/huongnt` (DISPATCHER), `hoangnh/hungld…` (OPS) — đây là user của bản `make stgdb`, **không tồn tại** trong DB sau `make setup`/`make seed` (DB dev hiện có 13 user demo: `admin, giamdoc, ketoan, cus, dieuvan, laixe, giaonhan, thu, pho, quyet, customer, samsung-cs, canon-cs`).',
            'Hệ quả: harness `testplan/qa/lib/env.mjs` chọn user theo `accounts.local.<ROLE>[0]` ⇒ tự động lấy `thanhdc` cho CUS và fail login trên DB dev-seed; QA phải tự đặt `QA_USER_CUS=cus`, `QA_USER_OPS=giaonhan`, `QA_USER_DRIVER=laixe`, `QA_USER_DISPATCHER=dieuvan`.',
        ],
        evidence=[],
        facts=[
            '`curl http://localhost:7174/` → 000; `curl http://localhost:7175/` → 200; health backend ở `:3002` trả `{"status":"ok","buildHash":"dev"}`.',
            '`select id, username, role from users` → 13 dòng demo; không có `thanhdc`/`hoangnh`/`dungnv`.',
            'Phiên QA này đã dùng: `giaonhan` (OPS), `ketoan`, `admin`, `cus`, `dieuvan`, `laixe`, `thu`, `qaops2`.',
        ],
        ac=[
            'Một nguồn sự thật duy nhất cho cổng local: hoặc sửa `AGENTS.md` + `testaccounts.txt` theo `Makefile`, hoặc đổi `Makefile` về `:3001/:7174` — không để hai tài liệu nói khác nhau.',
            '`testaccounts.txt` mục `local:` tách rõ hai chế độ: DB dev-seed (13 user demo) và DB `make stgdb` (user prod-mirror), hoặc `env.mjs` fallback sang `demoUsers` khi user staging-mirror không tồn tại.',
            'Chạy `node testplan/qa/scripts/smoke.mjs` trên local dev-seed phải PASS cho mọi vai trò mà không cần biến `QA_USER_*` thủ công.',
        ],
        verify=[
            'Local: `make dev` rồi `curl -s localhost:3002/api/health` và `curl -so /dev/null -w "%{http_code}" localhost:7175/`.',
            'Đối chiếu `testplan/testaccounts.txt` mục `local.users` với `select username, role from users` trên DB `silversea` sau `make setup`.',
        ],
    ),
]


def render(card: dict) -> str:
    lines = [f"## {card['title']}", '', f"Trạng thái: {card['status']}", '', f"Nguồn: {card['source']}", '', '### Mô tả lỗi', '']
    lines += [f"- {p}" for p in card['desc']]
    lines += ['', '### Bằng chứng', '']
    lines += [f"- {f}" for f in card['facts']]
    for rel, caption in card['evidence']:
        lines += ['', f"![{caption}]({REPO / rel})", '', f"*{caption}*", '', f"Tệp: `{rel}`"]
    lines += ['', '### Tiêu chí nghiệm thu', '']
    lines += [f"{i}. {a}" for i, a in enumerate(card['ac'], 1)]
    lines += ['', '### Hướng dẫn xác minh', '']
    lines += [f"{i}. {v}" for i, v in enumerate(card['verify'], 1)]
    lines += ['', '### Case QA', '', f"`{card['case_id']}` — `{SPEC}` (mục 2). Chạy lại ca này trước khi chuyển card sang QA_PASSED.", '']
    return '\n'.join(lines)


def main() -> None:
    for card in CARDS:
        md = render(card)
        name = f"20260920_{card['num']}-{card['slug']}"
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as fh:
            fh.write(md)
            src = fh.name
        out = KANBAN / f"{name}.docx"
        subprocess.run(['pandoc', src, '-o', str(out), '--from', 'markdown', '--resource-path', str(REPO)], check=True)
        print(f'wrote {out.name} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
