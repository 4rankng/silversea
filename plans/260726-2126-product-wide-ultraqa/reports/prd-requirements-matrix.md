# SilverSea product-wide PRD requirements matrix

Generated for functional and visual UltraQA on 2026-07-26. This inventory is exhaustive over the numbered functional sections, their five section-level acceptance cases, and each module-wide acceptance criterion in `docs/prd/Module1.docx` … `Module12.docx`, plus Q01–Q23.

## Authority and status interpretation

- Authority order: current user scope → `AGENTS.md` → accepted/modified Q&A decisions → current code/tests → `ROADMAP.md`/plans → handoff. Source: `CONTEXT.md` §Authority order.
- Every Module DOCX explicitly says its TingTing proposal becomes formal only after Silver Sea confirms it. The customer-response cells are empty. Therefore every module rule/criterion below has **authority: pending decision**, even where delivery status is implemented.
- Q01–Q23 all have `Status: pending`; they are not approved requirements. Monetary thresholds/schedules are proposed configurable seed defaults only.
- Delivery status is roadmap-derived, not a fresh pass/fail claim. `implemented` means the roadmap records the surface as shipped/reconciled; `partial` means code exists but an explicit decision or enforcement gap remains; `not found` means the roadmap names a real gap. Functional/visual QA must still verify every item.
- No current section is classified `roadmap` because `ROADMAP.md` marks Waves 0–4 complete. The still-open decisions are classified `partial` or `pending decision`, not future delivery.

## Status summary

- **implemented:** 50 numbered module sections
- **partial:** 15 numbered module sections
- **roadmap:** 0 numbered module sections
- **pending decision:** 0 numbered module sections
- **not found:** 1 numbered module sections
- **pending decision:** all numbered module sections as product authority, all shared module acceptance criteria, and Q01–Q23.

## Shared test contract across all modules

The following common confirmation topics recur in every Module DOCX under “Câu hỏi dùng chung cần chốt”. They are customer decisions, not approved defaults:
- **Vai trò và quyền truy cập:** Chốt người tạo, người kiểm tra, người duyệt và người chỉ được xem trong Phân hệ 1. — authority `pending decision`.
- **Dữ liệu danh mục cần cung cấp:** Silver Sea xác nhận danh mục ban đầu, người phụ trách và thời hạn cung cấp trước khi nhập thử. — authority `pending decision`.
- **Ngày giờ và kỳ nghiệp vụ:** Dùng giờ Việt Nam; chốt cách xử lý cuối tuần, ngày lễ, dữ liệu qua ngày và khóa kỳ. — authority `pending decision`.
- **Thông báo:** Chốt sự kiện cần thông báo, người nhận, kênh gửi và cách xử lý khi gửi thất bại. — authority `pending decision`.
- **Tệp đính kèm và tệp xuất:** Chốt loại tệp, dung lượng, thời hạn lưu, người được tải xuống và mẫu tài liệu chính thức. — authority `pending decision`.
- **Dữ liệu lịch sử:** Chốt phạm vi nhập dữ liệu cũ, cách kiểm tra tổng đầu kỳ và trách nhiệm xác nhận. — authority `pending decision`.
- **Tích hợp với phân hệ khác:** Xác nhận dữ liệu đầu vào, đầu ra và thời điểm đồng bộ để tránh nhập lặp hoặc lệch số liệu. — authority `pending decision`.
- **Hỗ trợ sau triển khai:** Chốt đầu mối, cách ghi nhận lỗi, mức độ ưu tiên và bằng chứng xác nhận đã khắc phục. — authority `pending decision`.

## Numbered module requirements and acceptance criteria

# M1 — PHÂN HỆ 1 — TỔNG QUAN VÀ ĐIỀU VẬN CHUYẾN XE

## 1.1 — Bảng điều hành doanh thu, chi phí, lợi nhuận và số chuyến

- **Delivery:** `partial` — ROADMAP.md §Current codebase coverage (dashboard polish remains).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Bảng điều hành doanh thu, chi phí, lợi nhuận và số chuyến.
- **Roles stated by source:** Giám đốc và kế toán theo phạm vi được phân quyền
- **Business need / visible outcome:** Giám đốc và kế toán theo phạm vi được phân quyền cần bảng điều hành doanh thu, chi phí, lợi nhuận và số chuyến. Kết quả mong muốn: hiển thị bốn chỉ số chính, số liệu so sánh kỳ trước và đường dẫn tới danh sách chi tiết
- **Required data:** kỳ báo cáo, đơn vị vận hành và trạng thái chuyến
- **Core rule:** Chỉ cộng số liệu của chuyến thuộc kỳ và phạm vi được chọn; định nghĩa rõ số liệu tạm tính và số liệu đã chốt
- **Displayed/saved result:** Hiển thị bốn chỉ số chính, số liệu so sánh kỳ trước và đường dẫn tới danh sách chi tiết
- **Exception:** Kỳ không có dữ liệu phải hiển thị số không và thông báo rõ, không để ô trống gây hiểu nhầm
- **Boundary cases:** Kỳ ngày, tuần, tháng, quý; dữ liệu đang chạy và dữ liệu đã chốt
- **Section summary:** Chỉ cộng số liệu của chuyến thuộc kỳ và phạm vi được chọn; định nghĩa rõ số liệu tạm tính và số liệu đã chốt
- **Source:** `docs/prd/Module1.docx` §1.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-01-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm kỳ báo cáo, đơn vị vận hành và trạng thái chuyến. **Expected:** Hiển thị bốn chỉ số chính, số liệu so sánh kỳ trước và đường dẫn tới danh sách chi tiết
- `M01-01-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M01-01-03` **Trường hợp biên:** Kiểm tra: Kỳ ngày, tuần, tháng, quý; dữ liệu đang chạy và dữ liệu đã chốt **Expected:** Kết quả tuân thủ quy tắc: Chỉ cộng số liệu của chuyến thuộc kỳ và phạm vi được chọn; định nghĩa rõ số liệu tạm tính và số liệu đã chốt
- `M01-01-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M01-01-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 1.2 — Biểu đồ xu hướng và xếp hạng xe hoặc tuyến

- **Delivery:** `partial` — ROADMAP.md §Current codebase coverage (dashboard polish remains).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Biểu đồ xu hướng và xếp hạng xe hoặc tuyến.
- **Roles stated by source:** Giám đốc, quản lý và kế toán
- **Business need / visible outcome:** Giám đốc, quản lý và kế toán cần biểu đồ xu hướng và xếp hạng xe hoặc tuyến. Kết quả mong muốn: biểu đồ và bảng xếp hạng phải khớp số liệu chi tiết và thể hiện rõ đơn vị tính
- **Required data:** khoảng ngày, tiêu chí xếp hạng, xe, tuyến và khách hàng
- **Core rule:** Xếp hạng theo chỉ tiêu đã chọn; trường hợp bằng nhau dùng doanh thu rồi số chuyến làm tiêu chí phụ
- **Displayed/saved result:** Biểu đồ và bảng xếp hạng phải khớp số liệu chi tiết và thể hiện rõ đơn vị tính
- **Exception:** Xe hoặc tuyến thiếu chi phí phải được đánh dấu “Chưa đủ dữ liệu”, không xếp hạng lợi nhuận sai
- **Boundary cases:** Khoảng ngày giao nhau hai tháng; nhiều xe bằng điểm; tuyến không có chuyến
- **Section summary:** Xếp hạng theo chỉ tiêu đã chọn; trường hợp bằng nhau dùng doanh thu rồi số chuyến làm tiêu chí phụ
- **Source:** `docs/prd/Module1.docx` §1.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-02-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm khoảng ngày, tiêu chí xếp hạng, xe, tuyến và khách hàng. **Expected:** Biểu đồ và bảng xếp hạng phải khớp số liệu chi tiết và thể hiện rõ đơn vị tính
- `M01-02-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M01-02-03` **Trường hợp biên:** Kiểm tra: Khoảng ngày giao nhau hai tháng; nhiều xe bằng điểm; tuyến không có chuyến **Expected:** Kết quả tuân thủ quy tắc: Xếp hạng theo chỉ tiêu đã chọn; trường hợp bằng nhau dùng doanh thu rồi số chuyến làm tiêu chí phụ
- `M01-02-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M01-02-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 1.3 — Tạo, điều vận và theo dõi trạng thái chuyến xe

- **Delivery:** `implemented` — ROADMAP.md §Current codebase coverage (M1 largely done).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tạo, điều vận và theo dõi trạng thái chuyến xe.
- **Roles stated by source:** Điều vận tạo chuyến; kế toán bổ sung số liệu; quản lý hoặc kế toán chốt
- **Business need / visible outcome:** Điều vận tạo chuyến; kế toán bổ sung số liệu; quản lý hoặc kế toán chốt cần tạo, điều vận và theo dõi trạng thái chuyến xe. Kết quả mong muốn: danh sách và chi tiết hiển thị đúng trạng thái, người phụ trách và lịch sử chuyển trạng thái
- **Required data:** khách hàng, tuyến, xe, rơ-moóc, lái xe, thời gian và loại hàng
- **Core rule:** Trạng thái đi theo thứ tự Mới tạo → Đang chạy → Hoàn thành → Đã chốt; cho phép hủy với lý do; mỗi chuyến chỉ có một lái xe
- **Displayed/saved result:** Danh sách và chi tiết hiển thị đúng trạng thái, người phụ trách và lịch sử chuyển trạng thái
- **Exception:** Không cho điều xe hoặc lái xe bị trùng thời gian; thiếu dữ liệu bắt buộc thì chỉ được lưu nháp
- **Boundary cases:** Chuyến qua ngày; đổi xe trước giờ chạy; hủy sau khi đã phát sinh dữ liệu
- **Section summary:** Trạng thái đi theo thứ tự Mới tạo → Đang chạy → Hoàn thành → Đã chốt; cho phép hủy với lý do; mỗi chuyến chỉ có một lái xe
- **Source:** `docs/prd/Module1.docx` §1.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-03-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khách hàng, tuyến, xe, rơ-moóc, lái xe, thời gian và loại hàng và hoàn tất thao tác. **Expected:** Danh sách và chi tiết hiển thị đúng trạng thái, người phụ trách và lịch sử chuyển trạng thái
- `M01-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M01-03-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Không cho điều xe hoặc lái xe bị trùng thời gian; thiếu dữ liệu bắt buộc thì chỉ được lưu nháp **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M01-03-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M01-03-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra chuyến qua ngày; đổi xe trước giờ chạy; hủy sau khi đã phát sinh dữ liệu. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 1.4 — Phân tích lợi nhuận từng chuyến

- **Delivery:** `implemented` — ROADMAP.md §Current codebase coverage (M1 largely done).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Phân tích lợi nhuận từng chuyến.
- **Roles stated by source:** Giám đốc, quản lý và kế toán
- **Business need / visible outcome:** Giám đốc, quản lý và kế toán cần phân tích lợi nhuận từng chuyến. Kết quả mong muốn: hiển thị từng thành phần, tổng chi phí, lợi nhuận và tỷ suất; truy ngược được tới nguồn số liệu
- **Required data:** doanh thu, chi phí nhiên liệu, tiền đi đường, lương chuyến và chi phí liên quan
- **Core rule:** Lợi nhuận chuyến bằng doanh thu trừ đúng các chi phí thuộc chuyến; không tính trùng khoản chi đã nằm trong tiền đi đường
- **Displayed/saved result:** Hiển thị từng thành phần, tổng chi phí, lợi nhuận và tỷ suất; truy ngược được tới nguồn số liệu
- **Exception:** Chuyến chưa đủ chi phí phải ghi “Tạm tính”; chuyến hủy không được tính vào lợi nhuận
- **Boundary cases:** Giá trị bằng không, khoản điều chỉnh âm, chi phí bổ sung sau khi hoàn thành
- **Section summary:** Lợi nhuận chuyến bằng doanh thu trừ đúng các chi phí thuộc chuyến; không tính trùng khoản chi đã nằm trong tiền đi đường
- **Source:** `docs/prd/Module1.docx` §1.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-04-01` **Tính toán thông thường:** Nhập đầy đủ doanh thu, chi phí nhiên liệu, tiền đi đường, lương chuyến và chi phí liên quan. **Expected:** Hiển thị từng thành phần, tổng chi phí, lợi nhuận và tỷ suất; truy ngược được tới nguồn số liệu
- `M01-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M01-04-03` **Giá trị biên:** Kiểm tra: Giá trị bằng không, khoản điều chỉnh âm, chi phí bổ sung sau khi hoàn thành **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Lợi nhuận chuyến bằng doanh thu trừ đúng các chi phí thuộc chuyến; không tính trùng khoản chi đã nằm trong tiền đi đường
- `M01-04-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Chuyến chưa đủ chi phí phải ghi “Tạm tính”; chuyến hủy không được tính vào lợi nhuận **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M01-04-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 1.5 — Ghi nhận chi phí phát sinh tại cảng hoặc kho

- **Delivery:** `implemented` — ROADMAP.md §Current codebase coverage (M1 largely done).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Ghi nhận chi phí phát sinh tại cảng hoặc kho.
- **Roles stated by source:** Kế toán và nhân viên giao nhận theo phạm vi được giao
- **Business need / visible outcome:** Kế toán và nhân viên giao nhận theo phạm vi được giao cần ghi nhận chi phí phát sinh tại cảng hoặc kho. Kết quả mong muốn: chi phí xuất hiện đúng chuyến, đúng nhóm và được tính một lần vào báo cáo liên quan
- **Required data:** chuyến, công-te-nơ, hạng mục, số tiền, đơn vị cung cấp, ngày phát sinh và chứng từ
- **Core rule:** Mỗi khoản chi chỉ thuộc một phạm vi rõ ràng; khoản có hóa đơn phải đủ thông tin hóa đơn trước khi chốt
- **Displayed/saved result:** Chi phí xuất hiện đúng chuyến, đúng nhóm và được tính một lần vào báo cáo liên quan
- **Exception:** Khoản không có hóa đơn phải nêu căn cứ; chứng từ trùng phải cảnh báo trước khi lưu
- **Boundary cases:** Một chứng từ có nhiều dòng; chi phí chung không gắn công-te-nơ; sửa khoản đang chờ
- **Section summary:** Mỗi khoản chi chỉ thuộc một phạm vi rõ ràng; khoản có hóa đơn phải đủ thông tin hóa đơn trước khi chốt
- **Source:** `docs/prd/Module1.docx` §1.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-05-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ chuyến, công-te-nơ, hạng mục, số tiền, đơn vị cung cấp, ngày phát sinh và chứng từ và hoàn tất thao tác. **Expected:** Chi phí xuất hiện đúng chuyến, đúng nhóm và được tính một lần vào báo cáo liên quan
- `M01-05-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M01-05-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Khoản không có hóa đơn phải nêu căn cứ; chứng từ trùng phải cảnh báo trước khi lưu **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M01-05-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M01-05-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra một chứng từ có nhiều dòng; chi phí chung không gắn công-te-nơ; sửa khoản đang chờ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 1.6 — Quản lý xe đầu kéo, xe tải và rơ-moóc

- **Delivery:** `implemented` — ROADMAP.md §Current codebase coverage (M1 largely done).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.6, customer-response and conclusion cells blank.
- **Intended page/workflow:** Quản lý xe đầu kéo, xe tải và rơ-moóc.
- **Roles stated by source:** Quản lý và người quản trị danh mục
- **Business need / visible outcome:** Quản lý và người quản trị danh mục cần quản lý xe đầu kéo, xe tải và rơ-moóc. Kết quả mong muốn: hồ sơ xe thể hiện tình trạng hiện tại, lịch sử bảo dưỡng và các chuyến đã thực hiện
- **Required data:** biển số, loại xe, tình trạng, ngày bảo dưỡng, đăng kiểm và rơ-moóc ghép
- **Core rule:** Không cho điều xe đang bảo dưỡng, hết đăng kiểm hoặc ngừng hoạt động; biển số được lưu nguyên định dạng
- **Displayed/saved result:** Hồ sơ xe thể hiện tình trạng hiện tại, lịch sử bảo dưỡng và các chuyến đã thực hiện
- **Exception:** Không xóa phương tiện đã có lịch sử; chuyển sang ngừng hoạt động và giữ dữ liệu cũ
- **Boundary cases:** Đổi rơ-moóc giữa chuyến; hai xe có biển số gần giống; bảo dưỡng trùng lịch điều vận
- **Section summary:** Không cho điều xe đang bảo dưỡng, hết đăng kiểm hoặc ngừng hoạt động; biển số được lưu nguyên định dạng
- **Source:** `docs/prd/Module1.docx` §1.6, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-06-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ biển số, loại xe, tình trạng, ngày bảo dưỡng, đăng kiểm và rơ-moóc ghép và hoàn tất thao tác. **Expected:** Hồ sơ xe thể hiện tình trạng hiện tại, lịch sử bảo dưỡng và các chuyến đã thực hiện
- `M01-06-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M01-06-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Không xóa phương tiện đã có lịch sử; chuyển sang ngừng hoạt động và giữ dữ liệu cũ **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M01-06-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M01-06-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra đổi rơ-moóc giữa chuyến; hai xe có biển số gần giống; bảo dưỡng trùng lịch điều vận. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 1.7 — Điều động hàng hai chiều cho cùng xe và lái xe

- **Delivery:** `not found` — ROADMAP.md §Current codebase coverage (two-way cargo pairing gap).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.7, customer-response and conclusion cells blank.
- **Intended page/workflow:** Điều động hàng hai chiều cho cùng xe và lái xe.
- **Roles stated by source:** Điều vận đề xuất; quản lý xác nhận khi có xung đột thời gian
- **Business need / visible outcome:** Điều vận đề xuất; quản lý xác nhận khi có xung đột thời gian cần điều động hàng hai chiều cho cùng xe và lái xe. Kết quả mong muốn: màn hình thể hiện rõ thứ tự hai lệnh, quãng rỗng giữa lệnh và hiệu quả hàng hai chiều
- **Required data:** hai lệnh, tuyến nối tiếp, thời gian, tải trọng, xe và lái xe
- **Core rule:** Chỉ ghép khi thời gian và vị trí nối tiếp hợp lý; hai lệnh vẫn giữ doanh thu, chi phí và trạng thái riêng
- **Displayed/saved result:** Màn hình thể hiện rõ thứ tự hai lệnh, quãng rỗng giữa lệnh và hiệu quả hàng hai chiều
- **Exception:** Nếu trùng giờ, vượt tải hoặc điểm đầu lệnh sau không phù hợp thì cảnh báo và không xác nhận
- **Boundary cases:** Một lệnh bị hủy; lệnh đầu giao trễ; hai lệnh qua ngày
- **Section summary:** Chỉ ghép khi thời gian và vị trí nối tiếp hợp lý; hai lệnh vẫn giữ doanh thu, chi phí và trạng thái riêng
- **Source:** `docs/prd/Module1.docx` §1.7, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-07-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ hai lệnh, tuyến nối tiếp, thời gian, tải trọng, xe và lái xe và hoàn tất thao tác. **Expected:** Màn hình thể hiện rõ thứ tự hai lệnh, quãng rỗng giữa lệnh và hiệu quả hàng hai chiều
- `M01-07-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M01-07-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Nếu trùng giờ, vượt tải hoặc điểm đầu lệnh sau không phù hợp thì cảnh báo và không xác nhận **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M01-07-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M01-07-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra một lệnh bị hủy; lệnh đầu giao trễ; hai lệnh qua ngày. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 1.8 — Chốt chuyến và lưu nhật ký thao tác

- **Delivery:** `implemented` — ROADMAP.md §Current codebase coverage (M1 largely done).
- **Authority:** `pending decision` — `docs/prd/Module1.docx` §1.8, customer-response and conclusion cells blank.
- **Intended page/workflow:** Chốt chuyến và lưu nhật ký thao tác.
- **Roles stated by source:** Quản lý hoặc kế toán được phân quyền
- **Business need / visible outcome:** Quản lý hoặc kế toán được phân quyền cần chốt chuyến và lưu nhật ký thao tác. Kết quả mong muốn: trạng thái thành Đã chốt, số liệu báo cáo cập nhật một lần và nhật ký ghi đủ người, thời điểm, thay đổi
- **Required data:** chuyến hoàn thành, số liệu cuối cùng, ảnh bắt buộc và xác nhận người chốt
- **Core rule:** Chỉ chốt khi đủ dữ liệu; chốt tạo đúng bút toán liên quan và khóa chỉnh sửa trực tiếp
- **Displayed/saved result:** Trạng thái thành Đã chốt, số liệu báo cáo cập nhật một lần và nhật ký ghi đủ người, thời điểm, thay đổi
- **Exception:** Nếu phát hiện sai sau chốt phải mở quy trình điều chỉnh hoặc mở khóa có kiểm soát, không sửa âm thầm
- **Boundary cases:** Bấm chốt hai lần; hai người chốt đồng thời; mất kết nối ngay sau khi chốt
- **Section summary:** Chỉ chốt khi đủ dữ liệu; chốt tạo đúng bút toán liên quan và khóa chỉnh sửa trực tiếp
- **Source:** `docs/prd/Module1.docx` §1.8, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M01-08-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ chuyến hoàn thành, số liệu cuối cùng, ảnh bắt buộc và xác nhận người chốt và hoàn tất thao tác. **Expected:** Trạng thái thành Đã chốt, số liệu báo cáo cập nhật một lần và nhật ký ghi đủ người, thời điểm, thay đổi
- `M01-08-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M01-08-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Nếu phát hiện sai sau chốt phải mở quy trình điều chỉnh hoặc mở khóa có kiểm soát, không sửa âm thầm **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M01-08-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M01-08-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra bấm chốt hai lần; hai người chốt đồng thời; mất kết nối ngay sau khi chốt. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M1 module-wide acceptance criteria

- `M01-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module1.docx` §5.
- `M01-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 1 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module1.docx` §5.

# M2 — PHÂN HỆ 2 — BÁO GIÁ CƯỚC VÀ DOANH THU PHI VẬN TẢI

## 2.1 — Bảng giá cố định theo khách hàng và tuyến

- **Delivery:** `implemented` — ROADMAP.md §Wave 1 checked item.
- **Authority:** `pending decision` — `docs/prd/Module2.docx` §2.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Bảng giá cố định theo khách hàng và tuyến.
- **Roles stated by source:** Kế toán hoặc quản lý bảng giá; điều vận chỉ sử dụng
- **Business need / visible outcome:** Kế toán hoặc quản lý bảng giá; điều vận chỉ sử dụng cần bảng giá cố định theo khách hàng và tuyến. Kết quả mong muốn: khi tạo chuyến, hệ thống gợi ý đơn giá và lưu mức giá đã áp dụng để đối soát
- **Required data:** khách hàng, tuyến, loại xe, đơn giá, thuế và ngày hiệu lực
- **Core rule:** Chọn đúng mức giá có hiệu lực tại ngày chuyến; không cho hai mức giá cùng điều kiện bị chồng thời gian
- **Displayed/saved result:** Khi tạo chuyến, hệ thống gợi ý đơn giá và lưu mức giá đã áp dụng để đối soát
- **Exception:** Người có quyền được sửa giá gợi ý trước khi chốt nhưng phải nêu lý do và giữ giá ban đầu
- **Boundary cases:** Thay giá giữa tháng; chuyến hồi tố; khách hàng chưa có bảng giá
- **Section summary:** Chọn đúng mức giá có hiệu lực tại ngày chuyến; không cho hai mức giá cùng điều kiện bị chồng thời gian
- **Source:** `docs/prd/Module2.docx` §2.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M02-01-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khách hàng, tuyến, loại xe, đơn giá, thuế và ngày hiệu lực và hoàn tất thao tác. **Expected:** Khi tạo chuyến, hệ thống gợi ý đơn giá và lưu mức giá đã áp dụng để đối soát
- `M02-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M02-01-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Người có quyền được sửa giá gợi ý trước khi chốt nhưng phải nêu lý do và giữ giá ban đầu **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M02-01-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M02-01-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra thay giá giữa tháng; chuyến hồi tố; khách hàng chưa có bảng giá. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 2.2 — Bảng giá theo tuyến và trọng lượng cho xe tải hàng rời

