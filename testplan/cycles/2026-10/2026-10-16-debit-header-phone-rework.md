# QA-2026-10-16-01 — /shipments-debit phone header rework (owner: "rework this design, especially the button at top page")

Environment: local dev (:3002/:7175). Viewports 390×844, 768×1024, 1440×900. Role ADMIN (managing variant; CUS manages identically per `lib/role-access.ts`), MANAGER read-only variant unit-pinned.

Reproduction (pre-fix): at 390 the header flex row wrapped the two bulk
actions into a stacked clump beside the wrapping visible "Chi phí - Quyết
toán" h1, duplicating the topbar title; both disabled actions read as
identical live buttons.

1. Open `/shipments-debit` at 390. Expected order: customer picker → filter
   strip → action row (Ghép cước thu khách | Xuất Debit Note, two equal 40px
   cells) → list. No visible page h1 (topbar owns the name); no horizontal
   overflow.
2. At 768/1440 the title row is back on top with the actions pinned right on
   the title baseline; h1 visible; no overflow.
3. Disabled faces: with no customer/selection both actions render the neutral
   de-brand (surface-2 + muted ink, no brand fill, full opacity) and carry
   their DisabledActionTip reason on hover/focus.
4. Pick a customer that has a locked lot and tick it: "Xuất Debit Note" turns
   the brand fill (live CTA), "Ghép cước thu khách" stays gated (≥2 ungrouped
   LCL rule) with its tip reason.
5. Keyboard at 1440: tab order runs picker → ribbon → actions → list (one
   bounded visual hop up to the actions row, then down to the table).

Expected: the phone face reads as one column per the two-tier command header
pattern; disabled never reads as live; layout pins in
`ShipmentDebitPage.test.tsx` (sr-only title, 2-col grid, `order: -1`,
DOM-order-after-customer-bar) hold.

Evidence: `frontend/qa/2026-10-16_debit-header-rework_ui-*.png` +
`_ui-driver.log` (measured order, sr-only h1 height 1px, grid "167px 167px",
40px heights, 0 overflow, enabled faces, api identity 200s); gates log +
drift note beside it. Initial: UI DRIVEN at 390/768/1440 incl. enabled
states. The 1440 keyboard pass is PENDING — the shared dev backend (:3002)
went down (another lane's stack) while it was being recorded; the driver
script `frontend/qa/tmp-debit-header-rework.mjs` carries the keyboard phase,
so one run records it. Tab order is structurally pinned by the vitest
DOM-order assertion (picker < header < list).
