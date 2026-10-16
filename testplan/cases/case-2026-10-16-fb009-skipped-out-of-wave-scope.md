# FB-009 (card 131026233500) — SKIPPED as out of wave scope

> **Superseded 2026-10-16 (second attempt).** The card body was recovered from
> the Google Drive kanban export and the two surfaces it names — the
> *Chọn ngày giờ* dialog and the *Lịch & ghi chú* group — are now fixed; see
> `case-2026-10-16-fb009-copy-time-dialog-and-section.md`. The wider surface
> census below (outside this card) remains open.

**Status: skipped, not fixed.** Documented per the W5 brief ("if any card turns
out to be large/unclear, skip it, document why, move on — breadth first").

## Why

The card body is unreadable — `131026233500-fb009-verify-fail-nut-copy-thoi-gian-van-thieu.docx`
is 0 bytes (not a valid zip; `unzip -p` finds no central directory). All five W5
card files are empty, so the card's own steps-to-reproduce and expected result
are unavailable.

Scope was reconstructed instead from the landed fix and its regression record
(`testplan/cycles/2026-10/2026-10-14-ui-regression-batch-fb009-043-048-057-061-066.md`,
case B1) plus a full census of appointment render sites in `frontend/src`.

That census shows the fix covers 3 call sites and **7 genuine gaps remain**
across 6 components:

| Surface | file:line |
|---|---|
| CUS dashboard list ("Lịch trình & điều xe", one line per container appointment) | `features/shipments/cus/CusShipmentRow.tsx:112-114` |
| Chi tiết container ledger ("Lịch trình") | `features/shipments/detail/ShipmentContainerLedger.tsx:946` |
| Shipment detail ("Lịch giao" fact, phone + desktop) | `features/shipments/detail/ShipmentDetailContainers.tsx:22` |
| Dispatch container drawer ("Giờ hẹn đóng/trả") | `features/dispatch/master-plan/DispatchContainerDetailDrawer.tsx:108` |
| Dispatch master-plan grid ("Thời gian & lịch trình") | `features/dispatch/master-plan/MasterPlanGrid.tsx:376-380` |
| Customer portal shipment detail ("Lịch giao") | `pages/portal/PortalShipmentDetailPage.tsx:203` |
| Dispatch detailed-plan schedule cell — **weak, usually renders `plannedEndAt`, not the appointment** | `features/dispatch/detailed-plan/DetailedPlanGrid.tsx:359` |

Each site needs the button plus its own toast plumbing — the landed sites raise
the toast through the `onCopied` prop, and surfaces 1/3/4/5/6 have **no toast
provider wired at that level**, so each needs its host resolved (the pattern at
`CusContainerLedger.tsx:549` and `ShipmentCreateWorkspace.tsx:477`).

That is 6 components + toast wiring + regression pins, not a "small quick fix".

## Notes for whoever picks it up

- **Highest reach, lowest risk:** `CusShipmentRow.tsx:112-114` — the default
  CUS landing screen, and it renders one line per container appointment, so a
  multi-container lot shows 2–3 times per row.
- **Most likely source of the re-report:**
  `ShipmentContainerLedger.tsx:946`. Its actions column (`:1026`) already
  renders a button labelled **"Copy giờ hẹn"**, but that is a server-side
  copy-DOWN onto unscheduled siblings (`canCopyFrom`, `:748-750`) — gated to
  vanish when no sibling lacks a schedule, and it never touches the OS
  clipboard. A clerk finds "Copy giờ hẹn", concludes the feature exists, and
  still cannot paste the time anywhere. Do **not** reuse that button; the two
  are different features and the naming collision is part of the confusion.
- Skip `DetailedPlanGrid.tsx:359` unless the product rules it in.

## Reproducing the card body

The `.docx` files were written empty on 2026-10-16 12:14 and never filled
(only 6 of 44 cards in that directory have content). Regenerating the card
export would unblock this one; the four cards fixed in this wave were scoped
from their landed fixes and regression records instead.