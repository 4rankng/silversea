# QA-AUDIT-UI-07 — settlement table rail

1. OPS opens a real settlement with a table wider than390px.
2. Horizontally scroll its table with touch/pointer. Confirm rightmost Số tiền and full currency value visible, while Bill heading, document title, signatures and modal actions keep their x coordinates.
3. Repeat desktop and both invoice baskets through existing component regression.
4. Click In, inspect print-media screenshot/DOM: all columns and signatures visible; scroll rail expands.
Expected: only table content scrolls; body/document remains fixed. Print has visible overflow and no max-width rail constraint.
Design provenance: existing ds-table-scroll house primitive; record-table-wrap was rejected because it intentionally has overflow:visible for page sticky headers. Untitled v8 modal/button-utility consulted byCLI and controller's official Table reference; no new table/card skin.