- **Delivery:** `implemented` — ROADMAP.md §Wave 1 checked item.
- **Authority:** `pending decision` — `docs/prd/Module2.docx` §2.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Bảng giá theo tuyến và trọng lượng cho xe tải hàng rời.
- **Roles stated by source:** Kế toán cấu hình; điều vận nhập trọng lượng
- **Business need / visible outcome:** Kế toán cấu hình; điều vận nhập trọng lượng cần bảng giá theo tuyến và trọng lượng cho xe tải hàng rời. Kết quả mong muốn: hệ thống chọn đúng bậc giá và giải thích bậc đã dùng
- **Required data:** tuyến, khoảng trọng lượng, đơn vị tấn, loại hàng, đơn giá và ngày hiệu lực
- **Core rule:** Các khoảng trọng lượng không được chồng lấn hoặc bỏ khoảng ngoài chủ ý; quy tắc làm tròn phải được chốt
- **Displayed/saved result:** Hệ thống chọn đúng bậc giá và giải thích bậc đã dùng
- **Exception:** Trọng lượng ngoài bảng phải cảnh báo và yêu cầu chọn giá thủ công có lý do
- **Boundary cases:** Trọng lượng đúng ranh giới; số lẻ; đơn vị nhập khác tấn
- **Section summary:** Các khoảng trọng lượng không được chồng lấn hoặc bỏ khoảng ngoài chủ ý; quy tắc làm tròn phải được chốt
- **Source:** `docs/prd/Module2.docx` §2.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M02-02-01` **Tính toán thông thường:** Nhập đầy đủ tuyến, khoảng trọng lượng, đơn vị tấn, loại hàng, đơn giá và ngày hiệu lực. **Expected:** Hệ thống chọn đúng bậc giá và giải thích bậc đã dùng
- `M02-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M02-02-03` **Giá trị biên:** Kiểm tra: Trọng lượng đúng ranh giới; số lẻ; đơn vị nhập khác tấn **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Các khoảng trọng lượng không được chồng lấn hoặc bỏ khoảng ngoài chủ ý; quy tắc làm tròn phải được chốt
- `M02-02-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Trọng lượng ngoài bảng phải cảnh báo và yêu cầu chọn giá thủ công có lý do **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M02-02-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 2.3 — Tự động tính doanh thu từ trọng lượng lô hàng

- **Delivery:** `implemented` — ROADMAP.md §Wave 1 checked item.
- **Authority:** `pending decision` — `docs/prd/Module2.docx` §2.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tự động tính doanh thu từ trọng lượng lô hàng.
- **Roles stated by source:** Điều vận nhập dữ liệu; kế toán kiểm tra
- **Business need / visible outcome:** Điều vận nhập dữ liệu; kế toán kiểm tra cần tự động tính doanh thu từ trọng lượng lô hàng. Kết quả mong muốn: hiển thị công thức, trọng lượng tính cước, đơn giá, phụ phí và tổng tiền
- **Required data:** trọng lượng thực tế, tuyến, bậc giá, phụ phí và thuế
- **Core rule:** Doanh thu được tính từ trọng lượng hợp lệ và bảng giá tại ngày chuyến; tính lại khi dữ liệu nguồn đổi trước khi chốt
- **Displayed/saved result:** Hiển thị công thức, trọng lượng tính cước, đơn giá, phụ phí và tổng tiền
- **Exception:** Sau khi chốt, thay trọng lượng phải qua điều chỉnh; không tự đổi doanh thu đã ghi nhận
- **Boundary cases:** Trọng lượng bằng không; vượt tải; thay đổi sau cân lần hai
- **Section summary:** Doanh thu được tính từ trọng lượng hợp lệ và bảng giá tại ngày chuyến; tính lại khi dữ liệu nguồn đổi trước khi chốt
- **Source:** `docs/prd/Module2.docx` §2.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M02-03-01` **Tính toán thông thường:** Nhập đầy đủ trọng lượng thực tế, tuyến, bậc giá, phụ phí và thuế. **Expected:** Hiển thị công thức, trọng lượng tính cước, đơn giá, phụ phí và tổng tiền
- `M02-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M02-03-03` **Giá trị biên:** Kiểm tra: Trọng lượng bằng không; vượt tải; thay đổi sau cân lần hai **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Doanh thu được tính từ trọng lượng hợp lệ và bảng giá tại ngày chuyến; tính lại khi dữ liệu nguồn đổi trước khi chốt
- `M02-03-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Sau khi chốt, thay trọng lượng phải qua điều chỉnh; không tự đổi doanh thu đã ghi nhận **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M02-03-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 2.4 — Gợi ý đơn giá nâng hạ theo cảng

- **Delivery:** `implemented` — ROADMAP.md §Wave 1 checked item.
- **Authority:** `pending decision` — `docs/prd/Module2.docx` §2.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Gợi ý đơn giá nâng hạ theo cảng.
- **Roles stated by source:** Kế toán quản lý giá; giao nhận hoặc CUS sử dụng
- **Business need / visible outcome:** Kế toán quản lý giá; giao nhận hoặc CUS sử dụng cần gợi ý đơn giá nâng hạ theo cảng. Kết quả mong muốn: khoản chi hiển thị giá gợi ý, giá thực tế, chênh lệch và người sửa
- **Required data:** cảng, loại công-te-nơ, chiều nâng hoặc hạ, ngày phát sinh và biểu giá
- **Core rule:** Gợi ý theo đúng cảng và ngày hiệu lực; cho phép sửa có lý do và hiển thị chênh lệch
- **Displayed/saved result:** Khoản chi hiển thị giá gợi ý, giá thực tế, chênh lệch và người sửa
- **Exception:** Không có giá phù hợp thì không tự điền giá cũ; yêu cầu người dùng nhập và ghi chú
- **Boundary cases:** Cảng đổi giá giữa ngày; loại công-te-nơ khác nhau; cùng lô có cả nâng và hạ
- **Section summary:** Gợi ý theo đúng cảng và ngày hiệu lực; cho phép sửa có lý do và hiển thị chênh lệch
- **Source:** `docs/prd/Module2.docx` §2.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M02-04-01` **Tính toán thông thường:** Nhập đầy đủ cảng, loại công-te-nơ, chiều nâng hoặc hạ, ngày phát sinh và biểu giá. **Expected:** Khoản chi hiển thị giá gợi ý, giá thực tế, chênh lệch và người sửa
- `M02-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M02-04-03` **Giá trị biên:** Kiểm tra: Cảng đổi giá giữa ngày; loại công-te-nơ khác nhau; cùng lô có cả nâng và hạ **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Gợi ý theo đúng cảng và ngày hiệu lực; cho phép sửa có lý do và hiển thị chênh lệch
- `M02-04-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Không có giá phù hợp thì không tự điền giá cũ; yêu cầu người dùng nhập và ghi chú **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M02-04-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 2.5 — Theo dõi doanh thu phi vận tải

- **Delivery:** `implemented` — ROADMAP.md §Wave 1 checked item.
- **Authority:** `pending decision` — `docs/prd/Module2.docx` §2.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Theo dõi doanh thu phi vận tải.
- **Roles stated by source:** Kế toán ghi nhận; quản lý xem và duyệt quy tắc
- **Business need / visible outcome:** Kế toán ghi nhận; quản lý xem và duyệt quy tắc cần theo dõi doanh thu phi vận tải. Kết quả mong muốn: báo cáo thể hiện doanh thu phi vận tải theo loại, khách hàng, kỳ và chứng từ nguồn
- **Required data:** khách hàng, lô hoặc chuyến, loại doanh thu, số tiền, thuế, ngày và chứng từ
- **Core rule:** Tách riêng hàng lẻ, ghép xe, chênh lệch dịch vụ và khoản khác; mỗi khoản chỉ ghi nhận một lần
- **Displayed/saved result:** Báo cáo thể hiện doanh thu phi vận tải theo loại, khách hàng, kỳ và chứng từ nguồn
- **Exception:** Khoản hoàn hoặc giảm trừ phải dùng số âm có lý do; không sửa khoản đã chốt
- **Boundary cases:** Khoản không gắn chuyến; một chứng từ cho nhiều lô; doanh thu phát sinh kỳ sau
- **Section summary:** Tách riêng hàng lẻ, ghép xe, chênh lệch dịch vụ và khoản khác; mỗi khoản chỉ ghi nhận một lần
- **Source:** `docs/prd/Module2.docx` §2.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M02-05-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khách hàng, lô hoặc chuyến, loại doanh thu, số tiền, thuế, ngày và chứng từ và hoàn tất thao tác. **Expected:** Báo cáo thể hiện doanh thu phi vận tải theo loại, khách hàng, kỳ và chứng từ nguồn
- `M02-05-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M02-05-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Khoản hoàn hoặc giảm trừ phải dùng số âm có lý do; không sửa khoản đã chốt **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M02-05-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M02-05-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra khoản không gắn chuyến; một chứng từ cho nhiều lô; doanh thu phát sinh kỳ sau. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M2 module-wide acceptance criteria

- `M02-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module2.docx` §5.
- `M02-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 2 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module2.docx` §5.

# M3 — PHÂN HỆ 3 — CHĂM SÓC KHÁCH HÀNG (CUS)

## 3.1 — Tiếp nhận yêu cầu đặt chỗ và tạo hồ sơ lô hàng

- **Delivery:** `partial` — ROADMAP.md §Wave 0 complete; §Wave 2 open M3.1 field/code decisions.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tiếp nhận yêu cầu đặt chỗ và tạo hồ sơ lô hàng.
- **Roles stated by source:** Nhân viên CUS; Ai được tạo và sửa hồ sơ lô hàng? Nhân viên CUS tạo và sửa; khách hàng có thể gửi yêu cầu qua cổng thông tin; nhân viên giao nhận chỉ bổ sung dữ liệu thuộc phần việc được giao.
- **Business need / visible outcome:** Nhân viên CUS cần tạo một hồ sơ lô hàng thống nhất, đủ dữ liệu để các bộ phận vận tải, giao nhận và kế toán cùng sử dụng.
- **Section summary:** Chốt trường bắt buộc, quy tắc mã lô, quyền tạo hoặc sửa và thời điểm được chuyển bước.
- **Source:** `docs/prd/Module3.docx` §3.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Những thông tin nào bắt buộc ngay khi tạo hồ sơ?** Proposed: Đề xuất bắt buộc: khách hàng, số vận đơn hoặc mã tham chiếu, ngày giao dự kiến, điểm nhận và điểm giao. Số công-te-nơ, số niêm phong và tờ khai có thể bổ sung trước khi điều xe.
- **§2 Một vận đơn có thể gồm bao nhiêu công-te-nơ?** Proposed: Cho phép một vận đơn có một hoặc nhiều công-te-nơ; mỗi công-te-nơ có thông tin và chứng từ riêng.
- **§3 Tờ khai hải quan được quản lý theo lô hay theo công-te-nơ?** Proposed: Mặc định quản lý theo công-te-nơ; cho phép một tờ khai dùng cho nhiều công-te-nơ khi người có thẩm quyền xác nhận.
- **§4 Ai được tạo và sửa hồ sơ lô hàng?** Proposed: Nhân viên CUS tạo và sửa; khách hàng có thể gửi yêu cầu qua cổng thông tin; nhân viên giao nhận chỉ bổ sung dữ liệu thuộc phần việc được giao.
- **§5 Quy tắc tạo mã lô cần như thế nào?** Proposed: Mã tự sinh, duy nhất, dễ tìm kiếm; đề xuất gồm mã khách hàng, ngày và số thứ tự.
- **§6 Chứng từ nào cần đính kèm khi tạo lô?** Proposed: Cho phép đính kèm yêu cầu đặt chỗ, vận đơn và lệnh giao hàng; xác định rõ chứng từ bắt buộc trước từng mốc xử lý.

Acceptance cases:
- `CUS-01-01` **Tạo lô với dữ liệu tối thiểu hợp lệ:** Nhập đủ trường bắt buộc và lưu. **Expected:** Hệ thống sinh mã lô duy nhất, trạng thái “Đang xử lý”, lưu đúng người tạo và thời điểm tạo.
- `CUS-01-02` **Lưu nháp khi chưa có số công-te-nơ:** Nhập thông tin khách hàng và vận đơn, chưa nhập số công-te-nơ. **Expected:** Cho phép lưu nháp; nêu rõ dữ liệu còn thiếu và chưa cho chuyển sang bước điều xe.
- `CUS-01-03` **Một vận đơn có nhiều công-te-nơ:** Thêm từ hai công-te-nơ trở lên vào cùng một lô. **Expected:** Mỗi công-te-nơ có dòng riêng, không mất dữ liệu, tìm được lô theo bất kỳ số công-te-nơ nào.
- `CUS-01-04` **Phát hiện hồ sơ trùng:** Tạo lại cùng khách hàng, số vận đơn và ngày giao. **Expected:** Cảnh báo hồ sơ có khả năng trùng; chỉ cho tiếp tục khi có lý do và quyền phù hợp.
- `CUS-01-05` **Kiểm soát quyền sửa:** Người không phụ trách thử sửa hoặc xóa lô. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký ghi nhận lần thử.

## 3.2 — Kiểm tra chứng từ và số liệu lô hàng

- **Delivery:** `implemented` — ROADMAP.md §Wave 2 checked item.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Kiểm tra chứng từ và số liệu lô hàng.
- **Roles stated by source:** Nhân viên CUS
- **Business need / visible outcome:** Nhân viên CUS cần phát hiện sớm sai lệch giữa yêu cầu đặt chỗ, vận đơn, lệnh giao hàng, tờ khai và mã số công-te-nơ.
- **Section summary:** Chốt cách kiểm tra vận đơn, công-te-nơ, tờ khai, chứng từ hết hạn và các trường hợp ngoại lệ.
- **Source:** `docs/prd/Module3.docx` §3.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Có kiểm tra mã số công-te-nơ theo tiêu chuẩn quốc tế không?** Proposed: Kiểm tra cấu trúc và chữ số kiểm tra theo ISO 6346; thông báo rõ vị trí sai.
- **§2 Quy tắc kiểm tra số tờ khai hải quan là gì?** Proposed: Kiểm tra trường trống, ký tự không hợp lệ và số trùng; khách hàng cung cấp thêm quy tắc nghiệp vụ thực tế.
- **§3 Khi nào cần đối chiếu số vận đơn?** Proposed: Đối chiếu khi tải chứng từ lên và trước khi chuyển lô sang bước điều xe.
- **§4 Thiếu chứng từ có được tiếp tục xử lý không?** Proposed: Cho phép lưu nháp nhưng chặn mốc nghiệp vụ yêu cầu chứng từ; hiển thị danh sách cần bổ sung.
- **§5 Lệnh giao hàng cần lưu những gì?** Proposed: Lưu số tham chiếu, ngày hiệu lực, ngày hết hạn và tệp đính kèm nếu có.
- **§6 Có cần nhận dạng dữ liệu tự động từ ảnh?** Proposed: Có thể triển khai sau khi quy tắc kiểm tra và mẫu chứng từ đã được thống nhất; người dùng luôn phải xác nhận kết quả.

Acceptance cases:
- `CUS-02-01` **Bộ chứng từ hợp lệ:** Nhập vận đơn, công-te-nơ, tờ khai và lệnh giao hàng khớp nhau. **Expected:** Hiển thị “Đã kiểm tra”; cho phép chuyển sang bước tiếp theo.
- `CUS-02-02` **Mã số công-te-nơ không hợp lệ:** Nhập sai cấu trúc hoặc chữ số kiểm tra. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu sai và không cho xác nhận chứng từ.
- `CUS-02-03` **Tờ khai trùng có lý do hợp lệ:** Dùng một tờ khai cho nhiều công-te-nơ. **Expected:** Cảnh báo; người có quyền có thể xác nhận ngoại lệ kèm lý do; lưu đầy đủ nhật ký.
- `CUS-02-04` **Chứng từ hết hiệu lực:** Nhập lệnh giao hàng đã hết hạn. **Expected:** Cảnh báo và chặn bước điều xe cho đến khi thay chứng từ hoặc duyệt ngoại lệ.
- `CUS-02-05` **Thay tệp chứng từ:** Tải bản mới thay cho bản cũ. **Expected:** Bản mới trở thành bản đang dùng; bản cũ vẫn tra cứu được trong lịch sử.

## 3.3 — Thông báo tiến độ lô hàng cho khách hàng

- **Delivery:** `implemented` — ROADMAP.md §Wave 2 checked item.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Thông báo tiến độ lô hàng cho khách hàng.
- **Roles stated by source:** Khách hàng; Ai nhận thông báo tại phía khách hàng? Cho phép cấu hình người nhận theo loại thông báo và lô hàng; tránh gửi thông tin tài chính cho người không liên quan.
- **Business need / visible outcome:** Khách hàng cần theo dõi tiến độ và phát sinh của lô hàng trên một kênh thống nhất, giảm trao đổi thủ công.
- **Section summary:** Chốt các mốc tiến độ, người nhận, kênh gửi, quyền xem và cách xử lý khi gửi thất bại.
- **Source:** `docs/prd/Module3.docx` §3.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Kênh thông báo chính là gì?** Proposed: Cổng thông tin khách hàng là kênh chính; thư điện tử là kênh dự phòng. Thông báo trên thiết bị chỉ gửi khi khách hàng đã cho phép.
- **§2 Các mốc tiến độ cần công bố?** Proposed: Đề xuất: tiếp nhận, đã lấy công-te-nơ, đang vận chuyển, đã giao, chờ xác nhận chi phí, đã lập giấy báo nợ, đã thanh toán.
- **§3 Tiến độ được cập nhật tự động hay thủ công?** Proposed: Tự động theo trạng thái chuyến; CUS được thêm thông báo thủ công cho đổi lịch hoặc sự cố.
- **§4 Khách hàng có cần phản hồi?** Proposed: Đề xuất cho phép xác nhận đã nhận thông báo và gửi yêu cầu hỗ trợ; phạm vi trao đổi hai chiều cần chốt.
- **§5 Có hiển thị vị trí xe theo thời gian thực?** Proposed: Chỉ hiển thị khi được phép và trong khoảng thời gian vận chuyển; không hiển thị sau khi hoàn thành.
- **§6 Ai nhận thông báo tại phía khách hàng?** Proposed: Cho phép cấu hình người nhận theo loại thông báo và lô hàng; tránh gửi thông tin tài chính cho người không liên quan.

Acceptance cases:
- `CUS-03-01` **Cập nhật tiến độ thông thường:** Chuyến chuyển sang “Đang vận chuyển”. **Expected:** Cổng khách hàng hiển thị mốc mới; gửi thông báo đúng người nhận; lưu thời điểm gửi và xem.
- `CUS-03-02` **Khách chưa bật thông báo trên thiết bị:** Phát sinh mốc tiến độ mới. **Expected:** Vẫn lưu trên cổng khách hàng; gửi thư điện tử nếu đã đăng ký; không cản trở nghiệp vụ.
- `CUS-03-03` **Thay đổi lịch giao:** CUS cập nhật ngày hoặc giờ giao và nêu lý do. **Expected:** Khách nhận thông báo nêu rõ lịch cũ, lịch mới và lý do; lịch sử không bị ghi đè.
- `CUS-03-04` **Gửi lại thông báo thất bại:** Kênh thư điện tử tạm thời không gửi được. **Expected:** Hệ thống ghi nhận thất bại, thử lại theo quy định và hiển thị cho CUS biết.
- `CUS-03-05` **Bảo vệ dữ liệu giữa khách hàng:** Tài khoản của khách A mở đường dẫn lô của khách B. **Expected:** Từ chối truy cập và không để lộ thông tin lô hàng, vị trí hoặc chứng từ.

## 3.4 — Xác nhận giao hàng và trả hoặc rút công-te-nơ

- **Delivery:** `implemented` — ROADMAP.md §Wave 2 checked item.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Xác nhận giao hàng và trả hoặc rút công-te-nơ.
- **Roles stated by source:** CUS; Ai xác nhận thời điểm giao hàng? Lái xe ghi nhận tại điểm giao; CUS kiểm tra và xác nhận; khách hàng có thể xác nhận đã nhận hàng.
- **Business need / visible outcome:** CUS cần lưu chính xác các mốc ngày giờ thực tế để đối soát giao hàng và tính phí lưu bãi.
- **Section summary:** Chốt các mốc thời gian, người xác nhận, giao một phần và cách tính thời gian lưu bãi.
- **Source:** `docs/prd/Module3.docx` §3.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Ai xác nhận thời điểm giao hàng?** Proposed: Lái xe ghi nhận tại điểm giao; CUS kiểm tra và xác nhận; khách hàng có thể xác nhận đã nhận hàng.
- **§2 Cần lưu những mốc thời gian nào?** Proposed: Ngày giờ lấy công-te-nơ, giao hàng, rút hàng, trả vỏ và hạn giờ của cảng hoặc hãng tàu.
- **§3 Thời gian miễn phí lưu bãi được xác định theo đâu?** Proposed: Theo thỏa thuận từng khách hàng, cảng, hãng tàu và loại công-te-nơ; cần cung cấp bảng quy tắc.
- **§4 Xử lý giao trễ như thế nào?** Proposed: Cảnh báo sớm cho CUS; ghi lý do và người chịu trách nhiệm; phụ phí chỉ tính theo quy tắc đã chốt.
- **§5 Có cần phân biệt điểm giao trung gian và kho cuối?** Proposed: Cho phép nhiều mốc giao có tên rõ ràng; xác định mốc dùng để tính hoàn thành.
- **§6 Cho phép xác nhận thủ công khi thiếu dữ liệu định vị?** Proposed: Có, nhưng bắt buộc nêu lý do và chỉ người có quyền mới được xác nhận.

Acceptance cases:
- `CUS-04-01` **Xác nhận đủ ba bên:** Lái xe ghi nhận, CUS xác nhận, khách xác nhận đã nhận. **Expected:** Lưu đầy đủ ba mốc thời gian và người thực hiện; lô chuyển đúng trạng thái.
- `CUS-04-02` **Xác nhận thủ công khi thiếu mốc lái xe:** Khách báo đã nhận nhưng chưa có mốc từ lái xe. **Expected:** Cảnh báo; cho phép người có quyền xác nhận kèm lý do và chứng cứ; lưu nhật ký.
- `CUS-04-03` **Giao một phần:** Lô nhiều công-te-nơ nhưng mới giao một phần. **Expected:** Chỉ công-te-nơ đã giao được hoàn tất; lô tổng vẫn hiển thị “Giao một phần”.
- `CUS-04-04` **Trả vỏ quá hạn:** Ngày trả vỏ sau thời gian miễn phí. **Expected:** Tính đúng số ngày vượt hạn theo quy tắc đã chốt và cảnh báo khoản phí dự kiến.
- `CUS-04-05` **Múi giờ và thời điểm biên:** Ghi nhận lúc gần nửa đêm hoặc qua ngày lễ. **Expected:** Ngày giờ hiển thị thống nhất theo giờ Việt Nam; cách tính ngày tuân theo lịch đã cấu hình.

## 3.5 — Lập giấy báo nợ gửi khách hàng

- **Delivery:** `implemented` — ROADMAP.md §Wave 2 checked item.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Lập giấy báo nợ gửi khách hàng.
- **Roles stated by source:** CUS và kế toán
- **Business need / visible outcome:** CUS và kế toán cần tổng hợp cước vận tải, phí dịch vụ và khoản chi hộ chính xác theo lô hoặc kỳ thanh toán.
- **Section summary:** Chốt kỳ lập, nhóm khoản thu, cách tính thuế, mẫu tài liệu và điều kiện phát hành.
- **Source:** `docs/prd/Module3.docx` §3.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Lập giấy báo nợ theo lô hay theo kỳ?** Proposed: Cấu hình theo từng khách hàng; cho phép lập theo lô khi có thỏa thuận riêng.
- **§2 Các nhóm khoản thu gồm những gì?** Proposed: Tách riêng cước vận tải, phí dịch vụ, khoản chi hộ và khoản điều chỉnh; không gộp làm mất khả năng đối chiếu.
- **§3 Mẫu giấy báo nợ có cần riêng theo khách?** Proposed: Cho phép cấu hình biểu trưng, thông tin thanh toán, cột hiển thị và người ký; lưu nguyên mẫu tại thời điểm phát hành.
- **§4 Cách thể hiện thuế giá trị gia tăng?** Proposed: Mỗi dòng nêu rõ trước thuế, thuế suất, tiền thuế và tổng sau thuế; khoản không thuộc diện thuế phải có nhãn rõ.
- **§5 Khoản chi hộ chưa duyệt có được đưa vào không?** Proposed: Không đưa vào bản chính thức; hiển thị danh sách còn chờ để kế toán xử lý.
- **§6 Hình thức gửi và xác nhận?** Proposed: Gửi trên cổng khách hàng và thư điện tử; lưu bản không chỉnh sửa cùng dấu thời gian gửi.

Acceptance cases:
- `CUS-05-01` **Lập theo kỳ với đủ khoản thu:** Chọn khách hàng và kỳ có cước, phí dịch vụ, chi hộ đã duyệt. **Expected:** Tổng hợp đúng từng dòng, thuế và tổng cộng; không trùng hoặc bỏ sót khoản.
- `CUS-05-02` **Còn khoản chi hộ chưa duyệt:** Trong kỳ có ít nhất một khoản đang chờ. **Expected:** Cảnh báo và loại khỏi bản chính thức; hiển thị danh sách cần xử lý.
- `CUS-05-03` **Lập lại cùng phạm vi:** Thử lập lần hai cho cùng khách hàng và kỳ. **Expected:** Cảnh báo trùng; không phát hành thêm nếu chưa hủy hoặc điều chỉnh bản trước.
- `CUS-05-04` **Số tiền bằng không hoặc âm:** Có dòng giảm trừ hoặc điều chỉnh. **Expected:** Hiển thị đúng dấu, lý do và căn cứ; tổng cộng tính chính xác đến đơn vị đồng.
- `CUS-05-05` **Xuất và gửi tài liệu:** Phát hành bản chính thức. **Expected:** Tệp xuất ra đúng mẫu, không vỡ bảng, đủ số trang; bản gửi và bản lưu có cùng số hiệu, số tiền.

## 3.6 — Theo dõi xác nhận và thanh toán giấy báo nợ

- **Delivery:** `implemented` — ROADMAP.md §Wave 2 checked item.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.6, customer-response and conclusion cells blank.
- **Intended page/workflow:** Theo dõi xác nhận và thanh toán giấy báo nợ.
- **Roles stated by source:** CUS và kế toán; Ai được xác nhận? Khách hàng xác nhận trên cổng thông tin; CUS chỉ xác nhận thay khi có căn cứ và phải ghi chú.
- **Business need / visible outcome:** CUS và kế toán cần biết giấy báo nợ nào đang chờ xác nhận, đã xác nhận, thanh toán một phần hoặc đã thanh toán đủ.
- **Section summary:** Chốt trạng thái, quyền xác nhận, thanh toán một phần, nhắc hạn và quy trình điều chỉnh.
- **Source:** `docs/prd/Module3.docx` §3.6, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Bộ trạng thái cần dùng?** Proposed: Đề xuất: Bản nháp, Đã gửi, Chờ xác nhận, Đã xác nhận, Thanh toán một phần, Đã thanh toán, Bị từ chối, Đã hủy.
- **§2 Ai được xác nhận?** Proposed: Khách hàng xác nhận trên cổng thông tin; CUS chỉ xác nhận thay khi có căn cứ và phải ghi chú.
- **§3 Căn cứ ghi nhận thanh toán là gì?** Proposed: Kế toán ghi nhận theo chứng từ ngân hàng hoặc phiếu thu; cho phép phân bổ một khoản thu cho nhiều giấy báo nợ.
- **§4 Quy tắc nhắc thanh toán?** Proposed: Theo hạn thanh toán từng khách hàng; không gửi lặp quá mức; dừng nhắc khi đã thanh toán đủ hoặc đang tranh chấp.
- **§5 Khi nào khóa nội dung?** Proposed: Khóa sau khi khách xác nhận; mọi thay đổi sau đó phải qua chứng từ điều chỉnh.
- **§6 Xử lý thanh toán thừa hoặc nhầm?** Proposed: Ghi nhận khoản chưa phân bổ hoặc hoàn trả theo quy trình kế toán; không tự làm mất số dư.

Acceptance cases:
- `CUS-06-01` **Luồng xác nhận và thanh toán đủ:** Khách xác nhận, kế toán ghi nhận đủ tiền. **Expected:** Trạng thái chuyển theo đúng thứ tự; công nợ giảm đúng; giấy báo nợ bị khóa.
- `CUS-06-02` **Thanh toán một phần:** Ghi nhận số tiền nhỏ hơn tổng phải trả. **Expected:** Trạng thái “Thanh toán một phần”; hiển thị số đã thu, còn phải thu và hạn còn lại.
- `CUS-06-03` **Sửa giấy báo nợ đã xác nhận:** Người dùng thử sửa số tiền hoặc xóa dòng. **Expected:** Từ chối sửa trực tiếp; hướng dẫn lập điều chỉnh; dữ liệu cũ giữ nguyên.
- `CUS-06-04` **Khách từ chối và nêu lý do:** Khách chọn từ chối một hoặc nhiều dòng. **Expected:** Lưu lý do theo dòng; thông báo CUS và kế toán; tạm dừng nhắc thanh toán phần đang tranh chấp.
- `CUS-06-05` **Ghi nhận trùng chứng từ thanh toán:** Nhập lại cùng số tham chiếu và số tiền. **Expected:** Cảnh báo trùng và ngăn ghi nhận hai lần, trừ khi người có quyền xác nhận ngoại lệ.
- `CUS-06-06` **Thanh toán thừa:** Số tiền nhận lớn hơn số còn phải thu. **Expected:** Không làm công nợ âm ngoài ý muốn; phần thừa được ghi nhận rõ để phân bổ hoặc hoàn trả.

## 3.7 — Đối chiếu hóa đơn và chứng từ khoản chi hộ

- **Delivery:** `implemented` — ROADMAP.md §Wave 2 checked item.
- **Authority:** `pending decision` — `docs/prd/Module3.docx` §3.7, customer-response and conclusion cells blank.
- **Intended page/workflow:** Đối chiếu hóa đơn và chứng từ khoản chi hộ.
- **Roles stated by source:** CUS và kế toán
- **Business need / visible outcome:** CUS và kế toán cần đối chiếu khoản chi hộ với chứng từ thực tế để thu lại đúng số tiền và có căn cứ giải trình.
- **Section summary:** Chốt loại chi hộ, chứng từ bắt buộc, cách đối chiếu, xử lý chênh lệch và duyệt lại.
- **Source:** `docs/prd/Module3.docx` §3.7, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Requirement proposals to confirm:
- **§1 Danh mục khoản chi hộ gồm những gì?** Proposed: Đề xuất quản lý danh mục có thể cấu hình: nâng, hạ, lưu bãi, phí cảng, cước hãng tàu, hải quan và các khoản khác.
- **§2 Khoản nào bắt buộc có hóa đơn?** Proposed: Mỗi hạng mục có quy tắc chứng từ riêng; trường hợp không có hóa đơn phải có chứng từ thay thế hoặc ghi chú.
- **§3 Thông tin nào bắt buộc khi đối chiếu?** Proposed: Số tiền, ngày chứng từ, đơn vị phát hành, số hóa đơn hoặc số tờ khai, công-te-nơ, lô hàng và tệp chứng từ.
- **§4 Có dùng bảng giá để gợi ý?** Proposed: Gợi ý theo cảng, hạng mục và ngày hiệu lực; người sửa đơn giá phải nêu lý do.
- **§5 Xử lý chênh lệch như thế nào?** Proposed: Cho phép sửa trước khi duyệt hoặc lập điều chỉnh ở kỳ sau; không sửa âm thầm sau khi đã phát hành.
- **§6 Đối soát theo lô hay theo kỳ?** Proposed: Đối chiếu từng khoản theo lô; cuối kỳ có báo cáo tổng hợp theo khách hàng, cảng và hạng mục.

Acceptance cases:
- `CUS-07-01` **Khoản chi hộ khớp chứng từ:** Số tiền nhập khớp hóa đơn và bảng giá. **Expected:** Hiển thị “Khớp”; cho phép duyệt và đưa vào giấy báo nợ đúng một lần.
- `CUS-07-02` **Chênh lệch số tiền:** Số tiền nhập khác số trên chứng từ. **Expected:** Hiển thị số chênh lệch; yêu cầu sửa hoặc nêu lý do trước khi duyệt.
- `CUS-07-03` **Thiếu chứng từ bắt buộc:** Khoản thuộc nhóm bắt buộc hóa đơn nhưng chưa đính kèm. **Expected:** Không cho duyệt; nêu rõ tài liệu cần bổ sung.
- `CUS-07-04` **Chứng từ dùng trùng:** Cùng số hóa đơn được gắn cho hai khoản không liên quan. **Expected:** Cảnh báo trùng và yêu cầu kiểm tra; không tự động đưa cả hai vào giấy báo nợ.
- `CUS-07-05` **Đơn giá thay đổi theo ngày hiệu lực:** Ngày phát sinh nằm sau ngày áp dụng bảng giá mới. **Expected:** Gợi ý đúng đơn giá tại ngày phát sinh; vẫn lưu giá gốc và lý do nếu người dùng thay đổi.
- `CUS-07-06` **Từ chối rồi nộp lại:** Kế toán từ chối khoản chi hộ; nhân viên giao nhận sửa và gửi lại. **Expected:** Giữ lịch sử lần trước; lần nộp lại có trạng thái riêng; chỉ bản được duyệt mới được tính tiền.

## M3 module-specific cross-cutting confirmations

- **Vai trò và phân quyền:** Xác định rõ quyền của CUS, giao nhận, kế toán, quản lý và người dùng phía khách hàng; áp dụng nguyên tắc chỉ xem đúng dữ liệu cần thiết. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Kênh liên lạc:** Cổng thông tin khách hàng là kênh chính; thư điện tử và thông báo trên thiết bị là kênh bổ sung. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Dữ liệu danh mục:** Khách hàng cung cấp danh sách cảng, loại phí, bảng giá, tuyến và người chịu trách nhiệm cập nhật. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Tích hợp hệ thống khác:** Liệt kê hệ thống định vị, phần mềm kế toán và nguồn dữ liệu cần kết nối; xác định dữ liệu trao đổi và tần suất. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Báo cáo:** Ưu tiên: tiến độ lô, khoản chi hộ, giấy báo nợ, công nợ theo thời gian và báo cáo lãi lỗ liên quan. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Thiết bị sử dụng:** Giao diện phải dùng tốt trên máy tính và điện thoại; chốt có cần ứng dụng cài đặt riêng hay không. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Kỳ thanh toán và hạn mức công nợ:** Cấu hình theo từng khách hàng; cảnh báo khi gần đến hạn hoặc vượt hạn mức. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Lưu trữ và bảo mật chứng từ:** Chốt thời hạn lưu, quyền tải xuống, sao lưu, phục hồi và yêu cầu che thông tin nhạy cảm. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Quy tắc ngày giờ và ngày nghỉ:** Dùng giờ Việt Nam; thống nhất cách tính hạn vào cuối tuần, ngày lễ và thời điểm sau giờ làm việc. — authority `pending decision`; source `docs/prd/Module3.docx` §4.
- **Hỗ trợ sau triển khai:** Chốt đầu mối, thời gian phản hồi, cách tiếp nhận lỗi và tiêu chí hoàn tất khắc phục. — authority `pending decision`; source `docs/prd/Module3.docx` §4.

## M3 module-wide acceptance criteria

- `HT-01` **Ngôn ngữ:** Toàn bộ nhãn, hướng dẫn và thông báo lỗi hiển thị bằng tiếng Việt; chỉ giữ ký hiệu CUS và tên riêng hoặc mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng khách hàng, lô hàng và chức năng được giao; thử truy cập trái quyền phải bị từ chối. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-03` **Nhật ký:** Mọi thao tác tạo, sửa, xác nhận, từ chối, hủy và duyệt ngoại lệ đều ghi người thực hiện, thời điểm, dữ liệu thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-04` **Tính toàn vẹn dữ liệu:** Không phát sinh bản ghi trùng ngoài ý muốn; thao tác gửi lại do mạng chập chờn không tạo hai lô, hai khoản thu hoặc hai lần thanh toán. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-05` **Tệp đính kèm:** Chấp nhận đúng loại và dung lượng đã chốt; cảnh báo tệp lỗi; tải lên lại không làm mất lịch sử; tệp tải xuống mở được. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-06` **Tìm kiếm:** Tìm được theo mã lô, vận đơn, số công-te-nơ, khách hàng, khoảng ngày và trạng thái; kết quả đúng phạm vi quyền. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-07` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; dấu phân cách và phép cộng trừ đúng; tổng trên màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-08` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; lưu đúng thứ tự sự kiện; xử lý đúng ngày nghỉ và mốc qua ngày. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-09` **Khả năng sử dụng:** Các tác vụ chính hoàn thành được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-10` **Khôi phục lỗi:** Khi mất kết nối hoặc máy chủ tạm lỗi, thông báo dễ hiểu; không mất dữ liệu đã lưu; người dùng có thể thử lại an toàn. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-11` **Bảo mật:** Phiên đăng nhập hết hạn đúng quy định; đường dẫn trực tiếp không vượt quyền; chứng từ không công khai ngoài hệ thống. — authority `pending decision`; source `docs/prd/Module3.docx` §5.
- `HT-12` **Đối chiếu cuối kỳ:** Tổng giấy báo nợ, khoản đã thu, số còn phải thu và chi hộ khớp báo cáo chi tiết; mọi chênh lệch truy ngược được đến chứng từ. — authority `pending decision`; source `docs/prd/Module3.docx` §5.

