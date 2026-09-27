# CUS selected reference replacement — customer video 00:03

## VID-CUS-16 — clear, search and replace selected values

Role: CUS. Surface: `/shipments/new`. Viewports: desktop and phone.

1. Select a customer and factory, route, lift port and drop port on one container.
2. For each editable selector, select all text and delete it. Type a different search term and choose a replacement. On phone also use the clear control.
3. Save the shipment and reopen its container details.

Expected: clearing removes the selected entity ID; typing filters options without requiring scrolling through the old selected list. Choosing a replacement persists the replacement ID. An incomplete draft may retain a missing field, but must never silently submit the old ID. Each selector remains usable by touch and keyboard.

Route constraint: a factory with a configured canonical route continues to supply that route. Test editable route replacement with a factory without a configured route; changing the factory must not retain an incompatible factory ID. This case does not relax master-data integrity rules.

Evidence: `qa/2026-09-15_customer-video/` and the `REQ-CUS-008` acceptance matrix entry.
