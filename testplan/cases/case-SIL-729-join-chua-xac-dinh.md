# SIL-729 (id 849) — Chi hộ 7.298.000₫ gom 'Chưa xác định': sửa join phí ↔ lô/chuyến

- Ticket: SIL-729 (board SIL, id 849, tạo 07/11/2026, HIGH). Lane K1.
- Surface: `/accounting/phoi-phieu` (Báo cáo thu/trả phơi), `/debt` +
  `/payables` (Tổng hợp sản lượng vận tải theo tháng) — cả 3 đọc MỘT query
  backend `getPhoiPhieuReport` (phoi-phieu-control.service.ts).

## Bug (kết quả thực tế trước fix)

12 chuyến 7.298.000₫ gom 1 dòng 'Chưa xác định' (báo cáo gốc). Evidence PewPie
07/11 (SIL-741, account hoapt): dữ liệu tăng — **13 chuyến / 7.418.000₫** vẫn
gom 'Chưa xác định', mỗi dòng chi tiết 'Phải thu: Chưa xác định | Phải trả:
Chưa xác định'. Nguyên nhân: bucket step
(:1333-1338) chỉ tra party qua `source.tripId` — phí OPS gắn shipment nhưng
tripId NULL (lô nhiều chuyến, phí chung lô, link chỉ tự gắn khi shipment có
đúng 1 chuyến live) rơi hết vào 1 bucket theo TÊN. Không có fallback
shipment → khách hàng/nhà xe dù `expense_accounting_sources.shipmentId` NOT NULL.

## Luật giữ nguyên (không phá)

- FB-061: khách hàng master đã soft-delete → tên KHÔNG bao giờ in; tiền vẫn
  báo cáo dưới 'Chưa xác định' (LEAK-3 THU); TRA carrier đã xóa danh mục →
  'Đơn vị vận chuyển không còn trong danh mục', KHÔNG phải 'Chưa xác định'
  (LEAK-4). Tiền không bao giờ rơi khỏi báo cáo (audit surface).
- `linkExpenseToRealTrip`: chỉ tự gắn khi đúng 1 chuyến live — luật unique
  candidate; TRA fallback qua shipment phải cùng luật (≠1 chuyến live →
  không đoán).

## Case pin (expected sau thay đổi)

1. THU: phí trip-less có shipment → party = khách hàng operationalName của
   shipment (master live); shipment không còn / master xóa → vẫn 'Chưa xác
   định'.
2. TRA: phí trip-less có shipment với đúng 1 chuyến live → party = tên nhà xe
   theo đúng case-expression hiện có (EXTERNAL/SUPPLIER tên, OWN có BKS →
   'XE NHÀ — SILVER SEA'); 0 hoặc ≥2 chuyến live → 'Chưa xác định'.
3. Phí có tripId → luật cũ giữ nguyên (trip party, fallback deletion).
4. 'Chưa xác định' CHỈ còn chứa: phí không gắn lô nào (shipmentId null về
   mặt logic), master KH đã xóa (FB-061), TRA không xác định được nhà xe.
5. Drill-down party-lots: phí trip-less đã resolve phải hiện trong drawer
   đúng party (bỏ skip trip-less vô điều kiện).
6. Money pin: tổng phí trip-less resolve được phải ra đúng tên; tiền KHÔNG
   bao giờ rơi khỏi báo cáo, mỗi đồng đúng 1 bucket (số đo 07/11: 13 chuyến /
   7.418.000₫ — pin bất biến, không hard-code số dữ liệu).

## Regression evidence

- (điền sau) BE pure-function tests (party resolution + bucket math) +
  giữ xanh `phoi-phieu-party-lots.test.ts` hiện có, qa/2026-11-07-lane-k1/.

## Round 2 (QA fail 08/11, build 9f900f39) — payables còn 5 chuyến / 630.000₫

### Hành vi trước fix

Receivables sạch (Long Minh only) nhưng payables 'Chưa xác định' còn 5 chuyến /
630.000₫ (R3M-D2-A 120k tiền hạ, R4B-3E-FCL1 150k, QBOBD39C 150k, R3Q-680-A
150k, R4B-CC-001 500k phát sinh khác — tripId NULL, shipmentCode CÓ): luật
r2-trước chỉ resolve TRA khi shipment có ĐÚNG 1 chuyến live.

