# Changelog

## 2026-10-09 (đêm) — reconciliation: origin/main -> prod (kiểm chứng từng file)

Prod `1a1a227e` → merge commit của `origin/main` (`a71bf718`). Main đi trước 81
commit và chỉ có đúng MỘT khối công việc chưa từng lên prod.

- **Lô hàng ops trên mobile thành card liền khối** (20261009_9, port 6da4f6b7 từ
  main): /ops/orders, /ops/wallet, /ops/fleet-tracking — hàng gộp 2 cột nay có viền
  đủ + bo 12px + nền surface; ô trong hàng nền trong suốt nên khoảng hở không đọc
  thành "block xám rời rạc"; trạng thái ghim chỉ còn MỘT accent — dải status brand 3x20
  ở mép trái; hover wash chỉ bật trên con trỏ tinh (hover+fine), không dính hover
  trên touch. Trước đó hàng chỉ có border-bottom nên nền highlight tràn qua mép phải
  card ở 390px.
- **Nền ghim warn giữ nguyên trên bảng desktop, nhưng không được tràn vào card mobile**
  (quyết định reconciliation): tint warn là diện mạo lâu đời của prod (7fa5ae07,
  c9442b2f chỉ đổi màu theo token) nên không đụng. Nhưng selector desktop
  `.ops-orders__table tbody tr.is-pinned` là 0-2-2, mạnh hơn rule card 0-2-0 — nên
  nếu không reset, thẻ ghim ở 390px vẫn nhuốm warn và mang HAI accent cùng lúc (đã
  đo bằng Chromium thật: computed background = warn 7%). Khối container nay có reset
  riêng ở 0-3-0 đưa nền thẻ về `--surface`, dải status brand là accent duy nhất.
- **7 file conflict còn lại lấy phía prod**: `action-error.ts(+.test)`,
  `TripReassignDialog.tsx`, `DispatchPlanEditorCell.test.tsx`,
  `useDispatchDetailPlan.test.tsx`, `lead-qa-harness.mjs`,
  `qa-20261008-leadqa-batch.mjs` — ở cả hai vế lịch sử prod đều là phần mở rộng của
  main, bản main là trạng thái cũ. Sau hợp nhất cây prod lệch origin/prod đúng 4
  file: 3 CSS ops + `OpsOrdersPage.test.tsx` (pin contract mới) + CHANGELOG này — không
  file nào khác bị lẫn nội dung cũ của main.

## 2026-10-09 (tối) — wave: LCL intake & dispatch rulings, money ₫ one text node

Prod `bc305aec` → `6cfe6620` (staging-verified từng bước: `f04497ac` rung intake LCL 16/16 — 38938c50; `3c32994b` rung money ₫ /finance).

### Shipped

- **"Quy cách đóng gói" hàng lẻ có gợi ý sẵn** (091026180800, a692174b): ô "Quy cách đóng gói" trên form tạo lô LCL giờ là combobox gợi ý Pallet / Roll / Carton / Thùng gỗ / Bao / Can — chọn nhanh hoặc gõ tự do như cũ, giá trị ngoài danh sách vẫn lưu nguyên.
- **Form lô lẻ bỏ hai mốc chỉ dùng cho container nguyên** (091026180700, a9c2d57d): khối "Lịch & ghi chú" của lô hàng lẻ không còn "Hạn hạ container tại cảng" và "Thời điểm trả container" (nghiệp vụ tàu/container nguyên); "Hạn hoàn tất hải quan" và "Ngày giao dự kiến" giữ nguyên. Form FCL không đổi.
- **"Thêm kho lấy hàng" gọn ba trường, mã tự sinh** (091026180600, 1dee5f58): khi tạo lô, CUS thêm kho lấy hàng mới chỉ cần Tên đầy đủ / Tên ngắn / Địa chỉ; mã điểm vận hành tự suy ra. Form đầy đủ (loại điểm, liên hệ, Google Maps) vẫn ở danh mục.
- **Tạo lô xong mở thẳng trang lô mới** (091026180900, f04497ac): sau khi lưu, app chuyển đến trang chi tiết của lô vừa tạo thay vì danh sách xếp theo hàng đợi — CUS thấy ngay lô của mình để tiếp tục theo dõi. Bốn thẻ intake (180600/180700/180800/180900) cùng rung một drive 16/16 (38938c50).
- **App lái xe: hàng nhập hiện đúng điểm hạ** (091026190530, f7da4e65): hàng "Cảng hạ/Hạ" của chuyến IMPORT giờ mang điểm hạ thật của công việc — cảng/bãi hạ container theo dữ liệu điều vận (nơi trả vỏ của dữ liệu cũ còn ghi thì vẫn hiển thị trước); bỏ dòng chết "Chưa có nơi trả rỗng" đứng cạnh "Địa chỉ giao hàng" cùng tên bãi. Rung staging `f8db1eea` (972fbc9b).
- **Lái xe nhận rồi vẫn đổi được xe** (091026190520, 6cfe6620): sau khi lái xe nhận việc, Điều vận vẫn chỉnh được phương tiện — đầu kéo/moóc với xe nhà, nhà xe/biển số với xe ngoài — giữ nguyên lái xe đã nhận; đổi lái xe hoặc chuyển giữa xe nhà ↔ xe ngoài vẫn chỉ trong cửa sổ trước khi nhận (máy chủ từ chối "Lái xe đã nhận việc — chỉ được đổi xe, giữ lái xe.", dialog khóa ô lái xe kèm lý do thấy được).
- **Mọi số tiền một text node, ₫ cách khoảng** (20261009_8, 3c32994b): quét 43 vị trí ₫ còn tách node trên toàn app — số và đơn vị nguyên cụm "1 234 567 ₫" ở mọi màn hình, theo luật 2026-10-06; sổ quỹ Ops khớp số trên đúng một node (c4f92fd1).

