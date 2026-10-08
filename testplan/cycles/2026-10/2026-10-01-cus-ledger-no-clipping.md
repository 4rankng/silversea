# QA-AUDIT-UI-08 — CUS ledger captions and missing identifier

1. As CUS/ADMIN open existing BillQA-WF04-114144 shipment2366 drawer at1280/1440/390.
2. Read missing-container text and adjacent Trọng lượng/Giờ hẹn headings. Compare actual ISO identifier in another existing row.
Expected: descriptive missing text is fully visible and wraps normally; real ISO identifier remains on one line. Headers fit within percent tracks with normal word wrapping, without touching adjacent heading. Container alignment, ids, accessible row name, status and financial policy unchanged.
Design provenance: existing ledger grid, no new table skin. UntitledCLI v8 modal/button-utility queried; controller consulted official Table reference.