### Luật sau (owner 08/11: CHỈ chi rời KHÔNG gắn lô mới được vào nhóm này)

TRA fallback resolve qua TẤT CẢ live trip của shipment (cùng predicate
expenseTripCandidates: deletedAt NULL, ≠ CANCELED); mọi live trip cùng MỘT
identity nhà xe (partyKind+partyId+name — không so chuỗi hiển thị alone) ⇒
resolve. ≥1 chuyến không resolve được / khác nhà xe / 0 live trip ⇒ giữ
'Chưa xác định' (phí chung lô không đoán chia cho nhiều nhà xe). liveTripId
chỉ khi unique (drill-down bookable); multi-trip resolve → key shipment tổng
hợp (display-only). Pin: `phoi-phieu-shipment-fallback.test.ts` (r2 pins).

### Case pin (r2)

1. Shipment 2 live trip CÙNG nhà xe + phí chi hộ trip-less ⇒ bucket đúng tên
   nhà xe (trước đây rơi 'Chưa xác định').
2. Shipment 2 live trip KHÁC nhà xe ⇒ giữ 'Chưa xác định'.
3. Shipment có 1 live trip không resolve được carrier ⇒ giữ 'Chưa xác định'.

## Round 4 (09/11/2026 — build e6db602f vẫn FAIL, QA comment 4702/4712)

- **Số liệu:** 'Chưa xác định' PHẢI TRẢ đứng yên 5 chuyến / 630.000₫ qua r1
  (3c2057aa) và r2 (75774f47) — bucket trả về không đổi trên staging.
