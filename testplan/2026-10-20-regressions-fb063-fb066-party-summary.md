# Regression wave 1020b — FB-063 header wrap + FB-066 quick-add + party summary short-name (20/10/2026)

Cards: 201026101500 · 201026101600 · 201026095604b.
Branch `fix-regressions-1020b` (off `main` = `00bc24ed`). Browser evidence under
`qa/2026-10-20-regressions/` (before/after per card).

## Case TC-201026101500 — FB-063: /shipments/new bảng container header wrap 2 dòng

- Repro (role ADMIN/clerk): mở `/shipments/new`, FCL mode, xem header bảng
  "Danh sách container" (`ShipmentContainerEditor` → `.csc-container-table`).
  Trên build 8bfa2ac7 các nhãn cột ("Trọng lượng (kg)", "Cảng nâng/hạ"…) wrap
  2 dòng.
- Root-cause: `.csc-container-table thead th` đặt `white-space: normal` (từ
  b6e49f27) — chưa từng mang luật 1 dòng của FB-063/R17
  (`table-sort.css` chỉ áp cho nút sort). Các commit nghi ngờ được thẩm:
  65acec44 (chỉ accounting debit), f240f90e/00bc24ed (chỉ node_modules
  symlinks + .gitignore) — không chạm surface này.
- Expected: MỌI nhãn cột header luôn 1 dòng (luật FB-063 card 181026021137,
  R17 standard): `white-space: nowrap` + cột/min-width đủ chỗ để không cắt
  chữ. Pin styles test như TripListPage.styles.test.ts.

## Case TC-201026101600 — FB-066: mất nút "+ Thêm nhanh biển số xe"

- Repro (role OPS/dispatcher): các surface quick-add hiện có —
  `/trips/new` TripInfoCard (Xe đầu kéo/Lái xe), dispatch detailed-plan
  editor (Xe / biển số), LCL Gán xe nhóm / Đổi BKS nhóm. Trên build 8bfa2ac7
  nút biến mất ở surface QA khai báo.
- Root-cause: xác định bằng browser repro + git log từng surface; mã nguồn
  tại HEAD (b51d063b, c58ff01c, 22c9c80b) vẫn chứa nút — nghi lỗi điều kiện
  render/visibility runtime hoặc surface-specific regression.
- Expected: nút "Thêm nhanh" cạnh selector hiện lại đúng điều kiện
  (OWN fleet / external carrier đã chọn), không phá điều kiện cus-display.

## Case TC-201026095604b — Party summary tên ngắn (MAJOR review finding)

- Surface: `/debt` + `/payables` → `PartyMonthlyProductionSummary`
  (tổng hợp sản lượng theo tháng). Hiện "Chủ xe" hiển thị tên đầy đủ.
- JOIN ANALYSIS (bắt buộc trước khi code):
  - Hôm nay `conNo = ledger.get(party)` join THEO TÊN STRING: THU party =
    `customers.name` (đầy đủ) vs aging `customerName` (đầy đủ) — khớp nhờ
    cùng cột; TRA party = `operationalName(shortName, name)` (ngắn!) vs
    payables `supplier.name` (đầy đủ) — đã LỆCH whenever shortName tồn tại.
  - Derive-by-string (cắt "CÔNG TY…" khỏi display) = trùng tên/không khớp
    khi join aging/party tables → cấm.
  - Fix: backend `getPhoiPhieuReport` row thêm `partyId` + `partyShortName`
    (+ `partyKind` carrier/vendor cho TRA); FE join theo ID (aging
    `customerId`; payables `supplier.id` + `kind`), fallback theo tên cho
    row không resolve được ID ('Chưa xác định', xe nhà, legacy).
  - Aging (/debt bảng chính) + party summary phải vẫn đối soát: cột Còn nợ
    = Tổng nợ của cùng khách/NCC (card 380 test), giờ bằng ID join — chắc
    hơn tên.
- Expected: cột Chủ xe hiển thị tên ngắn (shortName ?? name), tooltip giữ
  tên đầy đủ khi khác bản hiển thị; conNo vẫn khớp ledger; test unit mới
  cover ID join + fallback + hiển thị.