## 2026-10-09 (chiều) — wave: iOS mobile viewport

Prod `23998fbd` → staging-verified `ef4c1d63`.

### Shipped

- **Hết khoảng trống chết đáy màn hình trên mobile + modal thành bottom sheet** (20261009_3, ef4c1d63): trang Chi tiết lô hàng nhận fill primitive (trước đây thiếu nên hụt chân ~64px trên phone); editor 'Chỉnh sửa khách hàng và lộ trình' trên bề rộng ≤640px portal thành bottom sheet áp đáy (radius trên 16px, đáy phẳng, padding-bottom max(16px, env(safe-area-inset-bottom)), backdrop mờ, dvh budget) qua MỘT implementation dùng chung cả 7 chế độ sửa; desktop giữ neo tại chỗ. 5 pin đỏ→xanh; rung mobile 390/430: sheet dock bottom=0, trang lấp đầy viewport. Thiết bị iOS/Android thật để owner xác nhận cảm giác cuối.
- **Lỗi lint budget về 0** (8f2791f8): 2 dead local (HrRosterPage sau khi chuyển projection server-side; import thừa sau 93455878); testplan/qa/scripts/** vào nhóm driver-scratch không lint như evidence/qa.

## 2026-10-09 (trưa) — wave: retest round 9

Prod `b1fc317b` → `23998fbd` (staging-verified `fba9f508` → `26d3f1f7` → `45993f90`).

### Shipped

- **Picker mở từ toàn bộ ô ngày giờ (lần 2)** (091026091500, fba9f508): hợp đồng mới của host combinedPicker — click/double-click BẤT KỲ ĐÂU trên thân ô (gồm segment input) mở 'Chọn ngày giờ'; gõ bàn phím giữ caret editing (auto-advance); host không-combined giữ nguyên luật caret 20/09 byte-for-byte. Pin cũ 4da7470f được supersede tường minh. Rung staging: segment click → đúng 1 dialog, gõ 08 + auto-advance, double-click vẫn 1 dialog.
- **Header bảng điều phối một dòng** (091026091550, 26d3f1f7): khôi phục luật nowrap toàn cục trên 2 lưới điều phối — /dispatch 8/8 + /dispatch-detail 9/9 header giữ một dòng ở 1280/1440 (đo Range client-rects). Red-first 4 pin; quét plan-board family.
- **Gỡ kẹt 'lịch trình bị khóa sau lưu'** (091026091510, 45993f90 — MiniMax WIP, lead gate + land theo chỉ đạo 'pick the tickets'): rule 'lot READY phải giữ ngày' giờ chỉ chặn lot CÓ live trip (boundary xoá-lô CTO 2026-09-04); lot do chính editor đưa lên READY có thể hoàn tác về 'Chưa chốt ngày' (revert PENDING_DATE + cancel fulfillment). Red-first lead tự quan sát (revert-test đỏ tại HEAD-service); suite 100/100. Rung staging trên chính lô reporter (TEST-LCL-362): set→200/READY, clear→200/PENDING_DATE. Client CUS giữ self-heal 409 cho conflict thật (lot có trip).

## 2026-10-09 (sáng) — wave: HR roster rulings

Prod `e9339ad1` → `fca551ee` (staging-verified từng bước `3a43b3b1` → `fca551ee`).

### Shipped

- **Danh sách nhân sự chỉ còn lái xe** (20261009_1, owner ruling 09/10 'chấm công chỉ dành cho lái xe' / 'no office staff'): roster lọc đúng role DRIVER — pin test đỏ→xanh + rung staging chứng minh 43 hàng = đúng 43 driver theo API, 0 nhân sự văn phòng.
- **Kế toán đọc được roster** (20261009_2): menu Danh sách nhân sự trỏ tới /auth/users vốn 403 role tài chính — giờ có endpoint đọc riêng GET /auth/users/roster (casbin hr_roster: MANAGER + ACCOUNTANT; projection đúng cột roster, không salary/login; driver-only chặn luôn ở server). Rung: hoapt 200 + 43 hàng render, DISPATCHER 403, admin không đổi.

### Rulings

- Owner 09/10: chấm công driver-only vĩnh viễn — bảng văn phòng đã bỏ 06/10 không quay lại; thẻ gốc 051026231606 đóng kèm ruling.
- 'Phơi phiếu' GIỮ NGUYÊN (lead ruling, owner ủy quyền): thuật ngữ kế toán thật, nhất quán mọi bề mặt.
- OPS không vào /fleet + /expenses: KHÔNG có requirement nào đòi mở — giữ nguyên thiết kế; đóng mục.

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
- Ruling owner 09/10: chấm công CHỈ dành cho lái xe, không nhân sự văn phòng ('no office staff') — thẻ 051026231606 đóng kèm ruling; roster 'Danh sách nhân sự' lọc còn đúng lái xe tách thành thẻ 20261009_1. Còn mở: không còn mục mở — wording 'Phơi phiếu' GIỮ NGUYÊN theo lead ruling 09/10 (owner ủy quyền; thuật ngữ kế toán thật, nhất quán mọi bề mặt, trong thẻ 081026072303).

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
