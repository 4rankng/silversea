# Business-Logic Q&A — TingTing Default Proposals (Silver Sea)

> **Source:** `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`
> (original Vietnamese title: _Câu hỏi và đề xuất trả lời logic nghiệp vụ — Silver Sea_).
> Authored by **TingTing**, dated 2026-07-26.
>
> **Status:** **Approved requirements.** On 2026-07-27, SilverSea approved every
> `TingTing đề xuất` in Q01-Q23 as written and instructed TingTing to implement
> them. The governing rule remains unchanged: monetary thresholds, rates and
> schedules must be configuration-driven.

## How to use this document

- Each Q has a stable ID (`Q01`…`Q23`) grouped by theme.
- The **Đề xuất (Proposal)** column reproduces TingTing's default verbatim (Vietnamese).
- The **Status** column tracks Silver Sea's sign-off: `pending` (default), `accepted`,
  `rejected`, or `modified` (with the agreed change recorded inline).
- When an item flips to `accepted`/`modified`, update the matching wave in `ROADMAP.md`
  (its "Open PRD questions" section) and the relevant phase plan.

---

## Status legend

| Status     | Meaning                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `pending`  | TingTing default proposed; Silver Sea has not yet responded. **Default — do not implement as locked spec.** |
| `accepted` | Silver Sea confirmed the default in writing; implement as specified.                                        |
| `modified` | Silver Sea confirmed with a change; the agreed value is recorded inline.                                    |
| `rejected` | Silver Sea rejected; re-open the question.                                                                  |

---

## 1. Công nợ phải thu và nhắc thanh toán (AR & payment reminders)

### Q01 — Early-warning threshold for credit limit

> Silver Sea muốn cảnh báo sớm ở mức bao nhiêu phần trăm hạn mức công nợ? Mức này dùng chung hay cấu hình riêng cho từng khách hàng?

**Đề xuất trả lời (TingTing):** Áp dụng ngưỡng cảnh báo sớm mặc định **80%** và cảnh báo vượt hạn mức tại **100%**. Mức 80% dùng chung khi tạo khách hàng mới nhưng phải cho phép cấu hình riêng theo từng khách hàng. Số dùng để kiểm tra gồm dư nợ hiện tại, các khoản đã duyệt nhưng chưa thu và giá trị dự kiến của lô hoặc chuyến mới.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M5.3 §1` (Wave 3) and cross-cutting #2.

### Q02 — Who can approve service continuation beyond credit limit; tiered approval?

> Khi vượt hạn mức, chức danh nào được phép cho tiếp tục cung cấp dịch vụ? Có phân cấp phê duyệt theo số tiền hoặc tỷ lệ vượt không?

**Đề xuất trả lời (TingTing):** CUS và điều vận không được tự cho vượt hạn mức. **Trưởng phòng Tài chính/Kế toán** được duyệt ngoại lệ cấp 1 khi phần vượt không quá **10%** và không vượt ngưỡng tiền được cấu hình; **Giám đốc** duyệt các trường hợp lớn hơn hoặc lặp lại. Mỗi phê duyệt chỉ áp dụng cho một lô/chuyến hoặc đến ngày hết hạn cụ thể và bắt buộc ghi lý do.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M5.3 §5` (Wave 3).

### Q03 — Payment allocation when customer doesn't specify

> Khi tiền về không ghi rõ khoản cần thanh toán, hệ thống phân bổ theo khoản nợ cũ nhất, theo tỷ lệ, ưu tiên cước vận chuyển hay nguyên tắc khác? Khoản thanh toán thừa được giữ chưa phân bổ hay chuyển hoàn trả?

