# Regression plan — CUS-08 + CUS-07 + CUS-03 (QA tickets 211026125242 / 211026125715 / 211026125815, 21/10)

Scope: CUS workspace weight display, factory info collapse (create form), bulk appointment copy (create form).
Local-only verification (:7175 / :3002); staging untouched.

## Case CUS-08 — TRỌNG LƯỢNG renders in tấn, no dead decimals

- **Reported:** customer doc writes weights as "5.000" / "18.500" and wants "5" / "18,5".
  Root cause: `cargo_weight_kg numeric(10,2)` (e.g. `21000.00`) rendered through
  `formatQuantity`/`toLocaleString('vi-VN')` as "21.000" — the vi-VN thousands dot reads
  as dead decimals; the business unit for container weights is TẤN (BaoGia: "≥ 20 tấn là nặng").
- **Fix:** shared display formatter `formatWeight` (lib/format) now converts kg → tấn
  (÷1000), vi-VN decimal comma, up to 3 fraction digits, trailing zeros dropped.
  All weight display surfaces route through it; unit-bearing labels/headings updated.
- **Expected:** stored `18500.00` → "18,5 tấn"; `5000` → "5 tấn"; `4000.00` → "4 tấn";
  `1922` → "1,922 tấn"; null → "—"; non-numeric → verbatim echo. Entry inputs stay kg
  (display-only change; data/API untouched). Driver journey-board card stays kg
  (pinned by card 20261004_356). Known display rounding: the 3-fraction cap is
  kg-INTEGER precision — a stored sub-kg tail (e.g. 41000.75 kg) shows "41,001 tấn",
  same accepted cap as formatVolumeCbm.
- **Verification:** `formatWeight` unit cases + render assertions
  (CusContainerLedger header/cell, CusShipmentRow metric, ShipmentDetailPage fact,
  MasterPlan/DetailedPlan lines, AssignTruckGroupDialog fit line) + UI drive evidence.

## Case CUS-07 — Nhà máy collapsed to short name + detail peek

- **Spec:** MasterDataNhaMay (doc khách Phần 1) §2.3/§5 — cells/lists prefer tên ngắn;
  full name, address, contact, invoice info readable on demand.
- **Current state (verify-first):** ALREADY IMPLEMENTED in the create form —
  factory cell shows `shortName || name`, an Info button opens FactoryDetailPopover
  (full name, address, phone, Hóa đơn cẩu phí: Tên/Địa chỉ/MST). CUS row shows short
  names only. No gap found → no code change; UI evidence captured.
- **Expected:** create-form factory cell never prints the street address inline; the
  popover carries address + MST.

## Case CUS-03 — copy NGÀY GIAO to ALL containers (create form)

- **Reported (211026125242):** QA needs one click that gives EVERY container in the lot
  the same ngày giờ đóng trả (overwrite included). Existing affordances fill EMPTY rows
  only ("Áp dụng cho N container", "Copy giờ hẹn xuống cont trống", row hover icon).
- **Fix:** new section button "Copy giờ hẹn cho tất cả N cont" beside the copy-down
  button — visible when a scheduled source row exists and the lot has ≥ 2 containers;
  stamps the source appointment on every row (partial drafts included), toast confirms.
- **Expected:** 3-cont lot with rows [set 20/09 09:00, set 21/09 11:30, partial] → one
  click → all three rows show 20/09 09:00; toast "Đã copy ngày giờ đóng trả cho tất cả
  3 container". Draft-affordance only: no submit, no DB write.
