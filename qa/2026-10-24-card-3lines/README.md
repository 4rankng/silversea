# QA — Card mobile 3-dòng + dynamic action slot (issue #13)

Scope: `/dispatch-detail` phone card list (<640px) —
`DispatchPlanCardList.tsx` + `DetailedPlanGrid.css` (dpcard band) +
`DispatchRowActionsMenu.tsx` (optional props only) + tests. Desktop table
KHÔNG đổi (chỉ đọc, không đụng). Read-only UI change — no API/DB writes.

- Environment: local dev (`make dev` stack — BE :3002, PG :5441), FE BEFORE =
  trunk checkout `322e8ebf` on :7187, FE AFTER = this worktree on :7186.
  Account: DISPATCHER `dungnv` (testplan/testaccounts.txt). Viewport 390×844
  @2x, isMobile + hasTouch (coarse pointer ⇒ the global touch band applies).
- Driver: `qa/scripts/2026-10-24-card-3lines.mjs` — exit 0, 35 PASS / 0 FAIL
  (`card-3lines_ui-driver.log`). Specimens: fid 170 (READY+plate, Bill
  ASKVH0B6353674), fid 41 (DISPATCHED trip 34, Bill 20SEA26092001), fid 12
  (COMPLETED trip 3, Bill EGLV149607019409) — deep link `?q=<bill>&date=…`.
- Data identity / persisted-state proof (read-only): `db-persisted-state.json`
  — API rows (taskStatus/plate/driver/phone/tripId) + DB select of
  `shipment_fulfillments` × `shipments` × `trips` for the 3 fids; no row
  changed across the run.

## BEFORE evidence (the defect class, owner screenshots 23/10 tối)

- Joined one-line run `15H-021.39 · Dương Văn Thực · 0985246985`
  (`.dpcard__line--vehicle`) on every card; `before_*.png`.
- Unissued card carried TWO action buttons (paper-plane + ⋯):
  `actionButtons=2 ["Thao tác dòng · AXEU2004033","Phát lệnh · AXEU2004033"]`.

## AFTER (all driver asserts green)

- 3-dòng info block (BUTTON on live rows, DIV on completed): BKS semibold +
  inline `Xe {class}` · `Tên ·` + SĐT (nowrap, own node, `scrollWidth ≤
  clientWidth` ⇒ never ellipsized; `0985 246 985` / `0964 496 330`) ·
  `Loại lô · Nâng → Trả` (schedule line stands in when both sides missing).
- Dynamic action slot: unissued = 1 paper-plane (no ⋯ trigger; tap info block
  opens the ⋯ menu — `after_card-thuong_menu-tap.png`, menu text "Sửa điều
  phối / Xóa lô"); issued = 1 ⋯ (no paper-plane); completed = no action
  (modifier `dpcard--completed`, info static). Card-tap button labelled
  `Mở thao tác dòng · X` (distinct from the ⋯ trigger's label — review m2).
- Touch floor: slot buttons measured 44×44 (the global `@media (pointer:
  coarse) :is(#root, body) button` band at (1,0,1) had been clamping the old
  GP-06 44px floor to the 40px token — fixed with a documented `#root`
  specificity lift for the card controls only).
- Status chip dot-leading (house `StatusText`) outside the info block:
  "Đã điều xe" / "Đã phát lệnh cho tài xế" / "Đã hoàn thành".

## Independent review round (post-first-driver)

- Reviewer verdict DONE_WITH_CONCERNS → all pre-land findings fixed in the
  changeset: M1 quick-issue error now routes to the shared toast via
  `QuickIssueOrderButton.onError` (no text in the 44px slot; inline
  role="alert" paragraph stays the default for full-width hosts); m2
  card-tap label de-duplicated; m3 stale openRequest guard when the target
  row unmounts; +2 tests (schedule fallback of dòng 3, AWAITING_PLATE slot).
- Follow-ups recorded, NOT in scope (pre-existing behavior): aria-expanded
  on the card-tap button (needs menu onOpenChange plumbing), focus/arrow-key
  roving inside the portalled ⋯ menu, dead `variant="labeled"` branch of
  QuickIssueOrderButton.

Final driver re-run against the post-review code: exit 0, 35 PASS / 0 FAIL.

## Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| C3L-01 3-dòng info + SĐT full không truncate (390px, 3 states) | UI DRIVEN | after_card-thuong.png, after_da-phat-lenh.png, after_hoan-thanh.png; driver log phoneText/nowrap/notEllipsized asserts; infoLineCount=3 | viewport khác (768/1440 là desktop table — ngoài scope card); LCL nhóm có `Xe 3.5T` chỉ assert bằng unit test (không có specimen LCL nhóm trong DB local); không xem ảnh bằng mắt (model không đọc ảnh — DOM đo đạc là bằng chứng) |
| C3L-02 unissued: đúng 1 nút paper-plane, KHÔNG ⋯, tap card mở menu | UI DRIVEN | after_card-thuong.png + after_card-thuong_menu-tap.png; slotLabels=["Phát lệnh · …"], triggerPresent=false, menu "Sửa điều phối…Xóa lô" | đường lỗi phát lệnh (không bấm Phát lệnh thật — sẽ ghi DB); AWAITING_PLATE (external deferred) chỉ cover bằng unit test |
| C3L-02 issued: slot = ⋯ duy nhất, không paper-plane | UI DRIVEN | after_da-phat-lenh.png; slotButtonCount=1, trigger=true, issueBtn=false, 44×44 | bấm mục menu (Phân xe lại/Xóa lô) không thực thi — read-only QA; Hoàn thành (xe ngoài) chỉ cover bằng unit test (không có specimen external live trong trang 1) |
| C3L-02 completed: không nút, dòng 1-2 dim, info tĩnh | UI DRIVEN | after_hoan-thanh.png; slotPresent=false, completedModifier=true, infoTag=DIV | timestamp hoàn thành 'Giao … · POD' KHÔNG render — row shape không projection completedAt/POD ("nếu có" trong spec); cần card riêng nếu owner muốn |
| C3L-03 chip góc phải ngoài info block | UI DRIVEN | chipInInfo=false + chipText asserts trong driver log (3 states) | UNASSIGNED rows (chip null theo luật component) |
| Touch ≥44px mọi nút card | UI DRIVEN | rects=[{w:44,h:44}] mọi state có nút (driver log) | nút trong dialog (ngoài scope) |
| Persisted state không đổi (read-only) | DB/API VERIFIED | db-persisted-state.json (API rows + DB select trước/sau) | không applicable — không write path |
| Desktop table ≥640px giữ nguyên | CODE-READ ONLY | không sửa DetailedPlanGrid.tsx/table markup; scoped suites DetailedPlanGrid.* 98/98 xanh | không chụp 1440 (ngoài scope brief: "desktop table GIỮ NGUYÊN") |

## Explicitly out of scope (recorded, needs own cards)

- Menu items in the approved spec that have NO existing flow on this surface
  were NOT rendered as dead triggers (no-stub law): In phiếu, Theo dõi GPS,
  Hủy lệnh (cancelTrip API exists, no UI flow), Xem e-POD (driver-only
  screen), Xuất biên bản. "Hoàn thành" (xe ngoài) DID move into the ⋯ menu.
- Completion timestamp on dòng 3 needs a BE row-shape projection
  (trips.completedAt) — not faked client-side.