**Đề xuất trả lời (TingTing):** Ưu tiên chỉ dẫn thanh toán của khách hàng. Nếu không có chỉ dẫn, **phân bổ theo khoản đến hạn cũ nhất**; nếu cùng ngày đến hạn thì theo ngày phát hành cũ nhất. **Không phân bổ theo tỷ lệ hoặc ưu tiên cước vận tải theo mặc định**. Tiền thừa giữ ở trạng thái chưa phân bổ của khách hàng; chỉ hoàn trả khi có yêu cầu và phê duyệt.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M5.4 §5` (Wave 3) and the M5.6 allocator default. **Note:** the implemented M5.6 allocator already defaults to oldest-first — this proposal confirms that default.

### Q04 — Reminder schedule, frequency, quiet hours, holidays

> Hệ thống nhắc thanh toán vào thời điểm nào, lặp lại với tần suất nào và có khung giờ, cuối tuần hoặc ngày lễ không được gửi không?

**Đề xuất trả lời (TingTing):** Lịch mặc định: **trước hạn 3 ngày, đúng ngày đến hạn, sau hạn 3 ngày, sau đó mỗi 7 ngày**. Chỉ gửi từ **08:00 đến 17:30 trong ngày làm việc**; lịch rơi vào cuối tuần hoặc ngày lễ chuyển sang 09:00 ngày làm việc tiếp theo. Tối đa một thông báo tổng hợp cho mỗi khách hàng mỗi ngày; dừng nhắc khi đã thanh toán đủ, đang tranh chấp hoặc bị tạm dừng.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M5.7 §4` (Wave 3, item `wave3-m57-reminder-job` is **already implemented** — proposal now defines its hardening: quiet hours + holiday roll + 1/day cap).

### Q05 — Channel priority: email vs in-app; retry & fallback

> Kênh nào được ưu tiên giữa email và thông báo trong hệ thống? Khi gửi thất bại, hệ thống thử lại bao nhiêu lần và có tự chuyển sang kênh dự phòng không?

**Đề xuất trả lời (TingTing):** Đối với khách hàng, **email là kênh chính**; thông báo trong hệ thống được tạo đồng thời để dự phòng và lưu vết. Đối với nhân viên nội bộ, thông báo trong hệ thống là kênh chính. Email lỗi được thử lại **3 lần, lần lượt sau 15 phút, 2 giờ và 24 giờ**; sau đó đánh dấu thất bại và báo CUS xử lý. Thông báo trong hệ thống không được coi là bằng chứng email đã gửi thành công.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves part of `M5.7 §4` + cross-cutting #4 (notifications). Wave-2 email service + Wave-0 scheduler already provide the retry hook; this proposal pins the exact retry cadence.

---

## 2. Công nợ phải trả, nhiên liệu và nhà cung cấp (AP, fuel & suppliers)

### Q06 — Multi-truck fuel invoices & allocation basis

> Hóa đơn nhiên liệu được quản lý theo từng xe hay có thể gồm nhiều xe? Nếu gồm nhiều xe, số lít và số tiền được phân bổ theo căn cứ nào?

**Đề xuất trả lời (TingTing):** Cho phép một hóa đơn nhiên liệu **gồm nhiều xe**. Hóa đơn được lưu một lần, bên dưới có các dòng phân bổ theo xe. Căn cứ ưu tiên là phiếu hoặc nhật ký đổ nhiên liệu thực tế theo biển số, ngày và số lits; số tiền của từng xe được tính theo số lit thực tế và đơn giá hóa đơn. **Không chia đều; thiếu căn cứ thì giữ chưa phân bổ và chưa cho duyệt.**

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M6.1 §1` (Wave 3, item `wave3-m61-fuel-ap-recon` is **already implemented** at the per-truck-invoice level — proposal now adds the multi-truck-invoice line-allocation requirement as a hardening item).

### Q07 — Multiple service categories per supplier + primary category

> Một nhà cung cấp có thể thuộc nhiều nhóm dịch vụ cùng lúc không? Nếu có, có cần một nhóm chính cho báo cáo không?

**Đề xuất trả lời (TingTing):** Cho phép một nhà cung cấp **thuộc nhiều nhóm dịch vụ**. Mỗi nhà cung cấp có một **nhóm chính** để làm giá trị mặc định và phục vụ báo cáo tổng hợp; từng hóa đơn hoặc khoản chi vẫn phải ghi đúng nhóm dịch vụ thực tế. Nhóm chính không được tự động thay đổi phân loại của giao dịch.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M6.2 §1` (Wave 3, item `wave3-m62-supplier-type-taxonomy` is **in-progress** — proposal confirms multi-type-per-supplier + primary-type design).

### Q08 — Customer ⇄ supplier duality; can AR/AP be offset?

> Khi một đơn vị vừa là khách hàng vừa là nhà cung cấp, hệ thống dùng chung một đối tác hay tách hai hồ sơ? Có cho phép đối trừ công nợ giữa hai vai trò không?