- **Root cause r4 (mổ xẻ code, đúng 5 chuyến không ăn):** r2 chỉ resolve TRA
  qua live trip ĐỌC bằng `trips.shipment_id = shipment` — nhưng
  `trips.shipment_id` NULLABLE: chuyến có thể nối lô CHỈ qua
  `fulfillment_id` (đúng union `coalesce(trips.shipmentId,
  shipmentFulfillments.shipmentId)` mọi chỗ đọc khác đã dùng, card
  191026100030). Lô 0 live trip (mọi chuyến đã CANCELED — đúng shape Hủy phân
  xe SIL-753 để lại) cũng không có gì để all-agree. Trong khi đó lô VẪN giữ
  sự thật nhà xe ở `shipment_fulfillments` (plannedCarrierType /
  plannedExternalCarrierId / plannedVehiclePlateNumber — '4GS / Chờ bổ sung
  biển' kẹt lại sau hủy). ⇒ join cũ cụt ở 2 lỗ này, đúng các lô đã qua
  re-dispatch/hủy chuyến.
- **Fix r4 (luật owner giữ nguyên: CHỈ chi rời không gắn lô mới vào 'Chưa
  xác định'):**
  1. Live-trip read của fallback dùng union
     `coalesce(trips.shipmentId, shipmentFulfillments.shipmentId)` — chuyến
     nối qua fulfillment không còn vô hình.
  2. Khi trip-level không resolve (0 live trip / không all-agree), fallback
     đọc carrier fact của lô từ live fulfillments (canceledAt NULL) với cùng
     luật all-agree: EXTERNAL + plannedExternalCarrierId → tên nhà xe
     (operational label, isCarrier ACTIVE, soft-delete law); OWN + BKS →
     'XE NHÀ — SILVER SEA'. Fulfillment chưa phân xe (OWN không BKS / null)
     hoặc nhà xe ngoài đã xóa danh mục ⇒ không đoán ⇒ giữ 'Chưa xác định'.
  3. liveTripId vẫn chỉ khi unique live trip (drill-down bookable);
     fulfillment-resolve → key shipment tổng hợp.

### Case pin (r4)

1. Lô có live trip nối CHỈ qua fulfillmentId + phí chi hộ trip-less ⇒ bucket
   đúng tên nhà xe (trước đây 'Chưa xác định').
2. Lô 0 live trip (mọi chuyến CANCELED) nhưng fulfillment còn gán 4GS ⇒
   bucket '4GS' (đúng fact lô; trước đây 'Chưa xác định').
3. Lô chưa bao giờ phân xe (OWN không BKS, null type) ⇒ giữ 'Chưa xác định'
   (không có fact để nói).
4. Fulfillments của một lô KHÁC nhà xe nhau ⇒ giữ 'Chưa xác định'.
5. Nhà xe ngoài đã soft-delete ⇒ giữ 'Chưa xác định' (FB-061 class: master
   chết không in tên).
6. Trip-level all-agree vẫn thắng trước (ưu tiên luật r2 nguyên vẹn).

## Round 6 (09/11/2026 — build 7c7db25c, verdict round 5 FAIL a129994c)

- **Mổ xẻ staging DB thật (read-only, qa/2026-11-09_sil729-r6_staging-*.txt):
  bucket TRA còn lại = 7 nguồn trip-less / 1.560.000₫ trên ĐÚNG 4 lô, TẤT CẢ
  đều KHÔNG có fact nhà xe nào theo luật hiện hành** — SHP-2611-00315 (ful
  OWN không BKS = shape 'Chưa phân xe' SIL-753), SHP-2611-00322 (lô đã
  soft-delete, ful duy nhất canceled 'Shipment deleted'), SHP-2611-00392 (2
  ful chưa bao giờ được gán xe), SHP-2611-00589 (lô trộn 2 xe nhà + 1 ngoài).
  3 lô đầu là data probe QA tái tạo (note 'R3Q-680-A ops expense',
  'R3Q-679r2 gate probe', 'R4B-3E FB-033c' — bl/booking trùng đúng các lô
  fixture ĐÃ purge, không mang token QA nên không bao giờ bị qapurge). Số
  verdict round 5 (5/630.000₫ + 9/1.830.000₫) = ĐÚNG số của build trước-r4a
  (e6db602f, comment 4720) + 2 dòng fixture (R3B-BILL01/02, K4KFP-M4) đã bị
  purge lúc ~10:20Z — không reproduce được trên build live (API 10:26Z: 3/360k
  + 7/1.56M). Không còn lỗ join — join đã đúng sau r1+r2+r4a.
- **Luật mới (dev ruling 09/11, theo Spec KB 'Chưa xác định' = CHỈ chi rời
  KHÔNG gắn lô; NGHIÊM CẤM gom chuyến có lô vào dòng này):**
  1. TRA: lô gắn tiền mà 2 luật carrier không đặt được TÊN NÀO (chưa phân xe /
     chưa ever-planned / trộn nhiều nhà xe / 0 live fulfillment) ⇒ phí in theo
     TÊN LÔ (mã SHP-…; draft không code ⇒ `Lô #<id>`; partyId/partyKind null —
     không phải ledger entity, không join sổ phải trả theo id). KHÔNG bịa tên
     nhà xe. THU nguyên vẹn — FB-061 giữ tiền khách master chết ở bucket lạ.
  2. Nguồn gắn lô ĐÃ SOFT-DELETE ⇒ LOẠI KHỎI BÁO CÁO toàn bộ (cả 2 chiều,
     cả 2 cửa sổ kỳ) — reportSources join shipments.deleted_at IS NULL.
  3. Data probe trên staging: soft-delete 4 lô (809/816/889/1108) — khôi phục
     được qua deleted_at.
- **Case pin (r6)** (unit pins: `phoi-phieu-shipment-fallback.test.ts` r6):
  1. Lô sống chưa phân xe / trộn xe + phí chi hộ trip-less ⇒ dòng theo mã lô,
     KHÔNG phải 'Chưa xác định' (trước đây bucket).
  2. Phí gắn chuyến có carrier không resolve ⇒ cũng rót về party theo lô.
  3. Phí gắn lô soft-deleted ⇒ không còn dòng nào trong báo cáo.
  4. Lô có fact (all-agree trip / fulfillment planned) ⇒ vẫn ra đúng tên nhà
     xe trước luật lô (thứ tự luật giữ nguyên).
  5. THU + khách master chết ⇒ vẫn 'Chưa xác định' (FB-061 nguyên vẹn).
