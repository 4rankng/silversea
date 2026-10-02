# QA-AUDIT-UI-31 — phone records without offscreen columns

1. At local390 /accounting/phoi-phieu, capture original12-column board/horizontal hidden amounts and notes. New stacked records show real Bill/Booking, container/date/status and key amounts; remaining exact values become visible through native Chi tiết. Never substitute internal trip/shipment IDs.
2. Click a confirmable record checkbox: selected count/issue eligibility updates. Toggle it off. Locked records remain unselectable. Clicking summary, nested chi-ho/tien-duong controls and other interactive values never changes selection; keyboard Space on native checkbox toggles once.
3. Expand details, open Chi tiết chi hộ and Tiền đường, Cancel/close actual dialogs. API/DB amounts/status/version remain unchanged. Existing report scopes, filters, bulk controls and API payloads retain contracts.
4. More than20records: page1 shows1–20, page2 shows21–40 (or terminal count); all records reachable, stable selection across pages, list shrink resets/clamps the visible page. Filter/page state may not leak a stale record batch.
5. At768/1440 no phone records mounted; existing desktop matrix/action/rowselection remain. At390 no desktop horizontal board or swipe prompt is visible, and expanded facts remain within viewport.
6. Monthly payable/receivable summaries use same phone records including grand totals and all original amount/note/aggregate fields; tablet/desktop keep existing tables. Screenshot after actual click, DOM assertions, read parity/DB proof and exact driverexit are required per claim; list missing/error/staging paths honestly.

Continuation2026-10-01: check:ui rejects the selected header border-left despite neutral ink. Replace only this selected edge with sanctioned inset3px0 ink, keep opaque white/checkbox/disclosure and rerun actual selected record plus check:ui. Preserve prior red artifact.

Accepted final selection continuation: root independently found the inset was canceled by the global flat-surface band. Keep visible neutral ink Panel border + actual checked checkbox only; remove the ineffective inset rather than overriding the shared flat rule. Capture actual selected border/checkbox and preserved disclosure state before renewed freeze.