**Đề xuất trả lời (TingTing):** Dùng **một hồ sơ đối tác chung theo mã số thuế**, gắn đồng thời vai trò Khách hàng và Nhà cung cấp; sổ phải thu và phải trả vẫn tách riêng. Cho phép đối trừ **nhưng không tự động**: chỉ thực hiện với cùng pháp nhân và cùng loại tiền, có biên bản và phê duyệt, **số đối trừ không vượt số nhỏ hơn giữa phải thu và phải trả**.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves cross-cutting partner-duality + informs M6.4 (`debt_offsets` rules). Confirms existing M6.4 invariant "offset ≤ smaller side" + adds "must have minutes + approval, never auto".

---

## 3. Chốt kỳ lương (Salary period close)

### Q09 — Period scope: company-wide or per-driver?

> Kỳ lương được chốt cho toàn công ty hay có thể chốt riêng từng lái xe?

**Đề xuất trả lời (TingTing):** Chốt theo **kỳ lương chung của toàn công ty** hoặc của một đơn vị trả lương được cấu hình, **không chốt độc lập từng lái xe**. Trước khi chốt, từng lái xe có trạng thái Sẵn sàng hoặc Chờ xử lý để hệ thống kiểm tra đầy đủ.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M7.3 §1` (Wave 3). Confirms the assumed "per-company-period" default.

### Q10 — Block entire period on driver error or allow partial close?

> Nếu một lái xe còn thiếu hoặc xung đlict dữ liệu, hệ thống chặn chốt toàn kỳ hay cho phép chốt phần còn lại?

**Đề xuất trả lời (TingTing):** Mặc định **chặn chốt toàn kỳ** nếu còn lỗi ảnh hưởng đến số tiền. Chỉ cho phép chốt phần còn lại khi người có thẩm quyền phê duyệt loại lái xe đó khỏi kỳ chính; lái xe bị đánh dấu Chờ bổ sung và được xử lý bằng kỳ lương bổ sung hoặc khoản điều chỉnh. **Không được âm thầm bỏ qua.**

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** adds a new behavioral rule for M7.3 (Wave 3). Partial-close allowed only with approver + reason; marked drivers roll to supplementary period.

### Q11 — Post-close changes: reopen or adjustment?

> Sau khi đã chốt, thay đổi được xử lý bằng cách mở lại kỳ hay tạo khoản điều chỉnh ở kỳ sau? Ai được quyền chốt và mở lại kỳ?

**Đề xuất trả lời (TingTing):** Sau khi chốt, **ưu tiên tạo khoản điều chỉnh ở kỳ đang mở**. Chỉ mở lại kỳ khi chưa phát hành phiếu lương, chưa thanh toán và chưa hạch toán chính thức. Kế toán lập, Trưởng phòng Tài chính/Kế toán chốt; **Giám đốc hoặc người được ủy quyền mới được mở lại**. Sau khi thanh toán hoặc hạch toán, chỉ dùng bản điều chỉnh hoặc hoàn tác.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** adds post-close governance to M7.3 (Wave 3). Maps onto the existing lock semantics — reopen only pre-issue, adjustment-note only post-payment.
- **Ánh xạ vai trò triển khai:** `ACCOUNTANT` là nhân sự Kế toán lập yêu cầu chốt kỳ; `MANAGER` là Trưởng phòng Tài chính/Kế toán hoặc người quản lý được ủy quyền; `ADMIN` là Giám đốc hoặc quyền quản trị khẩn cấp có ghi vết. Chỉ `MANAGER`/`ADMIN` được kiểm tra và chốt kỳ. Việc mở lại chỉ dành cho `MANAGER`/`ADMIN`, đồng thời người lập, người kiểm tra và người duyệt phải là ba tài khoản khác nhau.

---

## 4. Khoản chi không có hóa đơn (No-invoice disbursements)

### Q12 — Which categories allow no-invoice + accepted substitute evidence

> Những nhóm chi phí nào được phép ghi nhận khi không có hóa đơn, và loại căn cứ thay thế nào được chấp nhận cho từng nhóm?

**Đề xuất trả lời (TingTing):** Thiết lập **danh sách hạng mục được phép**. Mặc định gồm **bốc xếp hoặc lao động thời vụ tại hiện trường, vé bãi/đò/đường hoặc phí nhỏ có phiếu lẻ, xử lý khẩn cấp tại cảng/kho và vật tư nhỏ phục vụ chuyến**. Căn cứ thay thế được chấp nhận gồm **phiếu thu/biên nhận/vé, chứng từ chuyển khoản hoặc ví điện tử, ảnh hiện trường có thời gian và địa điểm, hoặc xác nhận ký nhận của người nhận/quản lý**. Bắt buộc có số tiền, ngày, người nhận, lô hoặc chuyến, lý do và ít nhất một bằng chứng.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M4.7 §2` (Wave 3). Provides the default category list + evidence taxonomy to seed `expense_categories.requiresInvoice`/`substituteEvidenceAllowed`.

