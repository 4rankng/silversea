# Changelog

## 2026-10-09 (rạng sáng) — wave: retest round 8

Prod `371f297f` → `e9339ad1` (staging-verified từng bước: `443f5c14` → `463712eb` → `e9339ad1`).

### Shipped

- **Placeholder ngày giờ gọn đúng format** (081026230520): ô phân đoạn đọc 'HH:mm' / 'DD/MM/YYYY' — bỏ khoảng trắng thừa quanh ':' và '/' ở đúng một chỗ dùng chung (DateTimeSegments.css), phủ mọi bề mặt dùng segmented dates (form lô, popover hẹn giờ, filter DD/MM/YYYY toàn app). Red-first + đo glyph thật. Verdict 09-25 của FB-062 bị lead thu hồi đúng luật (revocation) — placeholder-spacing đã bị phản chứng; re-verdict đi theo thẻ này.
- **Guard chống double-booking xe phủ cả chuyến đang chạy** (081026230530): chuyến ACTIVE thiếu Giờ kết thúc từng VÔ HÌNH với guard phát lệnh/phân xe lại (đòi đủ 2 mốc giờ) — giờ chiếm xe trong 1 ca 8 giờ từ giờ chạy, đúng luật guard plan-row; cả 3 predicate đầu kéo/rơ-moóc/tài xế. Staging rung lead: tái tạo đúng kịch bản round 8 (seed occupant IN_TRANSIT thiếu end) → reassign 409 'Xe đầu kéo đã bị trùng lịch kế hoạch.', không ghi đột biến.
- **Mọi SĐT trên app lái xe bấm gọi được** (081026230540): SĐT liên hệ trên chi tiết chuyến giờ là tel: link; 4 điểm hiển thị SĐT đi qua MỘT pattern chia sẻ TelLink (strip whitespace trong href, hiển thị giữ nguyên) — chốt luôn 2 bug tiềm ẩn href chứa khoảng trắng.
- **Nút Xuất trên /debt + /profit có toast phản hồi** (081026230550 + đóng luôn regression FB-053 061026174602): 'Đã xuất báo cáo… ra tệp Excel.' đúng pattern /finance + /fleet/productivity — nhất quán toàn app.
- **Ô NGÀY GIỜ ĐÓNG TRẢ mở picker từ toàn bộ thân ô** (081026230510): vùng bấm picker đã co còn ~3px (luật caret-click cố ý 20/09 + fix placeholder thu hẹp khung) — click vùng trống thân ô giờ mở 'Chọn ngày giờ' (lịch + lưới giờ); click segment vẫn là caret đúng luật owner. KHÔNG phải regression từ quét toast/date-filter — round 7 pass là may mắn trúng khung.
- **Dọn seed QA khỏi invoice tracking** (081026230560, data staging): dòng fixture card 376 (NCC QA Lead 0510 / LEAD-QA-376-01) xóa qua API + UI verified sạch + đăng ký census. 2 tài khoản treasury ACB id 6/7 KHÔNG phải seed (tạo 29-09 bởi admin, trước wave seed) — giữ nguyên theo census của lead.

### Closes & rulings

- 20260925_46 (FB-062 gốc): verdict thu hồi 08/10 theo phản chứng round 8 — phần evidence 'không còn native date input' vẫn đúng; thẻ đã đóng lại trên evidence của fix.
- Đóng nhầm-premise: 061026174601 (trần 360px topbar search là thiết kế đã QA PASS, không phải regression), 061026174602 (toast export P&L đã có từ fix lớp này — đóng theo evidence chung).
- Ruling owner 09/10: chấm công CHỈ dành cho lái xe, không nhân sự văn phòng ('no office staff') — thẻ 051026231606 đóng kèm ruling; roster 'Danh sách nhân sự' lọc còn đúng lái xe tách thành thẻ 20261009_1. Còn mở (owner): wording nav 'Phơi phiếu' (072303 mục 4).

## 2026-10-08 (tối) — wave: fix-all take-over, retest round 7, VAT config

Prod `b90beff2` → `371f297f` (staging-verified từng bước, cuối tại `371f297f`).

### Shipped

- **Toast lỗi theo chính sách trên toàn app** (20261008_6): 63 site còn echo nguyên body lỗi vào toast (27 file) chuyển hết qua module chính sách action-error — toast phân quyền chỉ khi thao tác thật sự bị từ chối và nêu tên thao tác; abort/race không bao giờ ra toast. Bảng disposition từng site trong card.
- **Kế hoạch chi tiết lọc theo kỳ trên cả hai nhánh** (20261008_7): nhánh điều phối (container chưa phân tách tác vụ) trước đó bỏ qua khoảng tháng của topbar; giờ rows và số gán xe cùng tôn trọng kỳ như nhánh fulfillment, cùng cột ngày (ngày hẹn container theo giờ VN, fallback ngày giao dự kiến của lô).
- **Card 'Chứng từ giao hàng' gọn một hàng trên phone** (081026072302; lead landed theo chỉ đạo 'fix all', credit MiMo): trạng thái closed ở ≤640px giữ title một dòng, nút co giãn thay vì title xuống dòng — 56–62px trên 320–430px (trước đây phình ~80px ở dải hẹp); desktop không đổi.
- **Thuế suất VAT của công ty cấu hình được trong app** (081026104400-511): card mới tại /admin-center (0/5/8/10%; lần đầu chưa cấu hình đề xuất 8%), lưu vào bảng singleton mới (migration idx 138), đọc qua /api/vat-config. QA staging phát hiện và sửa 2 bug thật: GET 500 vì postgres.js trả cột timestamp dạng string, và cache 5 phút không evict sau khi lưu (giờ evict trên mỗi lần lưu thật).