## Verdicts (2026-10-20, end of run)

| Case | Verdict | Evidence |
|---|---|---|
| TC-201026101500 FB-063 | **FIXED — UI DRIVEN** | Before: `qa/2026-10-20-regressions/fb063-before-header-1440.png` + `repro-before-probe.log` ("Loại container", "Trọng lượng (kg)" 2 dòng ở 1440/1366/1280). Root cause: `white-space: normal` trên `.csc-container-table thead th` (b6e49f27, 11/10) + cột type 104px/weight 96px hẹp hơn nhãn (đo 122/141px, `fb063-label-widths.json`). Các commit nghi ngờ được thẩm và loại: 65acec44 (chỉ accounting), f240f90e/00bc24ed (node_modules symlinks + .gitignore). Fix: nowrap law + type 124px + weight 144px + min-width 1108px; styles test pin law 1 dòng. After: `fb063-after-header-1440.png` + `fb063-after-driver.log` — 9/9 nhãn 1 dòng, 0 shear, pass:true ở cả 3 width. |
| TC-201026101600 FB-066 | **NOT REPRODUCED at HEAD — 3/3 surfaces UI DRIVEN PASS** (8bfa2ac7 là ancestor của HEAD; không có commit nào trong 22c9c80b..HEAD chạm quick-add chain) | (1) R23 surface "Gán xe nhóm" (/dispatch, dieuvan): driver `_2026-10-19-fb066-quickadd-rung.mjs` retarget localhost — exit 0, "FB066-quick-add-present pass", shots `qa/2026-10-20-regressions-fb066-master/fb066-0{1,2,3}-*.png`. (2) Dispatch detail editor (/dispatch-detail, dieuvan): dialog mở, nút render+visible, click mở "Thêm nhanh biển số xe" (`fb066-dispatch-rung.log`, shots `fb066-before-dialog-*.png`). (3) /trips/new (admin): 2 nút "Thêm nhanh" cạnh Xe đầu kéo/Lái xe + dialog (`fb066-trips-new-admin.log/.png`). Ghi chú điều kiện: nút chỉ hiện khi nhà xe đã chọn (thiết kế: plate đăng dưới nhà xe) — row "Chờ phân xe" chưa chọn nhà xe không có nút là đúng thiết kế, không phải regression. OPS không vào được /trips/new (route adminOnly — law). Không fabricate fix thỡ (precedent FB-030/075 verify-fail 63a3dfc4). |
| TC-201026095604b party summary | **FIXED — UI DRIVEN + wire verified** | Join analysis xác nhận: TRA party đã là tên ngắn (operationalName) từ trước ↔ payables `supplier.name` là tên đầy đủ → join theo tên ĐÃ lệch sẵn whenever shortName tồn tại; THU full↔full khớp nhưng đổi display sang ngắn sẽ phá. Implement: BE row +`partyShortName`/`partyId`/`partyKind` (grouping + tiền giữ nguyên); FE join ID-first (aging `customerId`; payables `supplier.id` scoped theo `kind` carrier/vendor), name fallback cho row không ID; merge THU+TRA theo canonical entity key (`customer:`/`vendor:`); display = shortName ?? name, tooltip giữ tên đầy đủ. Unit 14/14 (5 case mới: display+tooltip, ID-wins-over-name, kind-scoped payable, dual-role merge 1 row, name-fallback). Wire rung-2: THU `{partyShortName, partyId 233473, partyKind customer}`, TRA `{partyId 233474, partyKind carrier}`. Rung-3 before/after (fixture isolate 2026-08-20, cleanup sạch): before cell "CÔNG TY TNHH MTV R20B-…" → after "R20B-… MINH", tooltip full, 0 legal-leak — `party-summary-before-after.log` + 2 PNG. |

## Gates (end of run)

Xem `qa/2026-10-20-regressions/gates.log`: BE tsc 0 · FE tsgo -b 0 · lint 0 ·
BE tests 326/326 · FE scoped 221/221 · FE full 5265/5265 (sau `make build` cho
2 dist-pin tests — hành vi đã biết) · `make build` OK.