### Q13 — Per-item and per-day-per-person thresholds

> Có ngưỡng tối đa theo từng khoản hoặc tổng trong ngày không?

**Đề xuất trả lời (TingTing):** Có. Đề xuất khởi tạo mức **1.000.000 đồng cho mỗi khoản** và **5.000.000 đồng cho mỗi người trong một ngày**; các mức này phải cấu hình được theo hạng mục và chức danh. Hệ thống **cộng gộp** các khoản cùng người, cùng ngày và cùng hạng mục để ngăn việc chia nhỏ khoản chi.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** adds configurable per-item / per-day-per-person caps + anti-splitting aggregation rule for M4.7 (Wave 3).

### Q14 — Over-threshold or missing-evidence: auto-reject or route to approval?

> Khi vượt ngưỡng hoặc thiếu căn cứ, hệ thống tự từ chối hay chuyển phê duyệt? Chức danh nào được duyệt và có phân cấp theo số tiền không?

**Đề xuất trả lời (TingTing):** Thiếu bằng chứng tối thiểu thì **trả lại để bổ sung, không chuyển thẳng sang phê duyệt**. Vượt ngưỡng nhưng đủ căn cứ thì chuyển phê duyệt: **Trưởng phòng Tài chính/Kế toán duyệt đến 5.000.000 đồng cho mỗi khoản**; trên mức đó hoặc tổng trong ngày vượt 10.000.000 đồng thì **Giám đốc duyệt**. Người tạo không được tự duyệt; mọi ngoại lệ phải ghi rõ lý do.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves `M4.7 §5` (Wave 3). Sets the rule: missing-evidence = return (not approve), over-threshold-but-complete = tiered approve (chief accountant ≤5M, director >5M or >10M/day).

---

## 5. Vai trò, quyền thao tác và phạm vi dữ liệu (Roles, actions & data scope)

### Q15 — Maker/checker/approver/viewer split; self-approval allowed?

> Với từng nhóm nghiệp vụ, ai được tạo, kiểm tra, phê duyệt và chỉ xem? Người tạo có được tự phê duyệt dữ liệu của mình không?

**Đề xuất trả lời (TingTing):** Áp dụng nguyên tắc **tách người tạo, người kiểm tra và người phê duyệt** đối với tiền, giá, công nợ, ngoại lệ, chốt kỳ và điều chỉnh. **Người tạo không được tự phê duyệt dữ liệu của mình.** Các cập nhật vận hành thông thường như tiến độ chuyến hoặc bổ sung chứng từ có thể do người phụ trách tự lưu; khi làm thay đổi tiền hoặc trạng thái đã chốt thì phải qua kiểm tra và phê duyệt. Quyền chỉ xem không được sửa hoặc duyệt.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves cross-cutting #1 (roles & permissions) for the money/price/debt/exception/period-close surface. Codifies the maker-checker-approver separation already informally assumed across waves.

### Q16 — Customer account scope: 1 customer or many?

> Vai trò Khách hàng chỉ được xem dữ liệu của chính khách hàng đó hay có trường hợp một tài khoản được xem nhiều khách hàng?

**Đề xuất trả lời (TingTing):** Mặc định một tài khoản Khách hàng chỉ xem dữ liệu của **một pháp nhân khách hàng**. Chỉ cho phép xem nhiều khách hàng đối với **tài khoản tập đoàn hoặc đại lý** được quản trị viên liên kết rõ từng khách hàng; dữ liệu, chứng từ và công nợ vẫn phải tách theo từng pháp nhân. **Không cấp quyền chỉ dựa trên tên miền email.**

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves the CUSTOMER portal scope question (Wave 2, customer portal auth method + Wave-0 row-scope). Confirms Wave-0 `scopedByCustomer` default of 1:1; adds the corporate/agent multi-link variant as a follow-up.

### Q17 — Clerk (Nhân viên chứng từ) editable surface + scope

> Vai trò Nhân viên chứng từ được tạo và sửa những phần nào, và phạm vi được giới hạn theo khách hàng, lô hàng hay đơn vị phụ trách?