# M4 — PHÂN HỆ 4 — QUY TRÌNH CHI HỘ VÀ THU HỘ KHÉP KÍN

## 4.1 — CUS hoặc nhân viên chứng từ khởi tạo lô hàng

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** CUS hoặc nhân viên chứng từ khởi tạo lô hàng.
- **Roles stated by source:** CUS và nhân viên chứng từ được phân quyền
- **Business need / visible outcome:** CUS và nhân viên chứng từ được phân quyền cần cUS hoặc nhân viên chứng từ khởi tạo lô hàng. Kết quả mong muốn: các bộ phận nhìn thấy cùng một hồ sơ lô và cùng danh sách công-te-nơ
- **Required data:** khách hàng, vận đơn, công-te-nơ, tờ khai, ngày giao và địa điểm
- **Core rule:** Lô phải có mã duy nhất và đủ dữ liệu tối thiểu trước khi nhân viên hiện trường ghi chi phí
- **Displayed/saved result:** Các bộ phận nhìn thấy cùng một hồ sơ lô và cùng danh sách công-te-nơ
- **Exception:** Cho phép lưu nháp khi thiếu dữ liệu nhưng không cho chuyển bước; hồ sơ trùng phải cảnh báo
- **Boundary cases:** Một vận đơn nhiều công-te-nơ; một tờ khai nhiều công-te-nơ; tạo ngoài giờ
- **Section summary:** Lô phải có mã duy nhất và đủ dữ liệu tối thiểu trước khi nhân viên hiện trường ghi chi phí
- **Source:** `docs/prd/Module4.docx` §4.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-01-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khách hàng, vận đơn, công-te-nơ, tờ khai, ngày giao và địa điểm và hoàn tất thao tác. **Expected:** Các bộ phận nhìn thấy cùng một hồ sơ lô và cùng danh sách công-te-nơ
- `M04-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-01-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Cho phép lưu nháp khi thiếu dữ liệu nhưng không cho chuyển bước; hồ sơ trùng phải cảnh báo **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-01-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-01-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra một vận đơn nhiều công-te-nơ; một tờ khai nhiều công-te-nơ; tạo ngoài giờ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 4.2 — Nhân viên hiện trường ghi chi phí ở trạng thái chờ

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Nhân viên hiện trường ghi chi phí ở trạng thái chờ.
- **Roles stated by source:** Nhân viên hiện trường ghi khoản mình thực chi; kế toán duyệt
- **Business need / visible outcome:** Nhân viên hiện trường ghi khoản mình thực chi; kế toán duyệt cần nhân viên hiện trường ghi chi phí ở trạng thái chờ. Kết quả mong muốn: cUS và kế toán thấy khoản chi mới cùng người chi, thời điểm và chứng từ
- **Required data:** mã lô, công-te-nơ, hạng mục, số tiền, hình thức chi, ngày và ảnh chứng từ
- **Core rule:** Khoản mới luôn ở trạng thái chờ; người nhập chỉ sửa khoản của mình khi chưa gửi duyệt
- **Displayed/saved result:** CUS và kế toán thấy khoản chi mới cùng người chi, thời điểm và chứng từ
- **Exception:** Thiếu chứng từ bắt buộc hoặc số tiền không hợp lệ thì không gửi duyệt
- **Boundary cases:** Mất mạng tại cảng; tải ảnh chậm; nhập nhầm lô rồi sửa trước duyệt
- **Section summary:** Khoản mới luôn ở trạng thái chờ; người nhập chỉ sửa khoản của mình khi chưa gửi duyệt
- **Source:** `docs/prd/Module4.docx` §4.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-02-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ mã lô, công-te-nơ, hạng mục, số tiền, hình thức chi, ngày và ảnh chứng từ và hoàn tất thao tác. **Expected:** CUS và kế toán thấy khoản chi mới cùng người chi, thời điểm và chứng từ
- `M04-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-02-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Thiếu chứng từ bắt buộc hoặc số tiền không hợp lệ thì không gửi duyệt **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-02-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-02-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra mất mạng tại cảng; tải ảnh chậm; nhập nhầm lô rồi sửa trước duyệt. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 4.3 — Gom chi phí của nhiều nhân viên về đúng một lô

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Gom chi phí của nhiều nhân viên về đúng một lô.
- **Roles stated by source:** Hệ thống tự tổng hợp; kế toán và CUS kiểm tra
- **Business need / visible outcome:** Hệ thống tự tổng hợp; kế toán và CUS kiểm tra cần gom chi phí của nhiều nhân viên về đúng một lô. Kết quả mong muốn: chi tiết lô hiển thị tổng theo hạng mục, công-te-nơ, người chi và trạng thái
- **Required data:** các khoản chi từ nhiều nhân viên cùng mã lô và công-te-nơ
- **Core rule:** Tổng hợp theo lô nhưng giữ từng dòng, từng người chi và chứng từ; không gộp mất dấu vết
- **Displayed/saved result:** Chi tiết lô hiển thị tổng theo hạng mục, công-te-nơ, người chi và trạng thái
- **Exception:** Khoản nhập sai mã lô phải được chuyển có kiểm soát và lưu lịch sử
- **Boundary cases:** Hai người nhập cùng lúc; cùng loại phí hai lần hợp lệ; khoản chi chung không gắn công-te-nơ
- **Section summary:** Tổng hợp theo lô nhưng giữ từng dòng, từng người chi và chứng từ; không gộp mất dấu vết
- **Source:** `docs/prd/Module4.docx` §4.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-03-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ các khoản chi từ nhiều nhân viên cùng mã lô và công-te-nơ và hoàn tất thao tác. **Expected:** Chi tiết lô hiển thị tổng theo hạng mục, công-te-nơ, người chi và trạng thái
- `M04-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-03-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Khoản nhập sai mã lô phải được chuyển có kiểm soát và lưu lịch sử **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-03-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-03-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra hai người nhập cùng lúc; cùng loại phí hai lần hợp lệ; khoản chi chung không gắn công-te-nơ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 4.4 — Kế toán đối chiếu chứng từ và duyệt khoản chi

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Kế toán đối chiếu chứng từ và duyệt khoản chi.
- **Roles stated by source:** Kế toán duyệt; quản lý xem; người nhập nhận thông báo
- **Business need / visible outcome:** Kế toán duyệt; quản lý xem; người nhập nhận thông báo cần kế toán đối chiếu chứng từ và duyệt khoản chi. Kết quả mong muốn: trạng thái, người duyệt, thời điểm và số tiền được chấp nhận được lưu rõ ràng
- **Required data:** khoản đang chờ, chứng từ gốc, bảng giá, số tiền và lý do chênh lệch
- **Core rule:** Duyệt hoặc từ chối theo từng khoản hay phiếu hoàn ứng đã chốt; khoản được duyệt bị khóa khỏi sửa trực tiếp
- **Displayed/saved result:** Trạng thái, người duyệt, thời điểm và số tiền được chấp nhận được lưu rõ ràng
- **Exception:** Kế toán sửa số tiền phải nêu lý do; khoản bị từ chối có thể sửa và gửi lại mà vẫn giữ lịch sử
- **Boundary cases:** Duyệt đồng thời; chứng từ trùng; chênh lệch vượt ngưỡng
- **Section summary:** Duyệt hoặc từ chối theo từng khoản hay phiếu hoàn ứng đã chốt; khoản được duyệt bị khóa khỏi sửa trực tiếp
- **Source:** `docs/prd/Module4.docx` §4.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-04-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khoản đang chờ, chứng từ gốc, bảng giá, số tiền và lý do chênh lệch và hoàn tất thao tác. **Expected:** Trạng thái, người duyệt, thời điểm và số tiền được chấp nhận được lưu rõ ràng
- `M04-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-04-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Kế toán sửa số tiền phải nêu lý do; khoản bị từ chối có thể sửa và gửi lại mà vẫn giữ lịch sử **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-04-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-04-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra duyệt đồng thời; chứng từ trùng; chênh lệch vượt ngưỡng. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 4.5 — Sinh giấy báo nợ và chốt vào kỳ phù hợp

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Sinh giấy báo nợ và chốt vào kỳ phù hợp.
- **Roles stated by source:** Kế toán lập; CUS kiểm tra và gửi khách hàng
- **Business need / visible outcome:** Kế toán lập; CUS kiểm tra và gửi khách hàng cần sinh giấy báo nợ và chốt vào kỳ phù hợp. Kết quả mong muốn: giấy báo nợ tách nhóm khoản thu, tính tổng đúng và liên kết về chứng từ nguồn
- **Required data:** lô, kỳ thanh toán của khách, cước, phí dịch vụ và khoản chi hộ đã duyệt
- **Core rule:** Chỉ đưa khoản đã duyệt vào đúng kỳ; không đưa lại khoản đã nằm trên giấy báo nợ khác
- **Displayed/saved result:** Giấy báo nợ tách nhóm khoản thu, tính tổng đúng và liên kết về chứng từ nguồn
- **Exception:** Khoản duyệt sau khi kỳ đã phát hành phải chuyển kỳ sau hoặc lập điều chỉnh theo quyết định đã chốt
- **Boundary cases:** Kỳ tuần hoặc tháng; lô qua hai kỳ; lập lại cùng phạm vi
- **Section summary:** Chỉ đưa khoản đã duyệt vào đúng kỳ; không đưa lại khoản đã nằm trên giấy báo nợ khác
- **Source:** `docs/prd/Module4.docx` §4.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-05-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ lô, kỳ thanh toán của khách, cước, phí dịch vụ và khoản chi hộ đã duyệt và hoàn tất thao tác. **Expected:** Giấy báo nợ tách nhóm khoản thu, tính tổng đúng và liên kết về chứng từ nguồn
- `M04-05-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-05-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Khoản duyệt sau khi kỳ đã phát hành phải chuyển kỳ sau hoặc lập điều chỉnh theo quyết định đã chốt **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-05-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-05-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra kỳ tuần hoặc tháng; lô qua hai kỳ; lập lại cùng phạm vi. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 4.6 — Phân loại khoản chi hộ có hóa đơn

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.6, customer-response and conclusion cells blank.
- **Intended page/workflow:** Phân loại khoản chi hộ có hóa đơn.
- **Roles stated by source:** Nhân viên hiện trường nhập; kế toán kiểm tra
- **Business need / visible outcome:** Nhân viên hiện trường nhập; kế toán kiểm tra cần phân loại khoản chi hộ có hóa đơn. Kết quả mong muốn: khoản chi thể hiện rõ số hóa đơn, thuế, tổng tiền và trạng thái đối chiếu
- **Required data:** hạng mục, số hóa đơn, ngày hóa đơn, đơn vị phát hành, tiền trước thuế, thuế và ảnh
- **Core rule:** Các hạng mục yêu cầu hóa đơn phải đủ thông tin trước khi duyệt; không suy đoán thuế khi thiếu căn cứ
- **Displayed/saved result:** Khoản chi thể hiện rõ số hóa đơn, thuế, tổng tiền và trạng thái đối chiếu
- **Exception:** Hóa đơn điều chỉnh, thay thế hoặc dùng cho nhiều dòng phải liên kết rõ và tránh tính trùng
- **Boundary cases:** Hóa đơn nhiều trang; hóa đơn phát hành sau ngày chi; thuế suất khác nhau
- **Section summary:** Các hạng mục yêu cầu hóa đơn phải đủ thông tin trước khi duyệt; không suy đoán thuế khi thiếu căn cứ
- **Source:** `docs/prd/Module4.docx` §4.6, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-06-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ hạng mục, số hóa đơn, ngày hóa đơn, đơn vị phát hành, tiền trước thuế, thuế và ảnh và hoàn tất thao tác. **Expected:** Khoản chi thể hiện rõ số hóa đơn, thuế, tổng tiền và trạng thái đối chiếu
- `M04-06-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-06-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Hóa đơn điều chỉnh, thay thế hoặc dùng cho nhiều dòng phải liên kết rõ và tránh tính trùng **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-06-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-06-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra hóa đơn nhiều trang; hóa đơn phát hành sau ngày chi; thuế suất khác nhau. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 4.7 — Phân loại khoản chi hộ không có hóa đơn

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 2/3 checked items.
- **Authority:** `pending decision` — `docs/prd/Module4.docx` §4.7, customer-response and conclusion cells blank.
- **Intended page/workflow:** Phân loại khoản chi hộ không có hóa đơn.
- **Roles stated by source:** Nhân viên hiện trường nhập; kế toán quyết định chấp nhận
- **Business need / visible outcome:** Nhân viên hiện trường nhập; kế toán quyết định chấp nhận cần phân loại khoản chi hộ không có hóa đơn. Kết quả mong muốn: báo cáo tách riêng khoản không có hóa đơn và vẫn truy ngược được người duyệt
- **Required data:** hạng mục, số tiền, người nhận, ngày chi, căn cứ thay thế và ghi chú
- **Core rule:** Chỉ dùng cho hạng mục được phép; bắt buộc có lý do và chứng cứ thay thế theo quy định nội bộ
- **Displayed/saved result:** Báo cáo tách riêng khoản không có hóa đơn và vẫn truy ngược được người duyệt
- **Exception:** Khoản vượt ngưỡng hoặc không có căn cứ phải bị từ chối hoặc chuyển xin phê duyệt
- **Boundary cases:** Nhiều khoản nhỏ cùng ngày; người nhận không có mã số thuế; khoản hoàn lại
- **Section summary:** Chỉ dùng cho hạng mục được phép; bắt buộc có lý do và chứng cứ thay thế theo quy định nội bộ
- **Source:** `docs/prd/Module4.docx` §4.7, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M04-07-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ hạng mục, số tiền, người nhận, ngày chi, căn cứ thay thế và ghi chú và hoàn tất thao tác. **Expected:** Báo cáo tách riêng khoản không có hóa đơn và vẫn truy ngược được người duyệt
- `M04-07-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M04-07-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Khoản vượt ngưỡng hoặc không có căn cứ phải bị từ chối hoặc chuyển xin phê duyệt **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M04-07-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M04-07-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra nhiều khoản nhỏ cùng ngày; người nhận không có mã số thuế; khoản hoàn lại. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M4 module-wide acceptance criteria

- `M04-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module4.docx` §5.
- `M04-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 4 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module4.docx` §5.

# M5 — PHÂN HỆ 5 — QUẢN LÝ CÔNG NỢ PHẢI THU

## 5.1 — Theo dõi công nợ khách hàng theo giấy báo nợ hoặc hóa đơn

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Theo dõi công nợ khách hàng theo giấy báo nợ hoặc hóa đơn.
- **Roles stated by source:** Kế toán quản lý; CUS và giám đốc xem theo quyền
- **Business need / visible outcome:** Kế toán quản lý; CUS và giám đốc xem theo quyền cần theo dõi công nợ khách hàng theo giấy báo nợ hoặc hóa đơn. Kết quả mong muốn: hiển thị chi tiết từng chứng từ, số đã thu, còn nợ, số ngày quá hạn và lịch sử thanh toán
- **Required data:** khách hàng, chứng từ phải thu, ngày phát hành, hạn thanh toán, đã thu và còn phải thu
- **Core rule:** Số dư hiện tại lấy từ các phát sinh và thanh toán hợp lệ; không sửa trực tiếp số dư
- **Displayed/saved result:** Hiển thị chi tiết từng chứng từ, số đã thu, còn nợ, số ngày quá hạn và lịch sử thanh toán
- **Exception:** Chứng từ hủy hoặc điều chỉnh phải có dòng bù trừ rõ, không biến mất khỏi lịch sử
- **Boundary cases:** Thanh toán một phần; thanh toán thừa; nhiều tiền tệ nếu phát sinh
- **Section summary:** Số dư hiện tại lấy từ các phát sinh và thanh toán hợp lệ; không sửa trực tiếp số dư
- **Source:** `docs/prd/Module5.docx` §5.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-01-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm khách hàng, chứng từ phải thu, ngày phát hành, hạn thanh toán, đã thu và còn phải thu. **Expected:** Hiển thị chi tiết từng chứng từ, số đã thu, còn nợ, số ngày quá hạn và lịch sử thanh toán
- `M05-01-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M05-01-03` **Trường hợp biên:** Kiểm tra: Thanh toán một phần; thanh toán thừa; nhiều tiền tệ nếu phát sinh **Expected:** Kết quả tuân thủ quy tắc: Số dư hiện tại lấy từ các phát sinh và thanh toán hợp lệ; không sửa trực tiếp số dư
- `M05-01-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M05-01-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 5.2 — Phân loại tuổi nợ

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Phân loại tuổi nợ.
- **Roles stated by source:** Kế toán và giám đốc
- **Business need / visible outcome:** Kế toán và giám đốc cần phân loại tuổi nợ. Kết quả mong muốn: tổng từng nhóm tuổi nợ phải bằng tổng công nợ chưa thu tại cùng thời điểm
- **Required data:** ngày bắt đầu tính hạn, ngày đến hạn, ngày báo cáo và số còn phải thu
- **Core rule:** Phân nhóm dưới 30, từ 31 đến 60, từ 61 đến 90 và trên 90 ngày theo quy tắc ngày đã chốt
- **Displayed/saved result:** Tổng từng nhóm tuổi nợ phải bằng tổng công nợ chưa thu tại cùng thời điểm
- **Exception:** Khoản đang tranh chấp hoặc chưa đến hạn phải có nhãn riêng nếu khách hàng yêu cầu
- **Boundary cases:** Đúng ngày 30, 60, 90; ngày nghỉ; thanh toán một phần giữa kỳ
- **Section summary:** Phân nhóm dưới 30, từ 31 đến 60, từ 61 đến 90 và trên 90 ngày theo quy tắc ngày đã chốt
- **Source:** `docs/prd/Module5.docx` §5.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-02-01` **Tính toán thông thường:** Nhập đầy đủ ngày bắt đầu tính hạn, ngày đến hạn, ngày báo cáo và số còn phải thu. **Expected:** Tổng từng nhóm tuổi nợ phải bằng tổng công nợ chưa thu tại cùng thời điểm
- `M05-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M05-02-03` **Giá trị biên:** Kiểm tra: Đúng ngày 30, 60, 90; ngày nghỉ; thanh toán một phần giữa kỳ **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Phân nhóm dưới 30, từ 31 đến 60, từ 61 đến 90 và trên 90 ngày theo quy tắc ngày đã chốt
- `M05-02-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Khoản đang tranh chấp hoặc chưa đến hạn phải có nhãn riêng nếu khách hàng yêu cầu **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M05-02-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 5.3 — Hạn mức công nợ và cảnh báo vượt ngưỡng

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Hạn mức công nợ và cảnh báo vượt ngưỡng.
- **Roles stated by source:** Quản lý phê duyệt hạn mức; kế toán và CUS nhận cảnh báo
- **Business need / visible outcome:** Quản lý phê duyệt hạn mức; kế toán và CUS nhận cảnh báo cần hạn mức công nợ và cảnh báo vượt ngưỡng. Kết quả mong muốn: hiển thị hạn mức, dư nợ, phần còn lại và các lô khiến vượt ngưỡng
- **Required data:** khách hàng, hạn mức, ngày hiệu lực, dư nợ hiện tại và đơn hàng mới
- **Core rule:** Cảnh báo khi gần đạt và khi vượt; ngưỡng cảnh báo sớm phải cấu hình được
- **Displayed/saved result:** Hiển thị hạn mức, dư nợ, phần còn lại và các lô khiến vượt ngưỡng
- **Exception:** Vượt hạn mức chỉ được tiếp tục khi người có thẩm quyền chấp thuận và nêu lý do
- **Boundary cases:** Hạn mức bằng không; đổi hạn mức hồi tố; thanh toán vừa ghi nhận
- **Section summary:** Cảnh báo khi gần đạt và khi vượt; ngưỡng cảnh báo sớm phải cấu hình được
- **Source:** `docs/prd/Module5.docx` §5.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-03-01` **Tính toán thông thường:** Nhập đầy đủ khách hàng, hạn mức, ngày hiệu lực, dư nợ hiện tại và đơn hàng mới. **Expected:** Hiển thị hạn mức, dư nợ, phần còn lại và các lô khiến vượt ngưỡng
- `M05-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M05-03-03` **Giá trị biên:** Kiểm tra: Hạn mức bằng không; đổi hạn mức hồi tố; thanh toán vừa ghi nhận **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Cảnh báo khi gần đạt và khi vượt; ngưỡng cảnh báo sớm phải cấu hình được
- `M05-03-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Vượt hạn mức chỉ được tiếp tục khi người có thẩm quyền chấp thuận và nêu lý do **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M05-03-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 5.4 — Tách cước vận chuyển và khoản chi hộ trong công nợ

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tách cước vận chuyển và khoản chi hộ trong công nợ.
- **Roles stated by source:** Kế toán và giám đốc; CUS xem để đối soát
- **Business need / visible outcome:** Kế toán và giám đốc; CUS xem để đối soát cần tách cước vận chuyển và khoản chi hộ trong công nợ. Kết quả mong muốn: chi tiết và báo cáo hiển thị riêng cước, chi hộ, thuế và tổng cộng
- **Required data:** các dòng cước, phí dịch vụ, chi hộ, thuế, điều chỉnh và thanh toán
- **Core rule:** Mỗi phát sinh giữ đúng nhóm; tổng hai nhóm cộng các khoản khác phải bằng tổng công nợ
- **Displayed/saved result:** Chi tiết và báo cáo hiển thị riêng cước, chi hộ, thuế và tổng cộng
- **Exception:** Thanh toán không chỉ định nhóm phải có quy tắc phân bổ rõ; không làm sai báo cáo thuế
- **Boundary cases:** Một giấy báo nợ có nhiều nhóm; điều chỉnh âm; khoản chi hộ kỳ trước
- **Section summary:** Mỗi phát sinh giữ đúng nhóm; tổng hai nhóm cộng các khoản khác phải bằng tổng công nợ
- **Source:** `docs/prd/Module5.docx` §5.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-04-01` **Tính toán thông thường:** Nhập đầy đủ các dòng cước, phí dịch vụ, chi hộ, thuế, điều chỉnh và thanh toán. **Expected:** Chi tiết và báo cáo hiển thị riêng cước, chi hộ, thuế và tổng cộng
- `M05-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M05-04-03` **Giá trị biên:** Kiểm tra: Một giấy báo nợ có nhiều nhóm; điều chỉnh âm; khoản chi hộ kỳ trước **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Mỗi phát sinh giữ đúng nhóm; tổng hai nhóm cộng các khoản khác phải bằng tổng công nợ
- `M05-04-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Thanh toán không chỉ định nhóm phải có quy tắc phân bổ rõ; không làm sai báo cáo thuế **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M05-04-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 5.5 — Báo cáo tổng công nợ bao gồm cước và chi hộ

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Báo cáo tổng công nợ bao gồm cước và chi hộ.
- **Roles stated by source:** Giám đốc và kế toán
- **Business need / visible outcome:** Giám đốc và kế toán cần báo cáo tổng công nợ bao gồm cước và chi hộ. Kết quả mong muốn: hiển thị tổng đầu kỳ, phát sinh, đã thu, điều chỉnh và cuối kỳ theo từng khách hàng
- **Required data:** kỳ báo cáo, khách hàng, nhóm khoản thu, trạng thái và tuổi nợ
- **Core rule:** Tổng báo cáo phải đối chiếu được với chi tiết khách hàng và số dư sổ công nợ tại cùng thời điểm
- **Displayed/saved result:** Hiển thị tổng đầu kỳ, phát sinh, đã thu, điều chỉnh và cuối kỳ theo từng khách hàng
- **Exception:** Khách hàng không phát sinh nhưng còn số dư vẫn phải xuất hiện
- **Boundary cases:** Kỳ cắt giữa ngày; dữ liệu vừa chốt; khách hàng đổi tên
- **Section summary:** Tổng báo cáo phải đối chiếu được với chi tiết khách hàng và số dư sổ công nợ tại cùng thời điểm
- **Source:** `docs/prd/Module5.docx` §5.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-05-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm kỳ báo cáo, khách hàng, nhóm khoản thu, trạng thái và tuổi nợ. **Expected:** Hiển thị tổng đầu kỳ, phát sinh, đã thu, điều chỉnh và cuối kỳ theo từng khách hàng
- `M05-05-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M05-05-03` **Trường hợp biên:** Kiểm tra: Kỳ cắt giữa ngày; dữ liệu vừa chốt; khách hàng đổi tên **Expected:** Kết quả tuân thủ quy tắc: Tổng báo cáo phải đối chiếu được với chi tiết khách hàng và số dư sổ công nợ tại cùng thời điểm
- `M05-05-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M05-05-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 5.6 — Phân bổ thanh toán theo chuyến hoặc lô hàng

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.6, customer-response and conclusion cells blank.
- **Intended page/workflow:** Phân bổ thanh toán theo chuyến hoặc lô hàng.
- **Roles stated by source:** Kế toán thực hiện; quản lý xem và xử lý ngoại lệ
- **Business need / visible outcome:** Kế toán thực hiện; quản lý xem và xử lý ngoại lệ cần phân bổ thanh toán theo chuyến hoặc lô hàng. Kết quả mong muốn: mỗi khoản phân bổ liên kết chứng từ tiền về và cập nhật đúng số còn phải thu
- **Required data:** chứng từ tiền về, khách hàng, ngày nhận, số tiền và danh sách chuyến hoặc lô
- **Core rule:** Cho phép thanh toán một phần và phân bổ theo chỉ dẫn khách; nếu không có chỉ dẫn thì gợi ý khoản cũ trước
- **Displayed/saved result:** Mỗi khoản phân bổ liên kết chứng từ tiền về và cập nhật đúng số còn phải thu
- **Exception:** Không cho phân bổ vượt tiền nhận hoặc vượt số còn nợ nếu chưa xác nhận khoản thừa
- **Boundary cases:** Một khoản trả cho nhiều lô; trả nhầm khách; hủy phân bổ sau chốt
- **Section summary:** Cho phép thanh toán một phần và phân bổ theo chỉ dẫn khách; nếu không có chỉ dẫn thì gợi ý khoản cũ trước
- **Source:** `docs/prd/Module5.docx` §5.6, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-06-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ chứng từ tiền về, khách hàng, ngày nhận, số tiền và danh sách chuyến hoặc lô và hoàn tất thao tác. **Expected:** Mỗi khoản phân bổ liên kết chứng từ tiền về và cập nhật đúng số còn phải thu
- `M05-06-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M05-06-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Không cho phân bổ vượt tiền nhận hoặc vượt số còn nợ nếu chưa xác nhận khoản thừa **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M05-06-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M05-06-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra một khoản trả cho nhiều lô; trả nhầm khách; hủy phân bổ sau chốt. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 5.7 — Nhắc nợ tự động khi đến hạn hoặc quá hạn

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.7, customer-response and conclusion cells blank.
- **Intended page/workflow:** Nhắc nợ tự động khi đến hạn hoặc quá hạn.
- **Roles stated by source:** Kế toán cấu hình; hệ thống gửi; CUS theo dõi
- **Business need / visible outcome:** Kế toán cấu hình; hệ thống gửi; CUS theo dõi cần nhắc nợ tự động khi đến hạn hoặc quá hạn. Kết quả mong muốn: lưu nội dung, kênh, người nhận, thời điểm và kết quả gửi
- **Required data:** khách hàng, người nhận, hạn thanh toán, số còn nợ, mẫu nội dung và lịch gửi
- **Core rule:** Không gửi cho khoản đã thanh toán, đang tranh chấp hoặc khách bị tạm dừng; tránh gửi lặp trong cùng chu kỳ
- **Displayed/saved result:** Lưu nội dung, kênh, người nhận, thời điểm và kết quả gửi
- **Exception:** Kênh gửi thất bại phải thử lại theo quy định và báo cho người phụ trách
- **Boundary cases:** Đến hạn vào ngày nghỉ; nhiều chứng từ cùng khách; người nhận đổi địa chỉ
- **Section summary:** Không gửi cho khoản đã thanh toán, đang tranh chấp hoặc khách bị tạm dừng; tránh gửi lặp trong cùng chu kỳ
- **Source:** `docs/prd/Module5.docx` §5.7, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-07-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khách hàng, người nhận, hạn thanh toán, số còn nợ, mẫu nội dung và lịch gửi và hoàn tất thao tác. **Expected:** Lưu nội dung, kênh, người nhận, thời điểm và kết quả gửi
- `M05-07-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M05-07-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Kênh gửi thất bại phải thử lại theo quy định và báo cho người phụ trách **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M05-07-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M05-07-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra đến hạn vào ngày nghỉ; nhiều chứng từ cùng khách; người nhận đổi địa chỉ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 5.8 — Xuất sao kê và giấy báo nợ gửi khách hàng

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item / reconciled existing behavior.
- **Authority:** `pending decision` — `docs/prd/Module5.docx` §5.8, customer-response and conclusion cells blank.
- **Intended page/workflow:** Xuất sao kê và giấy báo nợ gửi khách hàng.
- **Roles stated by source:** Kế toán lập; CUS gửi; khách hàng xem
- **Business need / visible outcome:** Kế toán lập; CUS gửi; khách hàng xem cần xuất sao kê và giấy báo nợ gửi khách hàng. Kết quả mong muốn: tệp bảng tính và tệp PDF trình bày rõ, không vỡ dòng và truy ngược được từng phát sinh
- **Required data:** khách hàng, kỳ, số dư đầu kỳ, phát sinh, thanh toán, điều chỉnh và số dư cuối kỳ
- **Core rule:** Bản xuất phải khớp màn hình, có số hiệu, ngày lập và phạm vi dữ liệu; lưu lại bản đã gửi
- **Displayed/saved result:** Tệp bảng tính và tệp PDF trình bày rõ, không vỡ dòng và truy ngược được từng phát sinh
- **Exception:** Nếu dữ liệu thay đổi sau khi gửi phải phát hành bản mới hoặc điều chỉnh, không ghi đè bản cũ
- **Boundary cases:** Kỳ không phát sinh; dữ liệu nhiều trang; khách hàng có nhiều đơn vị nhận
- **Section summary:** Bản xuất phải khớp màn hình, có số hiệu, ngày lập và phạm vi dữ liệu; lưu lại bản đã gửi
- **Source:** `docs/prd/Module5.docx` §5.8, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M05-08-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm khách hàng, kỳ, số dư đầu kỳ, phát sinh, thanh toán, điều chỉnh và số dư cuối kỳ. **Expected:** Tệp bảng tính và tệp PDF trình bày rõ, không vỡ dòng và truy ngược được từng phát sinh
- `M05-08-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M05-08-03` **Trường hợp biên:** Kiểm tra: Kỳ không phát sinh; dữ liệu nhiều trang; khách hàng có nhiều đơn vị nhận **Expected:** Kết quả tuân thủ quy tắc: Bản xuất phải khớp màn hình, có số hiệu, ngày lập và phạm vi dữ liệu; lưu lại bản đã gửi
- `M05-08-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M05-08-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## M5 module-wide acceptance criteria

