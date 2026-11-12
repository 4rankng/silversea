# Case SIL-796 (r2) — 'Chỉnh sửa điều phối': cước trả tra bảng giá nhà xe, không trả 0

**Nguồn:** fail QA build 1ae5afcb (2026-11-11) trên round-1 fix d25f2d84; ticket SIL-796 (id 922).
**Luật owner 04/11:** giá đã ký phải dùng đúng theo loại xe/cont — hộp thoại không bao giờ trình bày số 0 bịa ra thay giá ký.

## Hiện tượng (QA báo)

Hộp "Chỉnh sửa điều phối" — lô 835 (SHP-2611-00341), cont MSKU1234565 40'DC 15.000kg,
Long Minh × KCN Vân Trung (route 10), ngày 2026-11-07:

1. "Cước thu dự kiến" tự điền 4.202.500₫ — QA báo sai; QA nêu 3.997.500₫ là số "case CONT20"
   (route 10 CONT20 = 3.900.000 × 1.025 = 3.997.500 — một case khác, không phải số của lô này).
2. "Cước trả dự kiến" = 0₫ thay vì 3.937.500₫ (giá ký nhà xe của case).
   Cả biến thể xe SilverSea 15C-167.31 (OWN) lẫn xe 15H-104.03 + nhà xe ĐĂNG QUÂN (EXTERNAL):
   trả không được 0.

## Điều tra staging (2026-11-11, recon recon1–recon9)

- Lô 835 trên wire: `pricing {customerId 1, routeId 10, containerTypeCode "40DC"}`,
  deliveryPoint "khu công nghiệp Vân Trung, Phường Nếnh" → route 10 = ĐÚNG lane của lô.
- Engine preview (customer 1 × route 10 × CONT40 × 2026-11-07) → **4.202.500** =
  pricing_tables **id 42** (giá ký 4.100.000, eff 2026-10-02) × freight_rate_terms 2.5%
  (rateTermsId 2) — EXACT hit, KHÔNG fallback nào chạy. Số 4.202.500 ĐÚNG theo dòng giá ký
  của case đó trong DB.
- Route 10 × CONT20 (id 41, 3.900.000 × 1.025) = 3.997.500 — số QA nêu là dòng CONT20 cùng lane.
- **3.937.500 KHÔNG tồn tại ở bất kỳ bảng giá nào trong DB** (sweep toàn bộ pricing_tables 9
  dòng >3tr, carrier_route_pricing chỉ 1 dòng route 9, weight tiers rỗng) — giá nhà xe route 10
  chưa được nhập.
- Root cause "trả = 0" (code): seed cost chỉ chạy khi `carrierValue === OWN_CARRIER_VALUE` tại
  thời điểm preview về/open dialog; chọn nhà xe SAU đó không bao giờ seed lại → lô chưa phân xe
  (giá trị ban đầu '') giữ cost = 0. Khi seed có chạy, cost copy TỔNG CƯỚC THU khách — sai bản
  chất (trả đọc bảng giá nhà xe, không phải cước thu).

## Kỳ vọng sau fix

1. Cước thu: engine trả giá ký EXACT theo (khách × tuyến hiệu lực × loại cont × ngày) — không
   bao giờ dùng giá của LOẠI KHÁC khi miss (keyed ask miss → MANUAL "Thiếu giá gốc cho <loại>",
   không giá đầu bảng).
2. Cước trả dự kiến: tra **bảng giá nhà xe** (`carrier_route_pricing`: tuyến × loại xe
   LIGHT/HEAVY theo trọng tải × [nhà xe] cascade giá riêng → giá chung):
   - có giá → tự điền (OWN lẫn EXTERNAL, kèm supplierId khi chọn nhà xe ngoài);
   - không có giá → xóa 0 lưu, hiện "Chưa có giá ký nhà xe — nhập tay hoặc để trống, không ghi 0";
   - giá nhập tay của điều vận không bị ghi đè.
3. Với dữ liệu hiện tại (route 10 chưa có dòng bảng giá nhà xe): hộp hiện trạng thái thiếu giá —
   KHÔNG 0. Số 3.937.500 chỉ xuất hiện sau khi Kế toán/Config nhập dòng bảng giá nhà xe route 10
   (dữ liệu đầu vào, không phải code).

## Hồi quy (sau fix, local — rung 2/API + unit)

- Unit seed law: AUTO/MANUAL/board-miss/operator-value pins (DispatchPlanCellValues.seeded-fees).
- Editor test: seed cost theo board kèm supplierId ĐĂNG QUÂN; chọn nhà xe sau khi preview về
  vẫn seed; board miss không ghi 0.
- Engine test: keyed miss → MANUAL (không giá đầu bảng khác loại).
- Schema test: login nhận cả `identifier` và `username` (alias legacy, owner order 11/11).

## Round r21 — luật render: số 0 giả đã lưu KHÔNG BAO GIỜ hiển thị (QA FAIL 5079, build 2674caf1)

- BUG: lô 835 (chưa phân xe, bảng giá nhà xe route 10 trống dữ liệu) —
  'Cước trả dự kiến' hiện **0 đậm** ở cả 3 trạng thái (trước/chọn nhà xe/
  đổi qua Dùng biển số), tự mâu thuẫn với helpText '…không ghi 0.'. Seed
  law chỉ xóa 0 khi ask bảng giá nhà xe TRẢ LỜI miss; khi ask không thể
  chạy (thiếu pricing wire / trọng lượng / lớp xe) số 0 đã lưu nằm nguyên
  trong ô.
- EXPECTED: ô để trống thật + helpText nêu thiếu giá — đúng dev-request
  trong FAIL (component không render 0 cho trạng thái trống).
- FIX: `DispatchPlanEditorCell.tsx` — value cost render `0 → ''` (giá thật
  vẫn render như cũ; seed law và cascade chọn-nhà-xe giữ nguyên).
- Pins: editor test mới — stored '0' + không ask → ô trống kèm helpText;
  stored giá thật vẫn render. Lô 835 trả về trạng thái đúng khi owner nhập
  dòng bảng giá nhà xe (route 10 × CONT40 × nhà xe) — data gap đã ghi ở
  round 2, chờ chủ trì.