**Đề xuất trả lời (TingTing):** Nhân viên chứng từ được tạo và sửa **hồ sơ lô, vận đơn, công-te-nơ, niêm phong, tờ khai, lệnh giao hàng, điểm nhận/giao và tệp chứng từ**. Trước khi chuyển điều vận được sửa trực tiếp; sau khi chuyển chỉ được bổ sung thông tin không làm đổi kế hoạch. Thay đổi khách hàng, công-te-nơ, thời gian hoặc địa điểm phải tạo phiên bản mới và thông báo điều vận. Phạm vi giới hạn **đồng thời theo đơn vị phụ trách và khách hàng/lô được giao**; không có quyền sửa giá, chi phí, công nợ hoặc lương.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves CLERK role scope (Wave 4, M10.1/M10.2 + Wave-0 CLERK casbin rows). Defines the pre-dispatch/post-dispatch edit boundary and the dual scope (unit + customer/shipment).

### Q18 — Editing approved/locked data: who, with reason / adjustment note?

> Sau khi dữ liệu đã duyệt hoặc đã chốt, ai được phép sửa và có bắt buộc ghi lý do hoặc tạo bản điều chỉnh không?

**Đề xuất trả lời (TingTing):** Dữ liệu đã duyệt hoặc đã chốt **không được sửa trực tiếp**. Người có quyền chỉ được tạo **bản điều chỉnh hoặc hoàn tác**; mở lại chỉ là ngoại lệ trước khi phát hành hoặc hạch toán. Bắt buộc ghi lý do, lưu giá trị trước và sau, người thực hiện và người duyệt. Quản lý nghiệp vụ xử lý dữ liệu vận hành; Trưởng phòng Tài chính/Kế toán xử lý dữ liệu tiền; mở kỳ do Giám đốc hoặc người được ủy quyền.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** cross-cutting rule — already implemented in spirit by `version` optimistic lock + `audit_logs` + Wave-0 status-history append-only. This proposal makes the "adjustment-note, never in-place edit" rule explicit across all locked surfaces.

---

## 6. Ngày giờ, kỳ nghiệp vụ và liên kết giữa các phân hệ (Time, periods & cross-module linkage)

### Q19 — Payment due / processing date on weekend or holiday

> Khi hạn thanh toán hoặc ngày xử lý rơi vào cuối tuần hoặc ngày lễ, hệ thống giữ nguyên ngày hay chuyển sang ngày làm việc tiếp theo?

**Đề xuất trả lời (TingTing):** Mặc định **chuyển hạn xử lý sang ngày làm việc tiếp theo**, nhưng vẫn lưu và hiển thị ngày gốc theo hợp đồng. Việc tính quá hạn và gửi nhắc dựa trên ngày đã điều chỉnh. Nếu hợp đồng quy định phải tính theo ngày lịch thì **quy tắc của hợp đồng được ưu tiên**.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves cross-cutting #3 (date/time & periods). Adds a configurable "next-business-day" roll with contract-override.

### Q20 — Trip spanning two periods: which period?

> Chuyến bắt đầu một ngày và kết thúc ngày hôm sau được tính vào kỳ theo ngày bắt đầu, ngày kết thúc hay quy tắc khác?

**Đề xuất trả lời (TingTing):** Doanh thu chuyến, lương chuyến, số chuyến và lợi nhuận được ghi vào **kỳ của ngày hoàn thành chuyến**. Chấm công, nhiên liệu và khoản chi được ghi theo ngày phát sinh thực tế. Ngày bắt đầu vẫn dùng cho điều vận và tìm kiếm; chuyến chưa hoàn thành tại cuối kỳ được đánh dấu Đang thực hiện và chưa tính là số chính thức.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves cross-cutting #3 — sets the rule "revenue/salary/trip-count → completion-date period; attendance/fuel/expense → actual-event date; in-progress trips excluded from official period totals".

### Q21 — Period lock granularity: week/month/custom; late data → next period or adjust old?

> Các kỳ lương, giấy báo nợ và nhiên liệu được khóa theo tuần, tháng hay quy tắc riêng? Dữ liệu phát sinh sau khi khóa được chuyển kỳ sau hay điều chỉnh kỳ cũ?

**Đề xuất trả lời (TingTing):** **Lương và nhiên liệu khóa theo tháng. Giấy báo nợ khóa theo chu kỳ thanh toán của từng khách hàng**, mặc định theo tháng và chỉ theo tuần khi hợp đồng quy định. Dữ liệu đến muộn sau khi khóa được đưa vào kỳ đang mở **dưới dạng điều chỉnh có liên kết về kỳ gốc**; không sửa trực tiếp kỳ cũ. Chỉ mở lại trước khi phát hành hoặc thanh toán và phải được phê duyệt.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves cross-cutting #3 + `M4.5 §6` (Wave 2, period definition) + M7.3 period-close (Wave 3). Lock granularity now defined: salary/fuel = monthly, debit-note = customer payment cycle (default monthly, weekly only if contract says so).