- `M05-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module5.docx` §5.
- `M05-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 5 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module5.docx` §5.

# M6 — PHÂN HỆ 6 — QUẢN LÝ CÔNG NỢ PHẢI TRẢ

## 6.1 — Theo dõi công nợ nhiên liệu

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module6.docx` §6.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Theo dõi công nợ nhiên liệu.
- **Roles stated by source:** Kế toán ghi nhận và thanh toán; giám đốc xem
- **Business need / visible outcome:** Kế toán ghi nhận và thanh toán; giám đốc xem cần theo dõi công nợ nhiên liệu. Kết quả mong muốn: hiển thị số đã trả, còn phải trả, hạn thanh toán và chênh lệch với dữ liệu nhiên liệu
- **Required data:** nhà cung cấp, hóa đơn nhiên liệu, kỳ, số lít, đơn giá, tổng tiền, hạn và trạng thái
- **Core rule:** Đối chiếu hóa đơn với nhiên liệu đã ghi nhận theo xe và kỳ; chỉ ghi công nợ một lần cho mỗi hóa đơn
- **Displayed/saved result:** Hiển thị số đã trả, còn phải trả, hạn thanh toán và chênh lệch với dữ liệu nhiên liệu
- **Exception:** Hóa đơn điều chỉnh hoặc chênh lệch số lít phải được giải trình trước khi duyệt
- **Boundary cases:** Một hóa đơn cho nhiều xe; thanh toán một phần; hóa đơn đến sau kỳ
- **Section summary:** Đối chiếu hóa đơn với nhiên liệu đã ghi nhận theo xe và kỳ; chỉ ghi công nợ một lần cho mỗi hóa đơn
- **Source:** `docs/prd/Module6.docx` §6.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M06-01-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ nhà cung cấp, hóa đơn nhiên liệu, kỳ, số lít, đơn giá, tổng tiền, hạn và trạng thái và hoàn tất thao tác. **Expected:** Hiển thị số đã trả, còn phải trả, hạn thanh toán và chênh lệch với dữ liệu nhiên liệu
- `M06-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M06-01-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Hóa đơn điều chỉnh hoặc chênh lệch số lít phải được giải trình trước khi duyệt **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M06-01-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M06-01-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra một hóa đơn cho nhiều xe; thanh toán một phần; hóa đơn đến sau kỳ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 6.2 — Mở rộng công nợ cho hãng tàu, nhà xe, cảng, kho và dịch vụ

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module6.docx` §6.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Mở rộng công nợ cho hãng tàu, nhà xe, cảng, kho và dịch vụ.
- **Roles stated by source:** Kế toán quản lý; bộ phận nghiệp vụ cung cấp chứng từ
- **Business need / visible outcome:** Kế toán quản lý; bộ phận nghiệp vụ cung cấp chứng từ cần mở rộng công nợ cho hãng tàu, nhà xe, cảng, kho và dịch vụ. Kết quả mong muốn: sổ công nợ hiển thị phát sinh theo loại dịch vụ, chứng từ và trạng thái
- **Required data:** nhà cung cấp, loại dịch vụ, hóa đơn, lô hoặc chuyến, số tiền, thuế và hạn thanh toán
- **Core rule:** Mỗi khoản phải trả liên kết đúng nhà cung cấp và chứng từ nguồn; danh mục nhà cung cấp không bị trùng
- **Displayed/saved result:** Sổ công nợ hiển thị phát sinh theo loại dịch vụ, chứng từ và trạng thái
- **Exception:** Nhà cung cấp chưa có hồ sơ phải được tạo và kiểm tra trước; khoản không có hóa đơn cần căn cứ thay thế
- **Boundary cases:** Nhà xe đồng thời là khách hàng; một hóa đơn nhiều lô; đổi tên nhà cung cấp
- **Section summary:** Mỗi khoản phải trả liên kết đúng nhà cung cấp và chứng từ nguồn; danh mục nhà cung cấp không bị trùng
- **Source:** `docs/prd/Module6.docx` §6.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M06-02-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ nhà cung cấp, loại dịch vụ, hóa đơn, lô hoặc chuyến, số tiền, thuế và hạn thanh toán và hoàn tất thao tác. **Expected:** Sổ công nợ hiển thị phát sinh theo loại dịch vụ, chứng từ và trạng thái
- `M06-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M06-02-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Nhà cung cấp chưa có hồ sơ phải được tạo và kiểm tra trước; khoản không có hóa đơn cần căn cứ thay thế **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M06-02-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M06-02-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra nhà xe đồng thời là khách hàng; một hóa đơn nhiều lô; đổi tên nhà cung cấp. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 6.3 — Theo dõi hóa đơn, ngày đến hạn và thanh toán nhà cung cấp

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module6.docx` §6.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Theo dõi hóa đơn, ngày đến hạn và thanh toán nhà cung cấp.
- **Roles stated by source:** Kế toán ghi nhận; người có thẩm quyền duyệt chi theo quy định
- **Business need / visible outcome:** Kế toán ghi nhận; người có thẩm quyền duyệt chi theo quy định cần theo dõi hóa đơn, ngày đến hạn và thanh toán nhà cung cấp. Kết quả mong muốn: hiển thị tuổi nợ phải trả, lịch sử chi và số còn phải trả theo hóa đơn
- **Required data:** hóa đơn, ngày nhận, ngày đến hạn, số tiền, lịch thanh toán và chứng từ chi
- **Core rule:** Thanh toán giảm đúng công nợ; cho phép trả một phần; không ghi nhận hai lần cùng chứng từ chi
- **Displayed/saved result:** Hiển thị tuổi nợ phải trả, lịch sử chi và số còn phải trả theo hóa đơn
- **Exception:** Thanh toán trước hóa đơn hoặc trả thừa phải được ghi thành khoản tạm ứng hoặc chưa phân bổ
- **Boundary cases:** Đúng ngày đến hạn; ngày nghỉ; một khoản chi trả nhiều hóa đơn
- **Section summary:** Thanh toán giảm đúng công nợ; cho phép trả một phần; không ghi nhận hai lần cùng chứng từ chi
- **Source:** `docs/prd/Module6.docx` §6.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M06-03-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ hóa đơn, ngày nhận, ngày đến hạn, số tiền, lịch thanh toán và chứng từ chi và hoàn tất thao tác. **Expected:** Hiển thị tuổi nợ phải trả, lịch sử chi và số còn phải trả theo hóa đơn
- `M06-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M06-03-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Thanh toán trước hóa đơn hoặc trả thừa phải được ghi thành khoản tạm ứng hoặc chưa phân bổ **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M06-03-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M06-03-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra đúng ngày đến hạn; ngày nghỉ; một khoản chi trả nhiều hóa đơn. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 6.4 — Đối trừ công nợ song phương

