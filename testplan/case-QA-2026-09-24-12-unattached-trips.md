# Case QA-2026-09-24-12 — L2 unattached-trips section (card `20260924_3`)

- **Case ID:** QA-2026-09-24-12
- **Reported:** 2026-09-24, card `20260924_3` (Director ruling 12:10: unattached trips RENDER in L2,
  display-only; BE half 639c9116; FE half this landing).
- **Verbatim ruling (Director):** "Rendering unattached trips inside L2 is the eventual right shape"
  + "chốt semantics for unattached work" — money visible, never chốt-able.
- **Surface:** Chi phí - Quyết toán L2 (ShipmentDebitWorkspace) — new display-only section after
  Bảng 2.3: "Chuyến chưa gán fulfillment — chỉ hiển thị, không vào tổng chốt".
- **Mutation surface: NONE.** Display-only section; no edit affordances.
- **Status:** case PREPARED — FE landed; rung disposition below.

## Steps

1. Census a lot whose debit-detail carries unattachedTrips (active trips with fulfillment_id NULL).
2. Open the lot's L2 workspace; scroll below Bảng 2.3.
3. Verify the section: caption verbatim; per trip: Mã chuyến (tripCode, '—' when null; never a DB
   id), Ngày chạy, Trạng thái, Phí phát sinh items (feeName ?? expenseType; amounts Chưa xác định
   when null; Thu khách when present; HD numbers), Tổng phí chuyến, and "Ngoài chốt" per trip.
4. Cross-check the payables totals (Bảng 2.3 footer / L1 totals) are UNCHANGED by the section.
5. Lot without unattached trips → the section does not render at all.
6. Full-page matrix 1280/1440/1920/2560 + 390 of the section state.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | Section hidden entirely when unattachedTrips is empty (never zero-render). |
| 2 | Per-trip rows show business keys only; amounts honest (null = Chưa xác định, never 0). |
| 3 | "Ngoài chốt" visible per trip — the chốt exclusion is displayed, not silent. |
| 4 | Payables/chi-hộ totals identical with and without the section (display-only by construction). |

## Rung disposition (2026-09-24)

FE landed (`<sha>`); component suite 3/3 pins hidden-at-empty + verbatim rows + chốt semantics;
workspace suite green. Live browser rung OWED pending a fixture lot carrying unattached trips on the
reseeded local DB (all current fixture trips are attached) — will ride the staging QA rung of cut #3
where real data exists, per the Phase B precedent.
