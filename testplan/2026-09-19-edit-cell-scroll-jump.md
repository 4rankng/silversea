# Edit-cell scroll jump on the CUS detail ledger

User report (2026-09-19, mobile screenshots): tapping a cell (e.g. Hạ / container) on Chi tiết lô hàng to edit it makes the page jump to another location — the tapped cell flies away from under the finger and the viewport scrolls by up to a screen.

Root cause: the inline editor's mount effect calls `focus()` without `preventScroll`, so the browser's focusing-steps scroll aligns the whole expanded editor (≈330–400px tall, in-flow on stacked layouts / absolute below the cell on desktop) into view — yanking the scrollport whenever the editor does not already fit. The `autoFocus` on the first input adds a second transient focusing-steps scroll plus a keyboard flash on touch, then the editor container steals focus back, so it never had a lasting effect.

Browser-measured before the fix (local dev, CUS `thanhdc`, 390×844, tap target pinned 150px above the scroller bottom): container −546px, route −783px, identity −681px scroll deltas on open; the tapped trigger moved 194–290px away from the tap point.

| Case | Reproduction | Expected |
| --- | --- | --- |
| EDIT-JUMP-01 | Local dev, CUS, `/shipments-detail?dateScope=all` at 390px width. Scroll so a container cell sits near the bottom of the viewport, then tap it. | The page does not scroll on open (scroll-top delta 0). The editor expands directly below the tapped cell — the cell's own full-width editor promotion (its designed ≤ ~80px in-card reflow) may shift it, but the viewport never scrolls and the editor's leading edge starts at the cell's bottom edge; anything past the fold is reached by natural scrolling. |
| EDIT-JUMP-02 | Same setup; tap a Địa điểm nâng / hạ (Nâng/Hạ) cell near the viewport bottom. | Same as EDIT-JUMP-01 for route mode — no programmatic scroll, tapped cell stays put, editor visible from its top edge. |
| EDIT-JUMP-03 | Same setup; tap a Khách hàng & lộ trình cell near the viewport bottom. | Same as EDIT-JUMP-01 for identity mode (its editor previously carried `autoFocus` too). Focus lands on the editor container, so Enter-to-save and Esc-to-cancel keep working without being inside a field. |
| EDIT-JUMP-04 | Desktop ≥1001px, tap a cell in the last visible row so the absolutely positioned editor opens below the fold. | The editor's leading edge (heading + first field) is visible right under the cell; the page does not jump to top-align or bottom-fit the editor. |
| EDIT-JUMP-05 | Open any editor, edit a field, press Esc / click outside, then re-open the same cell. | Close still restores focus to the originating trigger (existing behavior) with no jump; re-open behaves like EDIT-JUMP-01..03. |

Automated scope: vitest asserts the editor container is focused with `{ preventScroll: true }` on mount (regression guard for the root cause). Controller owns real-browser click measurement (driver log + before/after screenshots under `qa/`).

## Staging verification — 2026-09-19, cut b03df1b3 (first staging check of the fix)

QA lane, real pointer taps, CUS `thanhdc`, staging `vantai.tingting.vip`. All deltas
measured on `main.app-body` scrollTop against a settled baseline (no programmatic
framing scroll between baseline and tap). Evidence:
`testplan/qa/evidence/2026-09-19_qa-close-rung-b03df1b3/ej-0*.png`.

| Case | Result | Measured |
| --- | --- | --- |
| EDIT-JUMP-01 | PASS | delta 0; editor leading edge at cell bottom (editor top 815 vs cell bottom 793); focus = editor container |
| EDIT-JUMP-02 | PASS | delta 0; editor top 747 vs cell bottom 741; focus = editor container |
| EDIT-JUMP-03 | PASS | delta 0 from settled baseline (an earlier −220 was the driver's own deferred scrollBy flushing at mount — driver artifact, not app behavior; clean re-run delta 0) |
| EDIT-JUMP-04 | PASS | desktop 1440×800; delta 0; absolute editor at 670 (cell bottom 664), 130px visible, rest below fold without jump |
| EDIT-JUMP-05 | PASS | Esc → focus restores to originating cell trigger (delayed restore lands after unmount settles); Enter re-opens, delta 0, focus → editor container. Esc cancels the typed value (no write). |
