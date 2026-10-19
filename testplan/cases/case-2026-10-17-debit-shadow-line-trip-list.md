# Case 2026-10-17 — Chi phí - Quyết toán: the red shadow line names no trip (owner report)

## Claim
On `/shipments-debit` the red line reads
`N chuyến chưa gán đầu việc vận chuyển — X ₫ chưa vào chốt`. The owner's
report: *"wtf is this message for? which chuyen — how user know which chuyen
has this warning"*. The line carries only two scalars — the summary payload
literally has nothing else (`shipmentDebitSummaryResponseSchema` exposes
`excludedCount` + `excludedSum` only) — so the user's only path is to expand
lots one by one hoping to hit the right one, and that path does not exist at
all for MANAGER (read-only rows render "—" instead of "+", and the L2
`UnattachedTripsTable` sits behind `canManage`).

Meaning of the message (unchanged by this fix, card `20260924_2` / Director
ruling F1): trips with `fulfillment_id IS NULL` are excluded from every
chốt-able money column; silent exclusion is banned, so the line states how
much money sits outside. N = trips, X = positive buy-sum, scoped to the same
khách hàng / ngày giao / khóa lô filter as the list.

## Reproduce (pre-fix defect)
1. Local: login `ketoan` (roster `testplan/testaccounts.txt`), open `/shipments-debit`.
2. Read the red line under the filter bar (local all-lots scope: `163 chuyến … 737.700.000 ₫`).
3. Pre-fix: no control anywhere on the line — the identities exist only inside
   a lot's `+` expansion (ADMIN/ACCOUNTANT/CUS only) as
   `UnattachedTripsTable` ("Chuyến chưa gán đầu việc vận chuyển — chỉ hiển
   thị, không vào tổng chốt").

## Expected behavior
1. The line keeps its exact wording, red ink, `role="status"`, and stays
   hidden at `excludedCount === 0` (never a zero-render).
2. When the payload carries trip identities, a trailing **Xem danh sách**
   action (house link-action look, distinct from the static red text) expands
   the list inline: Mã chuyến · lô (Số Bill/Số Booking → Số tờ khai → "—") ·
   khách hàng · ngày chạy · số tiền per trip.
3. Every role that can see the line can open it — no `canManage` gate.
4. Static status text must not look actionable; the toggle must (house tokens,
   `--control-h` hit area, `--brand` focus ring).
5. `excludedCount > 0` with an empty identity list (skew) → plain line, no
   dead toggle.

## Fix (Option A — owner delegated the decision)
- `shared/src/schemas/shipment-debit-summary.ts`: `excludedTripSchema`
  (`tripId, tripCode, shipmentId, lotLabel, customerName, departureDate,
  feeSum`) + `excludedTrips` on the response.
- `backend/src/services/shipment-debit-summary.service.ts`: one grouped
  identity query with the SAME predicates and the same `>0` buy-sum filter as
  the pinned aggregate (aggregate query untouched); `lotLabel` reuses the
  row's own identity chain (`billOrBookNumber || customsNumber || '—'`).
- `frontend/src/pages/ShipmentDebitPage.tsx` + `.css`: `Xem danh sách /
  Ẩn danh sách` toggle (`aria-expanded`) + `<ul>` list beside the line.

Design provenance: Untitled UI PRO `search_components` ×2 (disclosure/accordion
queries) → only slideout/modal overlays — wrong shape for an inline status
line; Tailkit `search_components` ×2 → no hits, `browse_catalog` →
`application-ui/components/list-groups` → `get_component_code
(["a-c-list-groups-01"])` consulted for the label-left/status-right row shape;
Tailkit classes are banned by contract, so rows are rebuilt on house tokens.
Disclosure control follows the house link-action pattern (page's own
`.shipment-debit-row__detail-link` precedent: `--color-primary`, underline)
with the disclosure tokens LedgerRecordList uses for its summary
(`--control-h` hit area, `--brand` focus ring) — `--ink-2` was deliberately
NOT used: the toggle must read as an action, not as static status ink.

## Verification
- BE pin: `backend/src/tests/shipment-debit-summary.test.ts` (shadow describe —
  identity list + zero-shadow empty list) — file green 18/18
  (`npx tsx --test src/tests/shipment-debit-summary.test.ts`).
- FE pin: `frontend/src/pages/ShipmentDebitPage.test.tsx` — file green 32/32;
  full FE suite **648 files / 4965 tests green**.
- **UI DRIVEN (rung 3), 17/17 checks**, local `ketoan` (ACCOUNTANT) +
  `giamdoc` (MANAGER), buildHash `dev`, driver
  `testplan/qa/scripts/2026-10-17-debit-shadow-list-rung.mjs`:
  - `qa/2026-10-17_debit-shadow-list_ui-1-line.png` — line + `Xem danh sách (163)`.
  - `qa/2026-10-17_debit-shadow-list_ui-2-open.png` — after the click: 163 rows,
    `aria-expanded=true`, label `Ẩn danh sách`; first row names the trip the
    API named (lô + khách hàng + ngày + phí).
  - `qa/2026-10-17_debit-shadow-list_ui-3-manager.png` — MANAGER (read-only,
    previously dead-ended) opens the same list.
  - `qa/2026-10-17_debit-shadow-list_ui-4-phone390.png` — phone width.
  - DB read-only proof: trip 6053 + lot 7608 row byte-identical before/after.
  - `qa/2026-10-17_debit-shadow-list_ui-dom.json`, `…_ui-driver.log` (exit 0).
- Gates: FE tsc 0 · root lint 0 in owned files · `make build` 0 ·
  `pnpm check:ui` green · design-drift: owned CSS adds 0 detector hits.