- **Delivery:** `implemented` — ROADMAP.md §Wave 3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module6.docx` §6.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Đối trừ công nợ song phương.
- **Roles stated by source:** Kế toán lập; quản lý phê duyệt
- **Business need / visible outcome:** Kế toán lập; quản lý phê duyệt cần đối trừ công nợ song phương. Kết quả mong muốn: tạo hai bút toán liên kết, giảm đúng phải thu và phải trả, giữ nguyên dấu vết trước đối trừ
- **Required data:** đối tác liên kết vai trò khách hàng và nhà cung cấp, số phải thu, số phải trả, ngày và biên bản
- **Core rule:** Số đối trừ không vượt số nhỏ hơn giữa hai bên; chỉ ghi sổ sau khi phê duyệt
- **Displayed/saved result:** Tạo hai bút toán liên kết, giảm đúng phải thu và phải trả, giữ nguyên dấu vết trước đối trừ
- **Exception:** Yêu cầu bị từ chối không làm đổi số dư; hủy sau phê duyệt phải dùng bút toán hoàn tác
- **Boundary cases:** Số dư thay đổi trong lúc chờ duyệt; đối trừ một phần; hai yêu cầu đồng thời
- **Section summary:** Số đối trừ không vượt số nhỏ hơn giữa hai bên; chỉ ghi sổ sau khi phê duyệt
- **Source:** `docs/prd/Module6.docx` §6.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M06-04-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ đối tác liên kết vai trò khách hàng và nhà cung cấp, số phải thu, số phải trả, ngày và biên bản và hoàn tất thao tác. **Expected:** Tạo hai bút toán liên kết, giảm đúng phải thu và phải trả, giữ nguyên dấu vết trước đối trừ
- `M06-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M06-04-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Yêu cầu bị từ chối không làm đổi số dư; hủy sau phê duyệt phải dùng bút toán hoàn tác **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M06-04-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M06-04-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra số dư thay đổi trong lúc chờ duyệt; đối trừ một phần; hai yêu cầu đồng thời. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M6 module-wide acceptance criteria

- `M06-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module6.docx` §5.
- `M06-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 6 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module6.docx` §5.

# M7 — PHÂN HỆ 7 — QUẢN LÝ LƯƠNG, CHẤM CÔNG VÀ NHÂN SỰ LÁI XE

## 7.1 — Tự động tính lương theo chuyến, lương cơ bản và ngày chờ việc

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 3 M7.3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module7.docx` §7.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tự động tính lương theo chuyến, lương cơ bản và ngày chờ việc.
- **Roles stated by source:** Kế toán tính; quản lý xác nhận chính sách; lái xe xem
- **Business need / visible outcome:** Kế toán tính; quản lý xác nhận chính sách; lái xe xem cần tự động tính lương theo chuyến, lương cơ bản và ngày chờ việc. Kết quả mong muốn: phiếu lương tách từng thành phần và liên kết tới chuyến hoặc ngày công nguồn
- **Required data:** chuyến đã chốt, đơn giá lương chuyến, lương cơ bản, ngày chờ việc, phụ cấp và khấu trừ
- **Core rule:** Chỉ tính chuyến thuộc kỳ và đúng lái xe; mỗi chuyến được tính một lần; công thức và ngày hiệu lực phải rõ
- **Displayed/saved result:** Phiếu lương tách từng thành phần và liên kết tới chuyến hoặc ngày công nguồn
- **Exception:** Chuyến mở khóa hoặc điều chỉnh sau chốt kỳ phải đi qua kỳ điều chỉnh, không sửa âm thầm
- **Boundary cases:** Lái xe đổi xe; chuyến qua hai kỳ; nghỉ việc giữa tháng
- **Section summary:** Chỉ tính chuyến thuộc kỳ và đúng lái xe; mỗi chuyến được tính một lần; công thức và ngày hiệu lực phải rõ
- **Source:** `docs/prd/Module7.docx` §7.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M07-01-01` **Tính toán thông thường:** Nhập đầy đủ chuyến đã chốt, đơn giá lương chuyến, lương cơ bản, ngày chờ việc, phụ cấp và khấu trừ. **Expected:** Phiếu lương tách từng thành phần và liên kết tới chuyến hoặc ngày công nguồn
- `M07-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M07-01-03` **Giá trị biên:** Kiểm tra: Lái xe đổi xe; chuyến qua hai kỳ; nghỉ việc giữa tháng **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Chỉ tính chuyến thuộc kỳ và đúng lái xe; mỗi chuyến được tính một lần; công thức và ngày hiệu lực phải rõ
- `M07-01-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Chuyến mở khóa hoặc điều chỉnh sau chốt kỳ phải đi qua kỳ điều chỉnh, không sửa âm thầm **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M07-01-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 7.2 — Lịch chấm công theo loại ngày

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 3 M7.3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module7.docx` §7.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Lịch chấm công theo loại ngày.
- **Roles stated by source:** Kế toán hoặc nhân sự nhập; quản lý duyệt ngoại lệ; lái xe xem
- **Business need / visible outcome:** Kế toán hoặc nhân sự nhập; quản lý duyệt ngoại lệ; lái xe xem cần lịch chấm công theo loại ngày. Kết quả mong muốn: lịch tháng thể hiện rõ từng loại ngày và tổng ngày theo quy định tính lương
- **Required data:** lái xe, ngày, loại ngày chuyến, chờ việc, sửa xe, nghỉ riêng và ghi chú
- **Core rule:** Mỗi lái xe mỗi ngày có một trạng thái chính; ngày có chuyến được đối chiếu tự động với dữ liệu chuyến
- **Displayed/saved result:** Lịch tháng thể hiện rõ từng loại ngày và tổng ngày theo quy định tính lương
- **Exception:** Xung đột giữa ngày chuyến và nghỉ phải cảnh báo; sửa sau chốt cần phê duyệt
- **Boundary cases:** Chuyến qua đêm; nửa ngày; nhiều chuyến trong một ngày
- **Section summary:** Mỗi lái xe mỗi ngày có một trạng thái chính; ngày có chuyến được đối chiếu tự động với dữ liệu chuyến
- **Source:** `docs/prd/Module7.docx` §7.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M07-02-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ lái xe, ngày, loại ngày chuyến, chờ việc, sửa xe, nghỉ riêng và ghi chú và hoàn tất thao tác. **Expected:** Lịch tháng thể hiện rõ từng loại ngày và tổng ngày theo quy định tính lương
- `M07-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M07-02-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Xung đột giữa ngày chuyến và nghỉ phải cảnh báo; sửa sau chốt cần phê duyệt **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M07-02-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M07-02-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra chuyến qua đêm; nửa ngày; nhiều chuyến trong một ngày. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 7.3 — Chốt kỳ lương và hạch toán chi phí nhân công

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 3 M7.3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module7.docx` §7.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Chốt kỳ lương và hạch toán chi phí nhân công.
- **Roles stated by source:** Kế toán lập; quản lý hoặc người được ủy quyền chốt
- **Business need / visible outcome:** Kế toán lập; quản lý hoặc người được ủy quyền chốt cần chốt kỳ lương và hạch toán chi phí nhân công. Kết quả mong muốn: lưu bảng lương tại thời điểm chốt, tổng chi phí nhân công và nhật ký người chốt
- **Required data:** kỳ lương, danh sách lái xe, tổng thu nhập, khấu trừ, thực lĩnh và xác nhận
- **Core rule:** Chỉ chốt khi không còn dữ liệu thiếu hoặc xung đột; hạch toán một lần và khóa kỳ
- **Displayed/saved result:** Lưu bảng lương tại thời điểm chốt, tổng chi phí nhân công và nhật ký người chốt
- **Exception:** Nếu cần sửa phải mở kỳ có kiểm soát hoặc lập điều chỉnh; không tạo bút toán trùng
- **Boundary cases:** Hai người chốt cùng lúc; lái xe chưa có tài khoản nhận; tổng thực lĩnh âm
- **Section summary:** Chỉ chốt khi không còn dữ liệu thiếu hoặc xung đột; hạch toán một lần và khóa kỳ
- **Source:** `docs/prd/Module7.docx` §7.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M07-03-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ kỳ lương, danh sách lái xe, tổng thu nhập, khấu trừ, thực lĩnh và xác nhận và hoàn tất thao tác. **Expected:** Lưu bảng lương tại thời điểm chốt, tổng chi phí nhân công và nhật ký người chốt
- `M07-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M07-03-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Nếu cần sửa phải mở kỳ có kiểm soát hoặc lập điều chỉnh; không tạo bút toán trùng **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M07-03-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M07-03-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra hai người chốt cùng lúc; lái xe chưa có tài khoản nhận; tổng thực lĩnh âm. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 7.4 — Quản lý kỷ luật và khấu trừ khoản phạt

- **Delivery:** `implemented` — ROADMAP.md §Current coverage + Wave 3 M7.3 checked item.
- **Authority:** `pending decision` — `docs/prd/Module7.docx` §7.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Quản lý kỷ luật và khấu trừ khoản phạt.
- **Roles stated by source:** Kế toán nhập; quản lý phê duyệt theo ngưỡng; lái xe được xem và phản hồi
- **Business need / visible outcome:** Kế toán nhập; quản lý phê duyệt theo ngưỡng; lái xe được xem và phản hồi cần quản lý kỷ luật và khấu trừ khoản phạt. Kết quả mong muốn: phiếu lương hiển thị khoản phạt, lý do, ngày và số tiền; báo cáo có lịch sử xử lý
- **Required data:** lái xe, ngày vi phạm, lý do, số tiền, chứng cứ, người lập và trạng thái
- **Core rule:** Khoản phạt được trừ vào lương nhưng theo dõi riêng, không làm giảm chi phí lương đã ghi nhận
- **Displayed/saved result:** Phiếu lương hiển thị khoản phạt, lý do, ngày và số tiền; báo cáo có lịch sử xử lý
- **Exception:** Phạt trùng cùng sự việc phải cảnh báo; hủy phạt dùng bản ghi hoàn tác hoặc trạng thái hủy
- **Boundary cases:** Phạt lớn hơn thực lĩnh; phạt sau khi chốt kỳ; lái xe khiếu nại
- **Section summary:** Khoản phạt được trừ vào lương nhưng theo dõi riêng, không làm giảm chi phí lương đã ghi nhận
- **Source:** `docs/prd/Module7.docx` §7.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M07-04-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ lái xe, ngày vi phạm, lý do, số tiền, chứng cứ, người lập và trạng thái và hoàn tất thao tác. **Expected:** Phiếu lương hiển thị khoản phạt, lý do, ngày và số tiền; báo cáo có lịch sử xử lý
- `M07-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M07-04-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Phạt trùng cùng sự việc phải cảnh báo; hủy phạt dùng bản ghi hoàn tác hoặc trạng thái hủy **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M07-04-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M07-04-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra phạt lớn hơn thực lĩnh; phạt sau khi chốt kỳ; lái xe khiếu nại. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M7 module-wide acceptance criteria

- `M07-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module7.docx` §5.
- `M07-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 7 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module7.docx` §5.

# M8 — PHÂN HỆ 8 — ỨNG DỤNG DÀNH CHO LÁI XE

## 8.1 — Giao diện dễ đọc và dễ thao tác trên điện thoại

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked UX pass; target device matrix remains open.
- **Authority:** `pending decision` — `docs/prd/Module8.docx` §8.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Giao diện dễ đọc và dễ thao tác trên điện thoại.
- **Roles stated by source:** Lái xe; người quản trị chỉ cấu hình nội dung
- **Business need / visible outcome:** Lái xe; người quản trị chỉ cấu hình nội dung cần giao diện dễ đọc và dễ thao tác trên điện thoại. Kết quả mong muốn: các màn hình lệnh, tiến độ, chi phí và phiếu lương hiển thị đầy đủ trên điện thoại phổ biến
- **Required data:** kích thước màn hình, cỡ chữ, nút thao tác, độ tương phản và ngôn ngữ
- **Core rule:** Tác vụ chính dùng được bằng một tay, chữ và nút đủ lớn, không cần phóng to thủ công
- **Displayed/saved result:** Các màn hình lệnh, tiến độ, chi phí và phiếu lương hiển thị đầy đủ trên điện thoại phổ biến
- **Exception:** Khi xoay màn hình hoặc tăng cỡ chữ, nội dung không bị che và nút chính vẫn dùng được
- **Boundary cases:** Màn hình nhỏ; mạng chậm; chế độ chữ lớn của hệ điều hành
- **Section summary:** Tác vụ chính dùng được bằng một tay, chữ và nút đủ lớn, không cần phóng to thủ công
- **Source:** `docs/prd/Module8.docx` §8.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M08-01-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm kích thước màn hình, cỡ chữ, nút thao tác, độ tương phản và ngôn ngữ. **Expected:** Các màn hình lệnh, tiến độ, chi phí và phiếu lương hiển thị đầy đủ trên điện thoại phổ biến
- `M08-01-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M08-01-03` **Trường hợp biên:** Kiểm tra: Màn hình nhỏ; mạng chậm; chế độ chữ lớn của hệ điều hành **Expected:** Kết quả tuân thủ quy tắc: Tác vụ chính dùng được bằng một tay, chữ và nút đủ lớn, không cần phóng to thủ công
- `M08-01-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M08-01-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 8.2 — Nhận lệnh điều động và chứng từ hướng dẫn trực tiếp

- **Delivery:** `implemented` — ROADMAP.md §Current coverage / existing driver portal.
- **Authority:** `pending decision` — `docs/prd/Module8.docx` §8.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Nhận lệnh điều động và chứng từ hướng dẫn trực tiếp.
- **Roles stated by source:** Lái xe chỉ xem lệnh của mình; điều vận gửi và cập nhật
- **Business need / visible outcome:** Lái xe chỉ xem lệnh của mình; điều vận gửi và cập nhật cần nhận lệnh điều động và chứng từ hướng dẫn trực tiếp. Kết quả mong muốn: lái xe xem được thông tin cần thiết mà không phải nhận lại qua kênh ngoài hệ thống
- **Required data:** chuyến, thời gian, tuyến, điểm giao nhận, liên hệ, hướng dẫn đóng trạm và chứng từ
- **Core rule:** Lệnh mới hoặc thay đổi phải có thông báo; lệnh cũ vẫn lưu lịch sử; dữ liệu nhạy cảm chỉ hiện cho đúng lái xe
- **Displayed/saved result:** Lái xe xem được thông tin cần thiết mà không phải nhận lại qua kênh ngoài hệ thống
- **Exception:** Nếu lệnh bị thu hồi hoặc đổi xe, ứng dụng phải nêu rõ và không để lái xe tiếp tục cập nhật nhầm
- **Boundary cases:** Lệnh cập nhật khi đang mất mạng; tài liệu nhiều trang; đổi giờ gấp
- **Section summary:** Lệnh mới hoặc thay đổi phải có thông báo; lệnh cũ vẫn lưu lịch sử; dữ liệu nhạy cảm chỉ hiện cho đúng lái xe
- **Source:** `docs/prd/Module8.docx` §8.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M08-02-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm chuyến, thời gian, tuyến, điểm giao nhận, liên hệ, hướng dẫn đóng trạm và chứng từ. **Expected:** Lái xe xem được thông tin cần thiết mà không phải nhận lại qua kênh ngoài hệ thống
- `M08-02-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M08-02-03` **Trường hợp biên:** Kiểm tra: Lệnh cập nhật khi đang mất mạng; tài liệu nhiều trang; đổi giờ gấp **Expected:** Kết quả tuân thủ quy tắc: Lệnh mới hoặc thay đổi phải có thông báo; lệnh cũ vẫn lưu lịch sử; dữ liệu nhạy cảm chỉ hiện cho đúng lái xe
- `M08-02-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M08-02-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 8.3 — Hiển thị hai lệnh điều động trong ngày

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; late threshold remains an assumption.
- **Authority:** `pending decision` — `docs/prd/Module8.docx` §8.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Hiển thị hai lệnh điều động trong ngày.
- **Roles stated by source:** Lái xe xem; điều vận sắp thứ tự
- **Business need / visible outcome:** Lái xe xem; điều vận sắp thứ tự cần hiển thị hai lệnh điều động trong ngày. Kết quả mong muốn: lái xe thấy thứ tự, thời gian dự kiến và cảnh báo khi lệnh đầu bị trễ
- **Required data:** hai lệnh được ghép, thời gian, địa điểm nối tiếp, ưu tiên và trạng thái
- **Core rule:** Hiển thị rõ lệnh đang thực hiện và lệnh kế tiếp; không trộn chứng từ hoặc chi phí giữa hai lệnh
- **Displayed/saved result:** Lái xe thấy thứ tự, thời gian dự kiến và cảnh báo khi lệnh đầu bị trễ
- **Exception:** Nếu một lệnh bị hủy, lệnh còn lại vẫn giữ đúng dữ liệu và được thông báo ngay
- **Boundary cases:** Hai lệnh qua ngày; cùng điểm nhận; lệnh thứ hai đổi xe
- **Section summary:** Hiển thị rõ lệnh đang thực hiện và lệnh kế tiếp; không trộn chứng từ hoặc chi phí giữa hai lệnh
- **Source:** `docs/prd/Module8.docx` §8.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M08-03-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm hai lệnh được ghép, thời gian, địa điểm nối tiếp, ưu tiên và trạng thái. **Expected:** Lái xe thấy thứ tự, thời gian dự kiến và cảnh báo khi lệnh đầu bị trễ
- `M08-03-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M08-03-03` **Trường hợp biên:** Kiểm tra: Hai lệnh qua ngày; cùng điểm nhận; lệnh thứ hai đổi xe **Expected:** Kết quả tuân thủ quy tắc: Hiển thị rõ lệnh đang thực hiện và lệnh kế tiếp; không trộn chứng từ hoặc chi phí giữa hai lệnh
- `M08-03-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M08-03-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 8.4 — Cập nhật tiến độ và chi phí phát sinh

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; completion evidence remains advisory.
- **Authority:** `pending decision` — `docs/prd/Module8.docx` §8.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Cập nhật tiến độ và chi phí phát sinh.
- **Roles stated by source:** Lái xe cập nhật chuyến của mình; kế toán kiểm tra chi phí
- **Business need / visible outcome:** Lái xe cập nhật chuyến của mình; kế toán kiểm tra chi phí cần cập nhật tiến độ và chi phí phát sinh. Kết quả mong muốn: điều vận nhận tiến độ kịp thời; kế toán thấy khoản chi cùng thời gian và người nhập
- **Required data:** mốc khởi hành, hoàn thành, tiền nâng hạ, công tác phí, ghi chú và ảnh
- **Core rule:** Không cho hoàn thành khi thiếu bằng chứng bắt buộc; khoản chi phải gắn đúng chuyến và trạng thái chờ kiểm tra
- **Displayed/saved result:** Điều vận nhận tiến độ kịp thời; kế toán thấy khoản chi cùng thời gian và người nhập
- **Exception:** Mất mạng phải lưu tạm an toàn và đồng bộ một lần khi có kết nối
- **Boundary cases:** Bấm hai lần; đổi chuyến đang mở; ảnh tải lên thất bại
- **Section summary:** Không cho hoàn thành khi thiếu bằng chứng bắt buộc; khoản chi phải gắn đúng chuyến và trạng thái chờ kiểm tra
- **Source:** `docs/prd/Module8.docx` §8.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M08-04-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ mốc khởi hành, hoàn thành, tiền nâng hạ, công tác phí, ghi chú và ảnh và hoàn tất thao tác. **Expected:** Điều vận nhận tiến độ kịp thời; kế toán thấy khoản chi cùng thời gian và người nhập
- `M08-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M08-04-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Mất mạng phải lưu tạm an toàn và đồng bộ một lần khi có kết nối **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M08-04-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M08-04-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra bấm hai lần; đổi chuyến đang mở; ảnh tải lên thất bại. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 8.5 — Chụp ảnh và nhận dạng mã công-te-nơ hoặc niêm phong