### Q22 — Source-of-truth & recompute vs adjustment in the chain

> Trong chuỗi lô hàng - chuyến xe - chi phí - giấy báo nợ - công nợ, dữ liệu nào là nguồn chính? Khi nguồn thay đổi trước và sau khi chốt, hệ thống tự tính lại hay tạo bản điều chỉnh?

**Đề xuất trả lời (TingTing):** Nguồn chính được xác định theo từng loại dữ liệu: **lô hàng** giữ thông tin khách hàng, hàng và công-te-nơ; **chuyến xe** giữ xe, lái xe, thời gian và trạng thái thực tế; **khoản chi đã duyệt** giữ chi phí; **giấy báo nợ đã phát hành** giữ số phải thu; **khoản tiền về và phân bổ** giữ số đã thanh toán và còn nợ. Trước khi chốt, thay đổi nguồn **tự tính lại** các phần phụ thuộc và cảnh báo người liên quan. Sau khi chốt hoặc phát hành, **không ghi đè mà tạo phiên bản, bản điều chỉnh hoặc hoàn tác** và giữ đầy đủ lịch sử.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** resolves cross-cutting #7 (cross-module integration & number drift). Codifies the source-of-truth table for each link in the shipment → trip → expense → debit-note → AR chain + the "recompute pre-lock, versioned-adjustment post-lock" rule.

### Q23 — Double-submit, flaky network, concurrent edit/approve

> Khi người dùng bấm gửi hai lần, mạng chập chờn hoặc hai người cùng sửa/phê duyệt, hệ thống ngăn dữ liệu trùng và xử lý xung đột theo nguyên tắc nào?

**Đề xuất trả lời (TingTing):** Mỗi thao tác gửi có một **mã giao dịch duy nhất**; gửi lại cùng mã trả về kết quả đã có và không tạo thêm bản ghi. Các số lô, chuyến và chứng từ có quy tắc duy nhất để chặn trùng. Khi hai người cùng sửa, **người lưu sau phải tải lại phiên bản mới và không được ghi đè tự động**. Khi hai người cùng duyệt, phê duyệt hợp lệ đầu tiên khóa trạng thái; lần sau bị từ chối. Mọi lần thử và xung đột phải được lưu trong nhật ký.

- **Status:** `accepted` — SilverSea, 2026-07-27
- **ROADMAP impact:** cross-cutting. Partially implemented via `version` optimistic lock (409 on stale) + unique constraints + audit_logs. This proposal adds: (a) idempotency-key on every write (currently absent), (b) first-approve-wins explicit rejection message, (c) conflict-attempt audit logging.

---

## Nguyên tắc áp dụng (governing rule, verbatim)

> Các ngưỡng tiền nêu trên là mức quản trị nội bộ đề xuất và phải cấu hình được, không thay thế quy định thuế hoặc kế toán. Mọi ngoại lệ phải ghi rõ người phê duyệt, lý do, phạm vi và thời hạn hiệu lực.

**Engineering implication:** every money threshold, rate, and schedule in this document must be **configuration-driven** (env vars, `app_config`, or per-row columns), not hard-coded constants. Default values per this document are seed data only.

---

## Approved staging-QA addenda (2026-07-27)

### O01 — Two-way dispatch authority

**TingTing proposal accepted:** each candidate trip requires planned
start/end, canonical origin/destination, cargo weight and vehicle capacity.
Pairing must enforce no time overlap, sufficient repositioning time,
compatible next origin and no overload; it must preserve each trip's
independent status, revenue and cost. Cancellation, late completion,
cross-day operation and concurrent pairing require explicit handling.

- **Status:** `accepted` — SilverSea, 2026-07-27

### O02 — ACCOUNTANT audit-log access

**TingTing proposal accepted:** ACCOUNTANT may read audit entries related to
money, receivables, payments and salary within assigned scope, but may not see
security configuration, login-sensitive information or unrelated data.

- **Status:** `accepted` — SilverSea, 2026-07-27

### Staging GPS evidence

SilverSea approved simulated GPS coordinates for staging verification. Real
device GPS remains an optional production-acceptance check rather than a
staging blocker.