### Non-repro closes (retest round 7)

- **'VI PHẠM T10/2026' dính chữ** (081026072301): không tái hiện ở bất kỳ build nào đo lại (local HEAD + staging, 1440/390) — JSX luôn có dấu cách thật; kết quả round 7 là artifact của phép đo text (nối text node kề nhau không chèn cách). Guard test pin nhãn đủ khoảng trắng.
- **5 item dấu/khoảng trắng bề mặt Kế toán** (081026072303): 4/5 không tái hiện ('Theo dõi hoàn cược' đúng, 'Cố định đội xe' nhất quán banner/legend, dòng chia lợi nhuận đủ khoảng trắng); header 'LỆNH' viết hoa đúng skin header toàn app. Không cần sửa code.

### Mở

- Wording nav 'Phơi phiếu' (081026072303 mục 4): house term dùng nhất quán trên mọi bề mặt (nav, tab, route /accounting/phoi-phieu); đổi hay giữ là quyết định product của owner.

## 2026-10-08 (chiều) — wave: 20261008_1–_5 sweep batch

Prod `7b1d0433` → `b90beff2` (staging-verified at `dc599a82`).

- **Ops wallet — Lịch sử chi phí có số full-set** (_2): 4 tab lọc ('Tất cả 15 / Cần bổ sung 0 / Đã ghi nhận 12 / Đã hủy 3') theo census mới native + legacy trip rows; bucket rỗng hiện 0 thấy được.
- **Mọi nút disabled tự giải thích** (_1): /shipments-debit, popover phân bổ, /dispatch-detail — DisabledActionTip (aria-disabled + lý do reachable hover/focus); sweep xong 2 surface live + 21 pin test.
- **Chip lọc điều phối có số đúng nghĩa union** (_3): 'Chưa gán xe 23 / Đã gán xe 19' — số hàng mỗi chip thực sự hiển thị trong view đang lọc (tap chứng minh 1-1).
- **Toast phân quyền nêu tên thao tác** (_4): không echo body lỗi trần; request abort không đẻ toast phân quyền (live-verified); 403 naming pin bằng test.
- **Tabs đọc số có khoảng trắng** (_5, lead-claimed theo chỉ đạo hoàn thành mọi thẻ): aria-label 'Tất cả 147' thay vì 'Tất cả147'; thị giác giữ nguyên. Cross-lane collision với ZAI trên cùng file được reconcile về một bản labelText-based.

## 2026-10-08 — wave: blocker decisions, ops overview, dispatch export, tab counts

Prod `1e688539` → `8897e3f2` (staging-verified at `a1dc8b1f` + QA rungs).

### Shipped

- **/ops — trang Tổng quan Ops** (card 081026095500): 3 chỉ số (lô chờ xử lý trong ngày giao dự kiến, xe đang chạy, số dư quỹ + yêu cầu chờ duyệt) tổng hợp từ endpoint có sẵn, 3 quick link tới /ops/orders, /ops/fleet-tracking, /ops/wallet. Guard opsOnly giữ nguyên; role khác về home của role đó.
- **/dispatch — Xuất file Excel** (card 081026093510): export data-driven — enabled khi có dữ liệu trong phạm vi lọc hiện tại; disabled kèm lý do thấy được (DisabledActionTip). Tệp `ke-hoach-tong-quat-<ngày>.xlsx` đúng dữ liệu lọc.
- **/shipments — tab trạng thái có số full-set** (card 081026093520): mọi tab (Tất cả / Chưa chốt lịch / Chờ điều xe / Chờ đối soát) hiển thị tổng theo filter từ `statusCounts` của API, không bao giờ lấy số dòng trang đang tải; bucket rỗng hiện 0, không để trống.
- **Năng suất — ô phần trăm một dòng by construction** (card 071026141600): token số+đơn vị là một text node nowrap (`NumericUnit`), header mang đủ nhãn. Hardening — lỗi gốc không tái hiện kể cả trước fix.
- **e-POD — nhãn "N tệp" một text node** (card 071026212510): badge đếm file là một span nowrap; sweep 18 vị trí số+đơn vị dính khả năng vỡ node trên toàn app.

### Rulings & closes (owner ủy quyền lead quyết 08/10)

- **Phát lệnh cần nhà xe** (card 397): chưa gán nhà xe thì KHÔNG có nút Phát lệnh — đúng workflow #359; không phải lỗi. Verified 2 chiều trên fixture tự dựng (assigned có fieldset, unassigned không có).
- Non-repro closes: toast 403 admin trên /customers (212000), search không lọc (205300, lần 2, role admin battery), nav race (093500 — chỉ cửa sổ <300ms nội tại, cold-context hiện skeleton ngay).