- **Delivery:** `implemented` — ROADMAP.md §Wave 4 reconciled existing OCR confirmation.
- **Authority:** `pending decision` — `docs/prd/Module8.docx` §8.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Chụp ảnh và nhận dạng mã công-te-nơ hoặc niêm phong.
- **Roles stated by source:** Lái xe chụp; hệ thống gợi ý; lái xe xác nhận
- **Business need / visible outcome:** Lái xe chụp; hệ thống gợi ý; lái xe xác nhận cần chụp ảnh và nhận dạng mã công-te-nơ hoặc niêm phong. Kết quả mong muốn: lưu ảnh gốc, kết quả nhận dạng, giá trị đã xác nhận và người xác nhận
- **Required data:** ảnh rõ, loại ảnh công-te-nơ hoặc niêm phong, chuyến và thời gian chụp
- **Core rule:** Kết quả tự động chỉ là gợi ý; kiểm tra định dạng; bắt buộc người dùng xác nhận hoặc sửa trước khi lưu
- **Displayed/saved result:** Lưu ảnh gốc, kết quả nhận dạng, giá trị đã xác nhận và người xác nhận
- **Exception:** Ảnh mờ hoặc có nhiều mã phải yêu cầu chụp lại hoặc chọn đúng mã, không tự lưu kết quả không chắc chắn
- **Boundary cases:** Ảnh xoay; ánh sáng yếu; nhiều công-te-nơ trong ảnh; không có mạng
- **Section summary:** Kết quả tự động chỉ là gợi ý; kiểm tra định dạng; bắt buộc người dùng xác nhận hoặc sửa trước khi lưu
- **Source:** `docs/prd/Module8.docx` §8.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M08-05-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ ảnh rõ, loại ảnh công-te-nơ hoặc niêm phong, chuyến và thời gian chụp và hoàn tất thao tác. **Expected:** Lưu ảnh gốc, kết quả nhận dạng, giá trị đã xác nhận và người xác nhận
- `M08-05-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M08-05-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Ảnh mờ hoặc có nhiều mã phải yêu cầu chụp lại hoặc chọn đúng mã, không tự lưu kết quả không chắc chắn **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M08-05-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M08-05-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra ảnh xoay; ánh sáng yếu; nhiều công-te-nơ trong ảnh; không có mạng. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 8.6 — Xem phiếu lương, thu nhập và khoản phạt cá nhân

- **Delivery:** `implemented` — ROADMAP.md §Wave 4 checked item.
- **Authority:** `pending decision` — `docs/prd/Module8.docx` §8.6, customer-response and conclusion cells blank.
- **Intended page/workflow:** Xem phiếu lương, thu nhập và khoản phạt cá nhân.
- **Roles stated by source:** Lái xe chỉ xem dữ liệu của mình; kế toán phát hành
- **Business need / visible outcome:** Lái xe chỉ xem dữ liệu của mình; kế toán phát hành cần xem phiếu lương, thu nhập và khoản phạt cá nhân. Kết quả mong muốn: phiếu lương có tổng rõ ràng, lịch sử các kỳ và trạng thái đã xem
- **Required data:** kỳ lương, lương cơ bản, lương chuyến, phụ cấp, khoản phạt và thực lĩnh
- **Core rule:** Chỉ hiển thị kỳ đã phát hành; không cho xem dữ liệu người khác; mỗi dòng liên kết được tới căn cứ
- **Displayed/saved result:** Phiếu lương có tổng rõ ràng, lịch sử các kỳ và trạng thái đã xem
- **Exception:** Kỳ bị điều chỉnh phải hiển thị phiên bản mới và lý do, vẫn giữ lịch sử bản cũ
- **Boundary cases:** Lái xe nghỉ việc; kỳ không phát sinh chuyến; thực lĩnh bằng không
- **Section summary:** Chỉ hiển thị kỳ đã phát hành; không cho xem dữ liệu người khác; mỗi dòng liên kết được tới căn cứ
- **Source:** `docs/prd/Module8.docx` §8.6, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M08-06-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm kỳ lương, lương cơ bản, lương chuyến, phụ cấp, khoản phạt và thực lĩnh. **Expected:** Phiếu lương có tổng rõ ràng, lịch sử các kỳ và trạng thái đã xem
- `M08-06-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M08-06-03` **Trường hợp biên:** Kiểm tra: Lái xe nghỉ việc; kỳ không phát sinh chuyến; thực lĩnh bằng không **Expected:** Kết quả tuân thủ quy tắc: Chỉ hiển thị kỳ đã phát hành; không cho xem dữ liệu người khác; mỗi dòng liên kết được tới căn cứ
- `M08-06-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M08-06-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## M8 module-wide acceptance criteria

- `M08-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module8.docx` §5.
- `M08-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 8 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module8.docx` §5.

# M9 — PHÂN HỆ 9 — ỨNG DỤNG DÀNH CHO NHÂN VIÊN HIỆN TRƯỜNG

## 9.1 — Thực hiện tạm ứng và khoản chi hộ trên điện thoại

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (M9 largely done); visual polish still requires QA.
- **Authority:** `pending decision` — `docs/prd/Module9.docx` §9.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Thực hiện tạm ứng và khoản chi hộ trên điện thoại.
- **Roles stated by source:** Nhân viên hiện trường lập; kế toán duyệt và thanh toán
- **Business need / visible outcome:** Nhân viên hiện trường lập; kế toán duyệt và thanh toán cần thực hiện tạm ứng và khoản chi hộ trên điện thoại. Kết quả mong muốn: nhân viên theo dõi được trạng thái yêu cầu, số đã nhận, đã chi và số cần quyết toán
- **Required data:** người đề nghị, nhiệm vụ, lô, số tiền, mục đích, ngày cần và tài khoản nhận
- **Core rule:** Yêu cầu tạm ứng và khoản chi thực tế phải liên kết để tính số còn dư hoặc cần hoàn thêm
- **Displayed/saved result:** Nhân viên theo dõi được trạng thái yêu cầu, số đã nhận, đã chi và số cần quyết toán
- **Exception:** Không cho yêu cầu mới khi còn khoản quá hạn theo chính sách, trừ khi được phê duyệt ngoại lệ
- **Boundary cases:** Nhiều tạm ứng cho một lô; hoàn tiền thừa; yêu cầu ngoài giờ
- **Section summary:** Yêu cầu tạm ứng và khoản chi thực tế phải liên kết để tính số còn dư hoặc cần hoàn thêm
- **Source:** `docs/prd/Module9.docx` §9.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M09-01-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ người đề nghị, nhiệm vụ, lô, số tiền, mục đích, ngày cần và tài khoản nhận và hoàn tất thao tác. **Expected:** Nhân viên theo dõi được trạng thái yêu cầu, số đã nhận, đã chi và số cần quyết toán
- `M09-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M09-01-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Không cho yêu cầu mới khi còn khoản quá hạn theo chính sách, trừ khi được phê duyệt ngoại lệ **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M09-01-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M09-01-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra nhiều tạm ứng cho một lô; hoàn tiền thừa; yêu cầu ngoài giờ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 9.2 — Chọn lô và ghi khoản chi ở trạng thái chờ

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (M9 largely done); visual polish still requires QA.
- **Authority:** `pending decision` — `docs/prd/Module9.docx` §9.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Chọn lô và ghi khoản chi ở trạng thái chờ.
- **Roles stated by source:** Nhân viên hiện trường chỉ ghi khoản của mình
- **Business need / visible outcome:** Nhân viên hiện trường chỉ ghi khoản của mình cần chọn lô và ghi khoản chi ở trạng thái chờ. Kết quả mong muốn: danh sách thể hiện khoản đã nhập, trạng thái và số tiền theo lô
- **Required data:** mã lô, công-te-nơ, hạng mục, số tiền, ngày, hình thức chi và ghi chú
- **Core rule:** Chỉ chọn lô đang hoạt động và thuộc phạm vi được giao; khoản mới luôn chờ kế toán duyệt
- **Displayed/saved result:** Danh sách thể hiện khoản đã nhập, trạng thái và số tiền theo lô
- **Exception:** Nếu chọn nhầm lô, chỉ được sửa trước khi duyệt và phải lưu lịch sử thay đổi
- **Boundary cases:** Lô nhiều công-te-nơ; chi phí chung; hai khoản cùng loại hợp lệ
- **Section summary:** Chỉ chọn lô đang hoạt động và thuộc phạm vi được giao; khoản mới luôn chờ kế toán duyệt
- **Source:** `docs/prd/Module9.docx` §9.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M09-02-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ mã lô, công-te-nơ, hạng mục, số tiền, ngày, hình thức chi và ghi chú và hoàn tất thao tác. **Expected:** Danh sách thể hiện khoản đã nhập, trạng thái và số tiền theo lô
- `M09-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M09-02-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Nếu chọn nhầm lô, chỉ được sửa trước khi duyệt và phải lưu lịch sử thay đổi **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M09-02-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M09-02-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra lô nhiều công-te-nơ; chi phí chung; hai khoản cùng loại hợp lệ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 9.3 — Gợi ý đơn giá nâng hạ theo cảng

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (M9 largely done); visual polish still requires QA.
- **Authority:** `pending decision` — `docs/prd/Module9.docx` §9.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Gợi ý đơn giá nâng hạ theo cảng.
- **Roles stated by source:** Nhân viên hiện trường sử dụng; kế toán quản lý biểu giá
- **Business need / visible outcome:** Nhân viên hiện trường sử dụng; kế toán quản lý biểu giá cần gợi ý đơn giá nâng hạ theo cảng. Kết quả mong muốn: hiển thị giá gợi ý, giá nhập, chênh lệch và căn cứ biểu giá
- **Required data:** cảng, loại công-te-nơ, chiều nâng hoặc hạ, ngày và biểu giá có hiệu lực
- **Core rule:** Hệ thống gợi ý đúng giá; người dùng được sửa giá thực tế nhưng phải nêu lý do
- **Displayed/saved result:** Hiển thị giá gợi ý, giá nhập, chênh lệch và căn cứ biểu giá
- **Exception:** Không có biểu giá thì yêu cầu nhập tay và đánh dấu cần kế toán kiểm tra
- **Boundary cases:** Giá đổi trong ngày; công-te-nơ đặc biệt; cùng lô nhiều cảng
- **Section summary:** Hệ thống gợi ý đúng giá; người dùng được sửa giá thực tế nhưng phải nêu lý do
- **Source:** `docs/prd/Module9.docx` §9.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M09-03-01` **Tính toán thông thường:** Nhập đầy đủ cảng, loại công-te-nơ, chiều nâng hoặc hạ, ngày và biểu giá có hiệu lực. **Expected:** Hiển thị giá gợi ý, giá nhập, chênh lệch và căn cứ biểu giá
- `M09-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M09-03-03` **Giá trị biên:** Kiểm tra: Giá đổi trong ngày; công-te-nơ đặc biệt; cùng lô nhiều cảng **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Hệ thống gợi ý đúng giá; người dùng được sửa giá thực tế nhưng phải nêu lý do
- `M09-03-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Không có biểu giá thì yêu cầu nhập tay và đánh dấu cần kế toán kiểm tra **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M09-03-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 9.4 — Gom khoản chi của nhiều nhân viên theo lô

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (M9 largely done); visual polish still requires QA.
- **Authority:** `pending decision` — `docs/prd/Module9.docx` §9.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Gom khoản chi của nhiều nhân viên theo lô.
- **Roles stated by source:** Nhân viên xem khoản của mình; kế toán và CUS xem toàn lô
- **Business need / visible outcome:** Nhân viên xem khoản của mình; kế toán và CUS xem toàn lô cần gom khoản chi của nhiều nhân viên theo lô. Kết quả mong muốn: tổng theo hạng mục và trạng thái khớp tổng các dòng chi tiết
- **Required data:** mã lô, công-te-nơ, người chi, hạng mục, số tiền và trạng thái
- **Core rule:** Tổng hợp theo lô nhưng giữ từng dòng và quyền riêng; không làm một người sửa khoản của người khác
- **Displayed/saved result:** Tổng theo hạng mục và trạng thái khớp tổng các dòng chi tiết
- **Exception:** Khoản chuyển lô hoặc bị từ chối phải cập nhật tổng ngay và giữ lịch sử
- **Boundary cases:** Nhiều người gửi cùng lúc; khoản chi chung; hoàn lại một phần
- **Section summary:** Tổng hợp theo lô nhưng giữ từng dòng và quyền riêng; không làm một người sửa khoản của người khác
- **Source:** `docs/prd/Module9.docx` §9.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M09-04-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm mã lô, công-te-nơ, người chi, hạng mục, số tiền và trạng thái. **Expected:** Tổng theo hạng mục và trạng thái khớp tổng các dòng chi tiết
- `M09-04-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M09-04-03` **Trường hợp biên:** Kiểm tra: Nhiều người gửi cùng lúc; khoản chi chung; hoàn lại một phần **Expected:** Kết quả tuân thủ quy tắc: Tổng hợp theo lô nhưng giữ từng dòng và quyền riêng; không làm một người sửa khoản của người khác
- `M09-04-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M09-04-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 9.5 — Tải ảnh chứng từ tại cảng

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (M9 largely done); visual polish still requires QA.
- **Authority:** `pending decision` — `docs/prd/Module9.docx` §9.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tải ảnh chứng từ tại cảng.
- **Roles stated by source:** Nhân viên hiện trường tải; kế toán kiểm tra
- **Business need / visible outcome:** Nhân viên hiện trường tải; kế toán kiểm tra cần tải ảnh chứng từ tại cảng. Kết quả mong muốn: xem trước ảnh, trạng thái tải lên và thời điểm; kế toán mở được bản gốc
- **Required data:** ảnh rõ, loại chứng từ, số tiền, ngày, lô và khoản chi liên quan
- **Core rule:** Ảnh phải gắn đúng khoản chi; cho phép nhiều trang; kiểm tra loại tệp và dung lượng
- **Displayed/saved result:** Xem trước ảnh, trạng thái tải lên và thời điểm; kế toán mở được bản gốc
- **Exception:** Tải thất bại không được đánh dấu đã có chứng từ; cho phép thử lại mà không tạo khoản chi trùng
- **Boundary cases:** Mạng yếu; ảnh trùng; ảnh xoay; hóa đơn nhiều trang
- **Section summary:** Ảnh phải gắn đúng khoản chi; cho phép nhiều trang; kiểm tra loại tệp và dung lượng
- **Source:** `docs/prd/Module9.docx` §9.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M09-05-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ ảnh rõ, loại chứng từ, số tiền, ngày, lô và khoản chi liên quan và hoàn tất thao tác. **Expected:** Xem trước ảnh, trạng thái tải lên và thời điểm; kế toán mở được bản gốc
- `M09-05-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M09-05-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Tải thất bại không được đánh dấu đã có chứng từ; cho phép thử lại mà không tạo khoản chi trùng **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M09-05-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M09-05-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra mạng yếu; ảnh trùng; ảnh xoay; hóa đơn nhiều trang. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M9 module-wide acceptance criteria

- `M09-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module9.docx` §5.
- `M09-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 9 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module9.docx` §5.

# M10 — PHÂN HỆ 10 — ỨNG DỤNG DÀNH CHO NHÂN VIÊN CHỨNG TỪ

