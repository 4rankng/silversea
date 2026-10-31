# uiux POLISH verdict — SIL-621 popup text removal (2026-10-31)

Scope: LotRevFactsEditor («Sửa cước thu khách» popup, Chi tiết lô hàng ledger)
+ shared lock helper + debit strip consumer. Touch-up class (POLISH): props
removal only, no new layout, no token/CSS changes.

## Findings (path:line)
- frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:294-317 —
  popup now: labelled select + labelled price input (placeholder giữ luật
  auto-trace) + Lưu/Hủy. Labels, values, keyboard access retained; disabled
  states announced; fewer elements than before → no clip/wrap risk.
- frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:259-289 —
  a locked lot never dead-ends silently: a refused save still surfaces the
  server's 409 message inline (role=alert; pin: 'save lỗi (BE 400)' test).
- frontend/src/features/shipments/debit/DebitLotLclFacts.tsx:261,283-317 —
  cost-locked strip loses the hint text but the NHÓM GHÉP block still names
  «Ghép (n/m)» / «Ghép cùng Bill X» + Hủy ghép button — tách-nhóm affordance
  stays discoverable. rev-locked keeps its hint (not in ruling scope).

## Design provenance (§3 required)
Deletion-only change; house primitives untouched (USearchableField + NumberField
+ EditActions). No catalog consult required — nothing was invented or restyled.
Aligns with owner density law («compact facts and useful content density») and
the no-lecturing-copy direction (design law §8 reference in
AssignTruckGroupDialog.tsx:503).

## Verdict
Approve — no finding rises to Block.
