# Regression case QA-2026-09-22-03 — /trips ten-column table edge-clips at 1280 (headers cut mid-word, rows off-frame)

- **Case ID:** QA-2026-09-22-03
- **Reported:** 2026-09-22, gate-4 edge-clip class / VisualQA UX-pass flag (a) (lead dispatch 22:10)
- **Surface:** `/trips` (TripListPage desktop table — `frontend/src/pages/trip-list/table.css`)
- **Status:** repro math captured (computed), fix landed with computed contract test; browser re-verification rung belongs to the lead's browser lane.

## Repro (computed — browser-less lane)

1. Open `/trips` at a 1280px viewport (compact desktop band 1024–1439; sidebar collapsed to the 48px rail per
   `Layout.tsx` `WIDE_DESKTOP_MIN_WIDTH = 1440`).
2. Observe the desktop table (`trip-list/table.css` `.table-head` / `.table-row`).

## Expected

Per design law §4 (`docs/design-guidelines.md`), horizontal scroll is reserved for token tables — `/trips` is a
data table, so at compact desktop the table fits its scrollport: no header cut mid-word at the frame edge, no
control clipped, money strings (`1.350.000 ₫`) and tokens (plates, container numbers) whole. Column priority:
the analytic columns that also live on trip detail — **Tiêu hao** (consumption) and **Tổng đi đường** (road) —
yield their tracks below 1440; the remaining 8 columns keep content floors (no ellipsis, no mid-token wrap).

## Actual (pre-fix)

Ten-column template `minmax(200px, 1.3fr) 124px minmax(250px, 1.45fr) minmax(104px, 0.6fr) 116px 116px 112px 112px 100px 100px`
with `min-width: 1424px`: track floors 1334 + nine 10px gaps 90 + row padding 32 = **1456px of required width**
against a 1280 scrollport of 1280 − 48 (rail) − 40 (pad-x 20×2) − 2 (card border) ≈ **1190px** → ~266px of
horizontal overflow. Right-edge headers ("Tổng đi đường", "Tổng chi phí" → rendered "TỔNG CH…" at the frame) cut
mid-word at the scrollport edge; rows run off-frame in full-page shots.

## Root cause

The grid floor budget (1424px min-width) was sized for the ≥1440 card frame (card 20260922_23's 1438px frame)
and never re-budgeted for the compact-desktop band (1024–1439) where the sidebar collapses to 48px but the
content column shrinks accordingly. The scroll body (`overflow-x: auto`) silently absorbed the overflow as
horizontal scroll, violating law §4 on a data table.

## Fix contract (what makes this case pass)

- Below 1440 (compact desktop): `.col-consumption` + `.col-road` cells hidden (head + rows);
  8-column template `minmax(120px, 1.3fr) 104px minmax(120px, 1.45fr) 88px 112px 92px 92px 100px`,
  `min-width: 0`. Floors are content floors: trip code ≈82px ≤ 120; plate chip ≈98px ≤ 104; container token
  ≈86px ≤ 88; revenue cell incl. the D2 "Thiếu giá 15T" chip ≈110px ≤ 112; money ≈75px and headers ≤89px fit
  their 92–100px tracks. No ellipsis anywhere; text wraps per law §4.
- At ≥1440 the card-20260922_23 wide contract is untouched (10 columns, min-width 1424 ≤ 1438 frame).
- Computed + pinned: `TripListPage.styles.test.ts` parses both templates from `table.css` and asserts
  floors + gaps + padding ≤ scrollport budget at 1280 (1280 − 48 − 40 − 2 − 15 classic-scrollbar reserve = 1175).
- Warnings stay visible: `getMissingIndicators` covers revenue + fuel — both columns remain at every width; the
  D2 chip lives in the revenue column (kept). No hidden column carries a warning surface.
- Known edge, accepted: at 1024–1030 with Windows classic scrollbars the 8-column floors (930px + gaps +
  padding) sit ~11px over the 919px budget → a hairline scroll. Out of this case's 1280 scope; shave status
  100→92 or gaps 10→8 if it ever gets reported.