## 10.1 — Tạo nhanh lô hàng ngoài giờ trên điện thoại

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; minimum quick-draft dataset remains open.
- **Authority:** `pending decision` — `docs/prd/Module10.docx` §10.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tạo nhanh lô hàng ngoài giờ trên điện thoại.
- **Roles stated by source:** CUS hoặc nhân viên chứng từ được phân quyền
- **Business need / visible outcome:** CUS hoặc nhân viên chứng từ được phân quyền cần tạo nhanh lô hàng ngoài giờ trên điện thoại. Kết quả mong muốn: lô mới hiển thị ngay trong danh sách của người tạo và điều vận theo trạng thái phù hợp
- **Required data:** khách hàng, mã tham chiếu, ngày giao, điểm nhận, điểm giao và người liên hệ
- **Core rule:** Cho phép lưu nháp với dữ liệu tối thiểu; mã lô phải duy nhất; ghi rõ người và thời điểm tạo
- **Displayed/saved result:** Lô mới hiển thị ngay trong danh sách của người tạo và điều vận theo trạng thái phù hợp
- **Exception:** Mất kết nối phải báo rõ chưa lưu; gửi lại không tạo hai lô giống nhau
- **Boundary cases:** Tạo lúc qua ngày; nhiều lô liên tiếp; khách hàng chưa có trong danh mục
- **Section summary:** Cho phép lưu nháp với dữ liệu tối thiểu; mã lô phải duy nhất; ghi rõ người và thời điểm tạo
- **Source:** `docs/prd/Module10.docx` §10.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M10-01-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ khách hàng, mã tham chiếu, ngày giao, điểm nhận, điểm giao và người liên hệ và hoàn tất thao tác. **Expected:** Lô mới hiển thị ngay trong danh sách của người tạo và điều vận theo trạng thái phù hợp
- `M10-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M10-01-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Mất kết nối phải báo rõ chưa lưu; gửi lại không tạo hai lô giống nhau **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M10-01-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M10-01-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra tạo lúc qua ngày; nhiều lô liên tiếp; khách hàng chưa có trong danh mục. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 10.2 — Nhập vận đơn, công-te-nơ, tờ khai và thông tin giao nhận

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; dispatch-readiness is advisory pending Q17.
- **Authority:** `pending decision` — `docs/prd/Module10.docx` §10.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Nhập vận đơn, công-te-nơ, tờ khai và thông tin giao nhận.
- **Roles stated by source:** CUS hoặc nhân viên chứng từ; người khác chỉ xem theo quyền
- **Business need / visible outcome:** CUS hoặc nhân viên chứng từ; người khác chỉ xem theo quyền cần nhập vận đơn, công-te-nơ, tờ khai và thông tin giao nhận. Kết quả mong muốn: hồ sơ trình bày rõ từng công-te-nơ và chứng từ, tìm kiếm được theo các số tham chiếu
- **Required data:** số vận đơn, số công-te-nơ, số niêm phong, tờ khai, ngày giao và địa điểm
- **Core rule:** Kiểm tra định dạng và dữ liệu trùng; cho phép nhiều công-te-nơ; xác định trường bắt buộc trước khi điều xe
- **Displayed/saved result:** Hồ sơ trình bày rõ từng công-te-nơ và chứng từ, tìm kiếm được theo các số tham chiếu
- **Exception:** Dữ liệu không hợp lệ phải chỉ rõ lỗi; ngoại lệ cần người có quyền xác nhận và ghi lý do
- **Boundary cases:** Một tờ khai nhiều công-te-nơ; lệnh giao hàng hết hạn; thay chứng từ
- **Section summary:** Kiểm tra định dạng và dữ liệu trùng; cho phép nhiều công-te-nơ; xác định trường bắt buộc trước khi điều xe
- **Source:** `docs/prd/Module10.docx` §10.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M10-02-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ số vận đơn, số công-te-nơ, số niêm phong, tờ khai, ngày giao và địa điểm và hoàn tất thao tác. **Expected:** Hồ sơ trình bày rõ từng công-te-nơ và chứng từ, tìm kiếm được theo các số tham chiếu
- `M10-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M10-02-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Dữ liệu không hợp lệ phải chỉ rõ lỗi; ngoại lệ cần người có quyền xác nhận và ghi lý do **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M10-02-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M10-02-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra một tờ khai nhiều công-te-nơ; lệnh giao hàng hết hạn; thay chứng từ. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## 10.3 — Chuyển dữ liệu ngay cho điều vận

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; single-accept semantics remains open.
- **Authority:** `pending decision` — `docs/prd/Module10.docx` §10.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Chuyển dữ liệu ngay cho điều vận.
- **Roles stated by source:** Nhân viên chứng từ gửi; điều vận tiếp nhận và xác nhận đã xem
- **Business need / visible outcome:** Nhân viên chứng từ gửi; điều vận tiếp nhận và xác nhận đã xem cần chuyển dữ liệu ngay cho điều vận. Kết quả mong muốn: hiển thị trạng thái Chưa xem, Đã xem, Đã tiếp nhận và người xử lý
- **Required data:** lô đủ điều kiện, mức ưu tiên, thời gian cần xe và ghi chú vận hành
- **Core rule:** Sau khi gửi, điều vận nhận thông báo và thấy đúng phiên bản dữ liệu; thay đổi quan trọng phải gửi thông báo mới
- **Displayed/saved result:** Hiển thị trạng thái Chưa xem, Đã xem, Đã tiếp nhận và người xử lý
- **Exception:** Nếu dữ liệu bị sửa trong lúc điều vận đang xem, phải cảnh báo có phiên bản mới
- **Boundary cases:** Gửi ngoài giờ; nhiều điều vận viên; thu hồi lô trước khi gán xe
- **Section summary:** Sau khi gửi, điều vận nhận thông báo và thấy đúng phiên bản dữ liệu; thay đổi quan trọng phải gửi thông báo mới
- **Source:** `docs/prd/Module10.docx` §10.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M10-03-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ lô đủ điều kiện, mức ưu tiên, thời gian cần xe và ghi chú vận hành và hoàn tất thao tác. **Expected:** Hiển thị trạng thái Chưa xem, Đã xem, Đã tiếp nhận và người xử lý
- `M10-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M10-03-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Nếu dữ liệu bị sửa trong lúc điều vận đang xem, phải cảnh báo có phiên bản mới **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M10-03-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M10-03-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra gửi ngoài giờ; nhiều điều vận viên; thu hồi lô trước khi gán xe. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M10 module-wide acceptance criteria

- `M10-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module10.docx` §5.
- `M10-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 10 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module10.docx` §5.

# M11 — PHÂN HỆ 11 — BÁO CÁO TÀI CHÍNH VÀ LÃI LỖ

## 11.1 — Báo cáo lãi lỗ tổng thể theo kỳ

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (11.1 done).
- **Authority:** `pending decision` — `docs/prd/Module11.docx` §11.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Báo cáo lãi lỗ tổng thể theo kỳ.
- **Roles stated by source:** Giám đốc và kế toán
- **Business need / visible outcome:** Giám đốc và kế toán cần báo cáo lãi lỗ tổng thể theo kỳ. Kết quả mong muốn: hiển thị doanh thu, từng nhóm chi phí, lợi nhuận gộp, lợi nhuận ròng và tỷ lệ
- **Required data:** kỳ tuần, tháng hoặc quý; doanh thu; chi phí trực tiếp; chi phí chung; thu nhập khác
- **Core rule:** Phân biệt số tạm tính và số đã chốt; công thức tổng thể phải thống nhất với sổ chi tiết
- **Displayed/saved result:** Hiển thị doanh thu, từng nhóm chi phí, lợi nhuận gộp, lợi nhuận ròng và tỷ lệ
- **Exception:** Kỳ chưa chốt phải có cảnh báo; chuyến hủy và bút toán hoàn tác không được tính sai
- **Boundary cases:** Kỳ cắt giữa tháng; điều chỉnh hồi tố; số âm hoặc bằng không
- **Section summary:** Phân biệt số tạm tính và số đã chốt; công thức tổng thể phải thống nhất với sổ chi tiết
- **Source:** `docs/prd/Module11.docx` §11.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M11-01-01` **Tính toán thông thường:** Nhập đầy đủ kỳ tuần, tháng hoặc quý; doanh thu; chi phí trực tiếp; chi phí chung; thu nhập khác. **Expected:** Hiển thị doanh thu, từng nhóm chi phí, lợi nhuận gộp, lợi nhuận ròng và tỷ lệ
- `M11-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M11-01-03` **Giá trị biên:** Kiểm tra: Kỳ cắt giữa tháng; điều chỉnh hồi tố; số âm hoặc bằng không **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Phân biệt số tạm tính và số đã chốt; công thức tổng thể phải thống nhất với sổ chi tiết
- `M11-01-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Kỳ chưa chốt phải có cảnh báo; chuyến hủy và bút toán hoàn tác không được tính sai **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M11-01-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 11.2 — Báo cáo lãi lỗ chi tiết từng đầu xe

- **Delivery:** `partial` — ROADMAP.md §Wave 4 reconciled; shared-cost allocation policy remains open.
- **Authority:** `pending decision` — `docs/prd/Module11.docx` §11.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Báo cáo lãi lỗ chi tiết từng đầu xe.
- **Roles stated by source:** Giám đốc, quản lý và kế toán
- **Business need / visible outcome:** Giám đốc, quản lý và kế toán cần báo cáo lãi lỗ chi tiết từng đầu xe. Kết quả mong muốn: báo cáo từng xe khớp tổng chuyến và nêu rõ khoản không phân bổ
- **Required data:** xe đầu kéo, kỳ, doanh thu chuyến, nhiên liệu, tiền đi đường, lương chuyến và chi phí bảo dưỡng gắn xe
- **Core rule:** Chỉ phân bổ chi phí đúng xe; chi phí rơ-moóc hoặc chi phí chung không gán tùy tiện cho một đầu xe
- **Displayed/saved result:** Báo cáo từng xe khớp tổng chuyến và nêu rõ khoản không phân bổ
- **Exception:** Xe không chạy nhưng có chi phí vẫn phải xuất hiện; dữ liệu thiếu phải được đánh dấu
- **Boundary cases:** Đổi xe giữa chuyến; chi phí bảo dưỡng qua kỳ; xe ngừng hoạt động
- **Section summary:** Chỉ phân bổ chi phí đúng xe; chi phí rơ-moóc hoặc chi phí chung không gán tùy tiện cho một đầu xe
- **Source:** `docs/prd/Module11.docx` §11.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M11-02-01` **Tính toán thông thường:** Nhập đầy đủ xe đầu kéo, kỳ, doanh thu chuyến, nhiên liệu, tiền đi đường, lương chuyến và chi phí bảo dưỡng gắn xe. **Expected:** Báo cáo từng xe khớp tổng chuyến và nêu rõ khoản không phân bổ
- `M11-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M11-02-03` **Giá trị biên:** Kiểm tra: Đổi xe giữa chuyến; chi phí bảo dưỡng qua kỳ; xe ngừng hoạt động **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Chỉ phân bổ chi phí đúng xe; chi phí rơ-moóc hoặc chi phí chung không gán tùy tiện cho một đầu xe
- `M11-02-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Xe không chạy nhưng có chi phí vẫn phải xuất hiện; dữ liệu thiếu phải được đánh dấu **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M11-02-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 11.3 — Báo cáo tạm ứng và hoàn ứng theo nhân sự

- **Delivery:** `implemented` — ROADMAP.md §Current coverage / existing advance-return reporting.
- **Authority:** `pending decision` — `docs/prd/Module11.docx` §11.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Báo cáo tạm ứng và hoàn ứng theo nhân sự.
- **Roles stated by source:** Kế toán và giám đốc; từng nhân sự chỉ xem dữ liệu của mình
- **Business need / visible outcome:** Kế toán và giám đốc; từng nhân sự chỉ xem dữ liệu của mình cần báo cáo tạm ứng và hoàn ứng theo nhân sự. Kết quả mong muốn: hiển thị từng phiếu, lô liên quan, trạng thái và tổng theo nhân sự
- **Required data:** số dư đầu kỳ, tiền tạm ứng, chi phí được duyệt, tiền hoàn, tiền bổ sung và số dư cuối kỳ
- **Core rule:** Số dư cuối kỳ bằng đầu kỳ cộng tạm ứng trừ chi phí được duyệt trừ tiền hoàn theo quy ước dấu đã chốt
- **Displayed/saved result:** Hiển thị từng phiếu, lô liên quan, trạng thái và tổng theo nhân sự
- **Exception:** Khoản bị từ chối không được tính chi phí; phiếu qua kỳ phải chuyển số dư chính xác
- **Boundary cases:** Một nhân sự nhiều phiếu; hoàn một phần; nghỉ việc còn số dư
- **Section summary:** Số dư cuối kỳ bằng đầu kỳ cộng tạm ứng trừ chi phí được duyệt trừ tiền hoàn theo quy ước dấu đã chốt
- **Source:** `docs/prd/Module11.docx` §11.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M11-03-01` **Tính toán thông thường:** Nhập đầy đủ số dư đầu kỳ, tiền tạm ứng, chi phí được duyệt, tiền hoàn, tiền bổ sung và số dư cuối kỳ. **Expected:** Hiển thị từng phiếu, lô liên quan, trạng thái và tổng theo nhân sự
- `M11-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M11-03-03` **Giá trị biên:** Kiểm tra: Một nhân sự nhiều phiếu; hoàn một phần; nghỉ việc còn số dư **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Số dư cuối kỳ bằng đầu kỳ cộng tạm ứng trừ chi phí được duyệt trừ tiền hoàn theo quy ước dấu đã chốt
- `M11-03-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Khoản bị từ chối không được tính chi phí; phiếu qua kỳ phải chuyển số dư chính xác **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M11-03-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 11.4 — Ghi nhận ngày thanh toán để đánh giá kỳ hạn khách hàng

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; per-invoice vs customer-average decision remains open.
- **Authority:** `pending decision` — `docs/prd/Module11.docx` §11.4, customer-response and conclusion cells blank.
- **Intended page/workflow:** Ghi nhận ngày thanh toán để đánh giá kỳ hạn khách hàng.
- **Roles stated by source:** Kế toán nhập thanh toán; giám đốc và CUS xem
- **Business need / visible outcome:** Kế toán nhập thanh toán; giám đốc và CUS xem cần ghi nhận ngày thanh toán để đánh giá kỳ hạn khách hàng. Kết quả mong muốn: báo cáo thể hiện kỳ hạn thực tế, trung bình và xu hướng theo khách hàng
- **Required data:** ngày phát sinh phải thu, ngày đến hạn, ngày thanh toán và số tiền phân bổ theo chuyến hoặc lô
- **Core rule:** Đánh giá số ngày thanh toán trên phần đã trả; khoản chưa trả tính đến ngày báo cáo
- **Displayed/saved result:** Báo cáo thể hiện kỳ hạn thực tế, trung bình và xu hướng theo khách hàng
- **Exception:** Thanh toán một phần cần tính riêng từng phần; trả trước không tạo số ngày âm gây hiểu nhầm
- **Boundary cases:** Nhiều lần thanh toán; điều chỉnh ngày; thanh toán qua ngày nghỉ
- **Section summary:** Đánh giá số ngày thanh toán trên phần đã trả; khoản chưa trả tính đến ngày báo cáo
- **Source:** `docs/prd/Module11.docx` §11.4, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M11-04-01` **Tính toán thông thường:** Nhập đầy đủ ngày phát sinh phải thu, ngày đến hạn, ngày thanh toán và số tiền phân bổ theo chuyến hoặc lô. **Expected:** Báo cáo thể hiện kỳ hạn thực tế, trung bình và xu hướng theo khách hàng
- `M11-04-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M11-04-03` **Giá trị biên:** Kiểm tra: Nhiều lần thanh toán; điều chỉnh ngày; thanh toán qua ngày nghỉ **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Đánh giá số ngày thanh toán trên phần đã trả; khoản chưa trả tính đến ngày báo cáo
- `M11-04-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Thanh toán một phần cần tính riêng từng phần; trả trước không tạo số ngày âm gây hiểu nhầm **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M11-04-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 11.5 — Bảng điều hành giám đốc về dòng tiền, hàng hai chiều và hiệu quả xe

- **Delivery:** `partial` — ROADMAP.md §Wave 4 checked; exact KPI definitions remain open.
- **Authority:** `pending decision` — `docs/prd/Module11.docx` §11.5, customer-response and conclusion cells blank.
- **Intended page/workflow:** Bảng điều hành giám đốc về dòng tiền, hàng hai chiều và hiệu quả xe.
- **Roles stated by source:** Giám đốc; người khác chỉ theo quyền được giao
- **Business need / visible outcome:** Giám đốc; người khác chỉ theo quyền được giao cần bảng điều hành giám đốc về dòng tiền, hàng hai chiều và hiệu quả xe. Kết quả mong muốn: hiển thị cảnh báo nổi bật, so sánh kỳ trước và danh sách xe cần chú ý
- **Required data:** kỳ, dòng tiền vào ra, số chuyến, tỷ lệ hàng hai chiều, lợi nhuận và tình trạng xe
- **Core rule:** Mỗi chỉ số có định nghĩa, thời điểm cập nhật và đường dẫn tới số liệu nguồn
- **Displayed/saved result:** Hiển thị cảnh báo nổi bật, so sánh kỳ trước và danh sách xe cần chú ý
- **Exception:** Dữ liệu thiếu hoặc chậm cập nhật phải nêu rõ, không hiển thị như số chính thức
- **Boundary cases:** Không có chuyến; xe mới; giao dịch lớn bất thường; dữ liệu đang đồng bộ
- **Section summary:** Mỗi chỉ số có định nghĩa, thời điểm cập nhật và đường dẫn tới số liệu nguồn
- **Source:** `docs/prd/Module11.docx` §11.5, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M11-05-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm kỳ, dòng tiền vào ra, số chuyến, tỷ lệ hàng hai chiều, lợi nhuận và tình trạng xe. **Expected:** Hiển thị cảnh báo nổi bật, so sánh kỳ trước và danh sách xe cần chú ý
- `M11-05-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M11-05-03` **Trường hợp biên:** Kiểm tra: Không có chuyến; xe mới; giao dịch lớn bất thường; dữ liệu đang đồng bộ **Expected:** Kết quả tuân thủ quy tắc: Mỗi chỉ số có định nghĩa, thời điểm cập nhật và đường dẫn tới số liệu nguồn
- `M11-05-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M11-05-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## 11.6 — Trợ lý truy vấn số liệu cho giám đốc

- **Delivery:** `implemented` — ROADMAP.md §Current coverage (11.6 done).
- **Authority:** `pending decision` — `docs/prd/Module11.docx` §11.6, customer-response and conclusion cells blank.
- **Intended page/workflow:** Trợ lý truy vấn số liệu cho giám đốc.
- **Roles stated by source:** Giám đốc và người được cấp quyền
- **Business need / visible outcome:** Giám đốc và người được cấp quyền cần trợ lý truy vấn số liệu cho giám đốc. Kết quả mong muốn: trả kết quả ngắn gọn kèm số liệu, phạm vi và đường dẫn kiểm tra
- **Required data:** câu hỏi tiếng Việt, kỳ thời gian, chỉ tiêu và phạm vi dữ liệu được phép
- **Core rule:** Câu trả lời phải dựa trên dữ liệu có quyền truy cập, nêu kỳ và nguồn; không tự suy đoán khi câu hỏi mơ hồ
- **Displayed/saved result:** Trả kết quả ngắn gọn kèm số liệu, phạm vi và đường dẫn kiểm tra
- **Exception:** Câu hỏi mơ hồ phải hỏi lại; dữ liệu chưa có phải nói rõ; nội dung nhạy cảm không vượt quyền
- **Boundary cases:** Câu hỏi bằng giọng nói; nhiều chỉ tiêu; “hôm qua” qua múi giờ; câu hỏi ngoài phạm vi
- **Section summary:** Câu trả lời phải dựa trên dữ liệu có quyền truy cập, nêu kỳ và nguồn; không tự suy đoán khi câu hỏi mơ hồ
- **Source:** `docs/prd/Module11.docx` §11.6, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M11-06-01` **Hiển thị dữ liệu thông thường:** Chọn phạm vi hợp lệ gồm câu hỏi tiếng Việt, kỳ thời gian, chỉ tiêu và phạm vi dữ liệu được phép. **Expected:** Trả kết quả ngắn gọn kèm số liệu, phạm vi và đường dẫn kiểm tra
- `M11-06-02` **Không có dữ liệu:** Chọn kỳ hoặc phạm vi không phát sinh dữ liệu. **Expected:** Hiển thị trạng thái không có dữ liệu rõ ràng; các tổng bằng không; không báo lỗi kỹ thuật.
- `M11-06-03` **Trường hợp biên:** Kiểm tra: Câu hỏi bằng giọng nói; nhiều chỉ tiêu; “hôm qua” qua múi giờ; câu hỏi ngoài phạm vi **Expected:** Kết quả tuân thủ quy tắc: Câu trả lời phải dựa trên dữ liệu có quyền truy cập, nêu kỳ và nguồn; không tự suy đoán khi câu hỏi mơ hồ
- `M11-06-04` **Kiểm soát quyền xem:** Người không thuộc phạm vi quyền mở chức năng hoặc đường dẫn trực tiếp. **Expected:** Từ chối truy cập và không để lộ dữ liệu trong nội dung, tệp tải xuống hoặc thông báo lỗi.
- `M11-06-05` **Đối chiếu dữ liệu nguồn:** Thay đổi hợp lệ dữ liệu nguồn rồi tải lại màn hình hoặc tệp xuất. **Expected:** Số liệu mới khớp chi tiết nguồn, không cộng trùng và thể hiện đúng thời điểm cập nhật.

## M11 module-wide acceptance criteria

- `M11-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module11.docx` §5.
- `M11-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 11 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module11.docx` §5.

# M12 — PHÂN HỆ 12 — NHIÊN LIỆU VÀ SỐ HÓA CHỨNG TỪ DẦU

## 12.1 — Cấu hình định mức nhiên liệu và khoảng cách tuyến

- **Delivery:** `partial` — ROADMAP.md §Wave 1 checked; norm granularity/exception rules remain open.
- **Authority:** `pending decision` — `docs/prd/Module12.docx` §12.1, customer-response and conclusion cells blank.
- **Intended page/workflow:** Cấu hình định mức nhiên liệu và khoảng cách tuyến.
- **Roles stated by source:** Kế toán hoặc quản lý cấu hình; điều vận sử dụng
- **Business need / visible outcome:** Kế toán hoặc quản lý cấu hình; điều vận sử dụng cần cấu hình định mức nhiên liệu và khoảng cách tuyến. Kết quả mong muốn: chuyến hiển thị định mức đã áp dụng, số lít gợi ý và công thức
- **Required data:** loại xe, tuyến, quãng đường, định mức hàng hoặc vỏ, mức khoán và ngày hiệu lực
- **Core rule:** Chọn đúng định mức tại ngày chuyến; tuyến miền núi dùng mức khoán nếu được cấu hình; giữ lịch sử thay đổi
- **Displayed/saved result:** Chuyến hiển thị định mức đã áp dụng, số lít gợi ý và công thức
- **Exception:** Người có quyền được nhập mức thực tế khác nhưng phải nêu lý do; chuyến đã chốt không tự đổi theo cấu hình mới
- **Boundary cases:** Tuyến nhiều chặng; chuyến có hàng và vỏ; định mức đổi giữa tháng
- **Section summary:** Chọn đúng định mức tại ngày chuyến; tuyến miền núi dùng mức khoán nếu được cấu hình; giữ lịch sử thay đổi
- **Source:** `docs/prd/Module12.docx` §12.1, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M12-01-01` **Tính toán thông thường:** Nhập đầy đủ loại xe, tuyến, quãng đường, định mức hàng hoặc vỏ, mức khoán và ngày hiệu lực. **Expected:** Chuyến hiển thị định mức đã áp dụng, số lít gợi ý và công thức
- `M12-01-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M12-01-03` **Giá trị biên:** Kiểm tra: Tuyến nhiều chặng; chuyến có hàng và vỏ; định mức đổi giữa tháng **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Chọn đúng định mức tại ngày chuyến; tuyến miền núi dùng mức khoán nếu được cấu hình; giữ lịch sử thay đổi
- `M12-01-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Người có quyền được nhập mức thực tế khác nhưng phải nêu lý do; chuyến đã chốt không tự đổi theo cấu hình mới **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M12-01-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 12.2 — Đối chiếu nhiên liệu cuối tháng với hóa đơn nhà cung cấp

- **Delivery:** `partial` — ROADMAP.md §Wave 4 reconciled; credit-note period rule remains open.
- **Authority:** `pending decision` — `docs/prd/Module12.docx` §12.2, customer-response and conclusion cells blank.
- **Intended page/workflow:** Đối chiếu nhiên liệu cuối tháng với hóa đơn nhà cung cấp.
- **Roles stated by source:** Kế toán thực hiện; giám đốc xem
- **Business need / visible outcome:** Kế toán thực hiện; giám đốc xem cần đối chiếu nhiên liệu cuối tháng với hóa đơn nhà cung cấp. Kết quả mong muốn: báo cáo nêu tổng theo xe, nhà cung cấp và kỳ, cùng danh sách chênh lệch cần xử lý
- **Required data:** kỳ, nhà cung cấp, tổng lít theo chuyến, hóa đơn, số lít mua, đơn giá và số tiền
- **Core rule:** Tổng hợp cùng đơn vị đo; tách chênh lệch số lít, đơn giá và thành tiền; không tính trùng hóa đơn
- **Displayed/saved result:** Báo cáo nêu tổng theo xe, nhà cung cấp và kỳ, cùng danh sách chênh lệch cần xử lý
- **Exception:** Hóa đơn về muộn hoặc dùng cho nhiều xe phải được phân bổ có căn cứ
- **Boundary cases:** Số lít âm do hoàn trả; hóa đơn điều chỉnh; chuyến qua tháng
- **Section summary:** Tổng hợp cùng đơn vị đo; tách chênh lệch số lít, đơn giá và thành tiền; không tính trùng hóa đơn
- **Source:** `docs/prd/Module12.docx` §12.2, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M12-02-01` **Tính toán thông thường:** Nhập đầy đủ kỳ, nhà cung cấp, tổng lít theo chuyến, hóa đơn, số lít mua, đơn giá và số tiền. **Expected:** Báo cáo nêu tổng theo xe, nhà cung cấp và kỳ, cùng danh sách chênh lệch cần xử lý
- `M12-02-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không ghi nhận kết quả sai.
- `M12-02-03` **Giá trị biên:** Kiểm tra: Số lít âm do hoàn trả; hóa đơn điều chỉnh; chuyến qua tháng **Expected:** Kết quả tuân thủ đúng quy tắc và giải thích được cách tính: Tổng hợp cùng đơn vị đo; tách chênh lệch số lít, đơn giá và thành tiền; không tính trùng hóa đơn
- `M12-02-04` **Thay đổi hoặc ngoại lệ:** Thực hiện trường hợp: Hóa đơn về muộn hoặc dùng cho nhiều xe phải được phân bổ có căn cứ **Expected:** Yêu cầu đúng quyền và lý do; giữ giá trị ban đầu, giá trị sau thay đổi và người thực hiện.
- `M12-02-05` **Tính nhất quán:** Tính lại cùng dữ liệu hoặc tải lại sau khi lưu. **Expected:** Kết quả không đổi ngoài chủ ý, không phát sinh dòng trùng và khớp báo cáo chi tiết.

## 12.3 — Tự động đọc ảnh cột bơm và thông tin ảnh

- **Delivery:** `partial` — ROADMAP.md §Wave 1 checked; trustworthy metadata definition remains open.
- **Authority:** `pending decision` — `docs/prd/Module12.docx` §12.3, customer-response and conclusion cells blank.
- **Intended page/workflow:** Tự động đọc ảnh cột bơm và thông tin ảnh.
- **Roles stated by source:** Lái xe hoặc người nhập ảnh xác nhận; kế toán kiểm tra
- **Business need / visible outcome:** Lái xe hoặc người nhập ảnh xác nhận; kế toán kiểm tra cần tự động đọc ảnh cột bơm và thông tin ảnh. Kết quả mong muốn: lưu ảnh gốc, dữ liệu đọc được, mức độ tin cậy, giá trị đã xác nhận và người sửa
- **Required data:** ảnh cột bơm, số lít, đơn giá, thành tiền, ngày giờ, vị trí, xe và chuyến
- **Core rule:** Kết quả tự động là gợi ý; đối chiếu phép nhân; người dùng xác nhận trước khi cập nhật nhiên liệu
- **Displayed/saved result:** Lưu ảnh gốc, dữ liệu đọc được, mức độ tin cậy, giá trị đã xác nhận và người sửa
- **Exception:** Thiếu vị trí, ảnh mờ hoặc phép tính không khớp phải cảnh báo và chuyển kiểm tra thủ công
- **Boundary cases:** Ảnh chụp lại; nhiều màn hình trong ảnh; dữ liệu vị trí bị tắt; không có mạng
- **Section summary:** Kết quả tự động là gợi ý; đối chiếu phép nhân; người dùng xác nhận trước khi cập nhật nhiên liệu
- **Source:** `docs/prd/Module12.docx` §12.3, tables “A. Nội dung cần Silver Sea xác nhận” and “B. Tiêu chí nghiệm thu đề xuất”.

Acceptance cases:
- `M12-03-01` **Luồng nghiệp vụ thông thường:** Nhập đầy đủ ảnh cột bơm, số lít, đơn giá, thành tiền, ngày giờ, vị trí, xe và chuyến và hoàn tất thao tác. **Expected:** Lưu ảnh gốc, dữ liệu đọc được, mức độ tin cậy, giá trị đã xác nhận và người sửa
- `M12-03-02` **Thiếu hoặc sai dữ liệu:** Bỏ trống một dữ liệu bắt buộc hoặc nhập giá trị không hợp lệ. **Expected:** Cảnh báo bằng tiếng Việt, chỉ rõ dữ liệu cần sửa và không chuyển sang trạng thái không hợp lệ.
- `M12-03-03` **Trường hợp ngoại lệ:** Thực hiện trường hợp: Thiếu vị trí, ảnh mờ hoặc phép tính không khớp phải cảnh báo và chuyển kiểm tra thủ công **Expected:** Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do khi cần.
- `M12-03-04` **Kiểm soát quyền thao tác:** Người không có quyền thử tạo, sửa, duyệt, chốt hoặc xóa dữ liệu. **Expected:** Từ chối thao tác; dữ liệu không thay đổi; nhật ký phân biệt rõ thao tác thất bại.
- `M12-03-05` **Gửi lại hoặc thao tác đồng thời:** Gửi cùng yêu cầu hai lần hoặc thực hiện đồng thời; đồng thời kiểm tra ảnh chụp lại; nhiều màn hình trong ảnh; dữ liệu vị trí bị tắt; không có mạng. **Expected:** Không tạo dữ liệu hoặc bút toán trùng; trạng thái cuối cùng nhất quán và truy vết được.

## M12 module-wide acceptance criteria

- `M12-HT-01` **Ngôn ngữ:** Nhãn, hướng dẫn và thông báo lỗi dùng tiếng Việt; chỉ giữ CUS, tên riêng và mã tiêu chuẩn cần thiết. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-02` **Phân quyền:** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường dẫn trực tiếp không vượt quyền. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-03` **Nhật ký:** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-04` **Tính toàn vẹn:** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-05` **Tiền tệ:** Số tiền dùng đồng Việt Nam, không có số lẻ; phép cộng trừ và dấu phân cách đúng; màn hình khớp tệp xuất. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-06` **Ngày giờ:** Hiển thị thống nhất theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không thay đổi giữa các màn hình. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-07` **Thiết bị:** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc mất dữ liệu đã nhập. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-08` **Khôi phục lỗi:** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn và không mất dữ liệu đã lưu. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-09` **Tìm kiếm và xuất dữ liệu:** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không vỡ bố cục. — authority `pending decision`; source `docs/prd/Module12.docx` §5.
- `M12-HT-10` **Đối chiếu liên phân hệ:** Dữ liệu của Phân hệ 12 khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được tới chứng từ hoặc thao tác. — authority `pending decision`; source `docs/prd/Module12.docx` §5.

## Q01–Q23 business-logic proposals

All entries below are **delivery/authority status: `pending decision`** unless and until their indexed `Status` changes to `accepted` or `modified`. Source: `docs/prd/business-logic-qa-proposals.md` and its original `Business_Logic_QA_Proposals_SilverSea.docx`.

### Q01 — Early-warning threshold for credit limit

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Áp dụng ngưỡng cảnh báo sớm mặc định **80%** và cảnh báo vượt hạn mức tại **100%**. Mức 80% dùng chung khi tạo khách hàng mới nhưng phải cho phép cấu hình riêng theo từng khách hàng. Số dùng để kiểm tra gồm dư nợ hiện tại, các khoản đã duyệt nhưng chưa thu và giá trị dự kiến của lô hoặc chuyến mới.
- **Affected workflow:** resolves `M5.3 §1` (Wave 3) and cross-cutting #2.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q01”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q02 — Who can approve service continuation beyond credit limit; tiered approval?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** CUS và điều vận không được tự cho vượt hạn mức. **Trưởng phòng Tài chính/Kế toán** được duyệt ngoại lệ cấp 1 khi phần vượt không quá **10%** và không vượt ngưỡng tiền được cấu hình; **Giám đốc** duyệt các trường hợp lớn hơn hoặc lặp lại. Mỗi phê duyệt chỉ áp dụng cho một lô/chuyến hoặc đến ngày hết hạn cụ thể và bắt buộc ghi lý do.
- **Affected workflow:** resolves `M5.3 §5` (Wave 3).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q02”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q03 — Payment allocation when customer doesn't specify

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Ưu tiên chỉ dẫn thanh toán của khách hàng. Nếu không có chỉ dẫn, **phân bổ theo khoản đến hạn cũ nhất**; nếu cùng ngày đến hạn thì theo ngày phát hành cũ nhất. **Không phân bổ theo tỷ lệ hoặc ưu tiên cước vận tải theo mặc định**. Tiền thừa giữ ở trạng thái chưa phân bổ của khách hàng; chỉ hoàn trả khi có yêu cầu và phê duyệt.
- **Affected workflow:** resolves `M5.4 §5` (Wave 3) and the M5.6 allocator default. **Note:** the implemented M5.6 allocator already defaults to oldest-first — this proposal confirms that default.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q03”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q04 — Reminder schedule, frequency, quiet hours, holidays

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Lịch mặc định: **trước hạn 3 ngày, đúng ngày đến hạn, sau hạn 3 ngày, sau đó mỗi 7 ngày**. Chỉ gửi từ **08:00 đến 17:30 trong ngày làm việc**; lịch rơi vào cuối tuần hoặc ngày lễ chuyển sang 09:00 ngày làm việc tiếp theo. Tối đa một thông báo tổng hợp cho mỗi khách hàng mỗi ngày; dừng nhắc khi đã thanh toán đủ, đang tranh chấp hoặc bị tạm dừng.
- **Affected workflow:** resolves `M5.7 §4` (Wave 3, item `wave3-m57-reminder-job` is **already implemented** — proposal now defines its hardening: quiet hours + holiday roll + 1/day cap).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q04”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q05 — Channel priority: email vs in-app; retry & fallback

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Đối với khách hàng, **email là kênh chính**; thông báo trong hệ thống được tạo đồng thời để dự phòng và lưu vết. Đối với nhân viên nội bộ, thông báo trong hệ thống là kênh chính. Email lỗi được thử lại **3 lần, lần lượt sau 15 phút, 2 giờ và 24 giờ**; sau đó đánh dấu thất bại và báo CUS xử lý. Thông báo trong hệ thống không được coi là bằng chứng email đã gửi thành công.
- **Affected workflow:** resolves part of `M5.7 §4` + cross-cutting #4 (notifications). Wave-2 email service + Wave-0 scheduler already provide the retry hook; this proposal pins the exact retry cadence.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q05”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q06 — Multi-truck fuel invoices & allocation basis

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Cho phép một hóa đơn nhiên liệu **gồm nhiều xe**. Hóa đơn được lưu một lần, bên dưới có các dòng phân bổ theo xe. Căn cứ ưu tiên là phiếu hoặc nhật ký đổ nhiên liệu thực tế theo biển số, ngày và số lits; số tiền của từng xe được tính theo số lit thực tế và đơn giá hóa đơn. **Không chia đều; thiếu căn cứ thì giữ chưa phân bổ và chưa cho duyệt.**
- **Affected workflow:** resolves `M6.1 §1` (Wave 3, item `wave3-m61-fuel-ap-recon` is **already implemented** at the per-truck-invoice level — proposal now adds the multi-truck-invoice line-allocation requirement as a hardening item).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q06”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q07 — Multiple service categories per supplier + primary category

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Cho phép một nhà cung cấp **thuộc nhiều nhóm dịch vụ**. Mỗi nhà cung cấp có một **nhóm chính** để làm giá trị mặc định và phục vụ báo cáo tổng hợp; từng hóa đơn hoặc khoản chi vẫn phải ghi đúng nhóm dịch vụ thực tế. Nhóm chính không được tự động thay đổi phân loại của giao dịch.
- **Affected workflow:** resolves `M6.2 §1` (Wave 3, item `wave3-m62-supplier-type-taxonomy` is **in-progress** — proposal confirms multi-type-per-supplier + primary-type design).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q07”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q08 — Customer ⇄ supplier duality; can AR/AP be offset?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Dùng **một hồ sơ đối tác chung theo mã số thuế**, gắn đồng thời vai trò Khách hàng và Nhà cung cấp; sổ phải thu và phải trả vẫn tách riêng. Cho phép đối trừ **nhưng không tự động**: chỉ thực hiện với cùng pháp nhân và cùng loại tiền, có biên bản và phê duyệt, **số đối trừ không vượt số nhỏ hơn giữa phải thu và phải trả**.
- **Affected workflow:** resolves cross-cutting partner-duality + informs M6.4 (`debt_offsets` rules). Confirms existing M6.4 invariant "offset ≤ smaller side" + adds "must have minutes + approval, never auto".
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q08”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q09 — Period scope: company-wide or per-driver?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Chốt theo **kỳ lương chung của toàn công ty** hoặc của một đơn vị trả lương được cấu hình, **không chốt độc lập từng lái xe**. Trước khi chốt, từng lái xe có trạng thái Sẵn sàng hoặc Chờ xử lý để hệ thống kiểm tra đầy đủ.
- **Affected workflow:** resolves `M7.3 §1` (Wave 3). Confirms the assumed "per-company-period" default.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q09”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q10 — Block entire period on driver error or allow partial close?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Mặc định **chặn chốt toàn kỳ** nếu còn lỗi ảnh hưởng đến số tiền. Chỉ cho phép chốt phần còn lại khi người có thẩm quyền phê duyệt loại lái xe đó khỏi kỳ chính; lái xe bị đánh dấu Chờ bổ sung và được xử lý bằng kỳ lương bổ sung hoặc khoản điều chỉnh. **Không được âm thầm bỏ qua.**
- **Affected workflow:** adds a new behavioral rule for M7.3 (Wave 3). Partial-close allowed only with approver + reason; marked drivers roll to supplementary period.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q10”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q11 — Post-close changes: reopen or adjustment?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Sau khi chốt, **ưu tiên tạo khoản điều chỉnh ở kỳ đang mở**. Chỉ mở lại kỳ khi chưa phát hành phiếu lương, chưa thanh toán và chưa hạch toán chính thức. Kế toán lập, Trưởng phòng Tài chính/Kế toán chốt; **Giám đốc hoặc người được ủy quyền mới được mở lại**. Sau khi thanh toán hoặc hạch toán, chỉ dùng bản điều chỉnh hoặc hoàn tác.
- **Affected workflow:** adds post-close governance to M7.3 (Wave 3). Maps onto the existing lock semantics — reopen only pre-issue, adjustment-note only post-payment.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q11”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q12 — Which categories allow no-invoice + accepted substitute evidence

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Thiết lập **danh sách hạng mục được phép**. Mặc định gồm **bốc xếp hoặc lao động thời vụ tại hiện trường, vé bãi/đò/đường hoặc phí nhỏ có phiếu lẻ, xử lý khẩn cấp tại cảng/kho và vật tư nhỏ phục vụ chuyến**. Căn cứ thay thế được chấp nhận gồm **phiếu thu/biên nhận/vé, chứng từ chuyển khoản hoặc ví điện tử, ảnh hiện trường có thời gian và địa điểm, hoặc xác nhận ký nhận của người nhận/quản lý**. Bắt buộc có số tiền, ngày, người nhận, lô hoặc chuyến, lý do và ít nhất một bằng chứng.
- **Affected workflow:** resolves `M4.7 §2` (Wave 3). Provides the default category list + evidence taxonomy to seed `expense_categories.requiresInvoice`/`substituteEvidenceAllowed`.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q12”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q13 — Per-item and per-day-per-person thresholds

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Có. Đề xuất khởi tạo mức **1.000.000 đồng cho mỗi khoản** và **5.000.000 đồng cho mỗi người trong một ngày**; các mức này phải cấu hình được theo hạng mục và chức danh. Hệ thống **cộng gộp** các khoản cùng người, cùng ngày và cùng hạng mục để ngăn việc chia nhỏ khoản chi.
- **Affected workflow:** adds configurable per-item / per-day-per-person caps + anti-splitting aggregation rule for M4.7 (Wave 3).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q13”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q14 — Over-threshold or missing-evidence: auto-reject or route to approval?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Thiếu bằng chứng tối thiểu thì **trả lại để bổ sung, không chuyển thẳng sang phê duyệt**. Vượt ngưỡng nhưng đủ căn cứ thì chuyển phê duyệt: **Trưởng phòng Tài chính/Kế toán duyệt đến 5.000.000 đồng cho mỗi khoản**; trên mức đó hoặc tổng trong ngày vượt 10.000.000 đồng thì **Giám đốc duyệt**. Người tạo không được tự duyệt; mọi ngoại lệ phải ghi rõ lý do.
- **Affected workflow:** resolves `M4.7 §5` (Wave 3). Sets the rule: missing-evidence = return (not approve), over-threshold-but-complete = tiered approve (chief accountant ≤5M, director >5M or >10M/day).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q14”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q15 — Maker/checker/approver/viewer split; self-approval allowed?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Áp dụng nguyên tắc **tách người tạo, người kiểm tra và người phê duyệt** đối với tiền, giá, công nợ, ngoại lệ, chốt kỳ và điều chỉnh. **Người tạo không được tự phê duyệt dữ liệu của mình.** Các cập nhật vận hành thông thường như tiến độ chuyến hoặc bổ sung chứng từ có thể do người phụ trách tự lưu; khi làm thay đổi tiền hoặc trạng thái đã chốt thì phải qua kiểm tra và phê duyệt. Quyền chỉ xem không được sửa hoặc duyệt.
- **Affected workflow:** resolves cross-cutting #1 (roles & permissions) for the money/price/debt/exception/period-close surface. Codifies the maker-checker-approver separation already informally assumed across waves.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q15”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q16 — Customer account scope: 1 customer or many?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Mặc định một tài khoản Khách hàng chỉ xem dữ liệu của **một pháp nhân khách hàng**. Chỉ cho phép xem nhiều khách hàng đối với **tài khoản tập đoàn hoặc đại lý** được quản trị viên liên kết rõ từng khách hàng; dữ liệu, chứng từ và công nợ vẫn phải tách theo từng pháp nhân. **Không cấp quyền chỉ dựa trên tên miền email.**
- **Affected workflow:** resolves the CUSTOMER portal scope question (Wave 2, customer portal auth method + Wave-0 row-scope). Confirms Wave-0 `scopedByCustomer` default of 1:1; adds the corporate/agent multi-link variant as a follow-up.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q16”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q17 — Clerk (Nhân viên chứng từ) editable surface + scope

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Nhân viên chứng từ được tạo và sửa **hồ sơ lô, vận đơn, công-te-nơ, niêm phong, tờ khai, lệnh giao hàng, điểm nhận/giao và tệp chứng từ**. Trước khi chuyển điều vận được sửa trực tiếp; sau khi chuyển chỉ được bổ sung thông tin không làm đổi kế hoạch. Thay đổi khách hàng, công-te-nơ, thời gian hoặc địa điểm phải tạo phiên bản mới và thông báo điều vận. Phạm vi giới hạn **đồng thời theo đơn vị phụ trách và khách hàng/lô được giao**; không có quyền sửa giá, chi phí, công nợ hoặc lương.
- **Affected workflow:** resolves CLERK role scope (Wave 4, M10.1/M10.2 + Wave-0 CLERK casbin rows). Defines the pre-dispatch/post-dispatch edit boundary and the dual scope (unit + customer/shipment).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q17”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q18 — Editing approved/locked data: who, with reason / adjustment note?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Dữ liệu đã duyệt hoặc đã chốt **không được sửa trực tiếp**. Người có quyền chỉ được tạo **bản điều chỉnh hoặc hoàn tác**; mở lại chỉ là ngoại lệ trước khi phát hành hoặc hạch toán. Bắt buộc ghi lý do, lưu giá trị trước và sau, người thực hiện và người duyệt. Quản lý nghiệp vụ xử lý dữ liệu vận hành; Trưởng phòng Tài chính/Kế toán xử lý dữ liệu tiền; mở kỳ do Giám đốc hoặc người được ủy quyền.
- **Affected workflow:** cross-cutting rule — already implemented in spirit by `version` optimistic lock + `audit_logs` + Wave-0 status-history append-only. This proposal makes the "adjustment-note, never in-place edit" rule explicit across all locked surfaces.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q18”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q19 — Payment due / processing date on weekend or holiday

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Mặc định **chuyển hạn xử lý sang ngày làm việc tiếp theo**, nhưng vẫn lưu và hiển thị ngày gốc theo hợp đồng. Việc tính quá hạn và gửi nhắc dựa trên ngày đã điều chỉnh. Nếu hợp đồng quy định phải tính theo ngày lịch thì **quy tắc của hợp đồng được ưu tiên**.
- **Affected workflow:** resolves cross-cutting #3 (date/time & periods). Adds a configurable "next-business-day" roll with contract-override.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q19”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q20 — Trip spanning two periods: which period?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Doanh thu chuyến, lương chuyến, số chuyến và lợi nhuận được ghi vào **kỳ của ngày hoàn thành chuyến**. Chấm công, nhiên liệu và khoản chi được ghi theo ngày phát sinh thực tế. Ngày bắt đầu vẫn dùng cho điều vận và tìm kiếm; chuyến chưa hoàn thành tại cuối kỳ được đánh dấu Đang thực hiện và chưa tính là số chính thức.
- **Affected workflow:** resolves cross-cutting #3 — sets the rule "revenue/salary/trip-count → completion-date period; attendance/fuel/expense → actual-event date; in-progress trips excluded from official period totals".
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q20”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q21 — Period lock granularity: week/month/custom; late data → next period or adjust old?

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** **Lương và nhiên liệu khóa theo tháng. Giấy báo nợ khóa theo chu kỳ thanh toán của từng khách hàng**, mặc định theo tháng và chỉ theo tuần khi hợp đồng quy định. Dữ liệu đến muộn sau khi khóa được đưa vào kỳ đang mở **dưới dạng điều chỉnh có liên kết về kỳ gốc**; không sửa trực tiếp kỳ cũ. Chỉ mở lại trước khi phát hành hoặc thanh toán và phải được phê duyệt.
- **Affected workflow:** resolves cross-cutting #3 + `M4.5 §6` (Wave 2, period definition) + M7.3 period-close (Wave 3). Lock granularity now defined: salary/fuel = monthly, debit-note = customer payment cycle (default monthly, weekly only if contract says so).
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q21”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q22 — Source-of-truth & recompute vs adjustment in the chain

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Nguồn chính được xác định theo từng loại dữ liệu: **lô hàng** giữ thông tin khách hàng, hàng và công-te-nơ; **chuyến xe** giữ xe, lái xe, thời gian và trạng thái thực tế; **khoản chi đã duyệt** giữ chi phí; **giấy báo nợ đã phát hành** giữ số phải thu; **khoản tiền về và phân bổ** giữ số đã thanh toán và còn nợ. Trước khi chốt, thay đổi nguồn **tự tính lại** các phần phụ thuộc và cảnh báo người liên quan. Sau khi chốt hoặc phát hành, **không ghi đè mà tạo phiên bản, bản điều chỉnh hoặc hoàn tác** và giữ đầy đủ lịch sử.
- **Affected workflow:** resolves cross-cutting #7 (cross-module integration & number drift). Codifies the source-of-truth table for each link in the shipment → trip → expense → debit-note → AR chain + the "recompute pre-lock, versioned-adjustment post-lock" rule.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q22”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

### Q23 — Double-submit, flaky network, concurrent edit/approve

- **Status:** `pending` / classification `pending decision`.
- **Proposed rule:** Mỗi thao tác gửi có một **mã giao dịch duy nhất**; gửi lại cùng mã trả về kết quả đã có và không tạo thêm bản ghi. Các số lô, chuyến và chứng từ có quy tắc duy nhất để chặn trùng. Khi hai người cùng sửa, **người lưu sau phải tải lại phiên bản mới và không được ghi đè tự động**. Khi hai người cùng duyệt, phê duyệt hợp lệ đầu tiên khóa trạng thái; lần sau bị từ chối. Mọi lần thử và xung đột phải được lưu trong nhật ký.
- **Affected workflow:** cross-cutting. Partially implemented via `version` optimistic lock (409 on stale) + unique constraints + audit_logs. This proposal adds: (a) idempotency-key on every write (currently absent), (b) first-approve-wins explicit rejection message, (c) conflict-attempt audit logging.
- **Source:** `docs/prd/business-logic-qa-proposals.md` heading “Q23”; original `docs/prd/Business_Logic_QA_Proposals_SilverSea.docx`.

## Visual-QA coverage derived from the PRDs

Every module includes a device/usability criterion. Visual QA should therefore cover every accessible page for every authorized role on desktop and phone, with special attention to:

- Vietnamese labels, instructions, validation and recovery messages; CUS/proper names/standard codes may remain.
- Role/data-scope navigation and direct-link denial without information leakage.
- Empty, loading, error, offline/retry and no-data states.
- No covered buttons, broken tables, lost form state, unreadable values, or horizontal overflow on phone.
- Search/filter/export consistency and VND/date/time formatting.
- Role-targeted mobile workflows: DRIVER M8, FORWARDER/field staff M9, CLERK M10; customer portal M3; director/manager/accountant dashboards and reports M1/M5/M6/M7/M11/M12.

## QA triage order

1. Test the explicit `not found` section first: M1.7 two-way cargo pairing.
2. Test all `partial` sections against both shipped behavior and the unresolved-decision boundary; do not fail the product for a value Silver Sea has not approved, but do fail misleading enforcement or claims.
3. Test `implemented` sections functionally by role and direct URL/API scope, then visually on desktop and phone.
4. Record Q01–Q23 as decision blockers wherever exact values, role approvals, schedules, scopes, or enforcement depend on them.

## Sources

- `CONTEXT.md` §Authority order and §Repository shape.
- `ROADMAP.md` §Reality check, §Current codebase coverage, Waves 0–4, Open PRD questions, Cross-cutting open questions.
- `plans/silversea-prd-roadmap/plan.md` §Critical reality check, §Current codebase coverage, §Wave ordering, §Open PRD questions.
- `docs/prd/Module1.docx` … `docs/prd/Module12.docx`, each numbered section and module-wide acceptance table.
- `docs/prd/business-logic-qa-proposals.md` Q01–Q23 and governing rule; original DOCX counterpart.
