# Card 051026223607 — datetime auto-advance reported broken a 3rd time (symptom changed: "siblings clear")

## Case ID
DT-ADV-R3 (segmented datetime retention + visible hand-off)

## Reported reproduction (staging, dungnv, /dispatch-detail → "Chỉnh sửa điều phối", cont MSKU1234565)
1. Open the dispatch edit dialog.
2. Click the "giờ" segment of "Giờ trả hàng", type "08".
3. Reported: focus does not move to "phút"; the remaining segments show placeholders
   ("mm", "DD / MM / YYYY") as if cleared.

## Expected behavior
Typing two digits into a segment hands focus to the next segment; every sibling
segment keeps its value. The hand-off must be VISIBLE on an empty target segment.

## Investigation result (2026-10-05/06 night, impl-datetime)
- The field on MSKU1234565 (staging build 8ad8ceb4) opens EMPTY — the stored
  plannedEndAt is gone from the row (changed between retests), so "mm" and
  "DD / MM / YYYY" were never filled. Nothing is cleared by any code path.
- Trusted-keystroke rungs (raw puppeteer, per-keystroke activeElement + both
  segment groups): typing "08" DOES advance focus to the minute on the user's
  exact row and build, at 1440 and 390; siblings retain values. Local rungs on
  the working tree: same, plus burst / 120ms / 2s typing gaps and a full-field
  type-over — all advance + retain.
- Root perceptual cause: the auto-advance target is an EMPTY segment whose
  placeholder renders identically focused or not; the only positional cue was a
  pale #F3F4F6 background — invisible at phone widths, so a working advance
  reads as "dead".
- Fix (shared owner): the focused segment now carries a flat brand underline
  (inset box-shadow, same mechanic as .date-seg--invalid; no 3D elevation per
  the flat-surface ruling) so the hand-off is unmistakable.
  frontend/src/design-system/forms/DateTimeSegments.css (`.date-seg:focus`).

## Regression pins
- `frontend/src/design-system/forms/DateTimeField.retain.test.tsx` — 4 cases:
  type-over with picker open (advance + retention), mobile-sheet width
  (first digit closes the sheet + advance), empty field advance, no-picker
  keyboard entry. Selection-aware keystroke simulation (first digit replaces
  the select-on-focus selection, later digits append).
- `frontend/src/design-system/forms/DateTimeSegments.styles.test.ts` — the
  focused segment must carry the flat brand underline.

## Evidence
- qa/2026-10-05_card051026223607/ — probe transcript (probe-results.json),
  before/after screenshots at 1440/390 (staging 8ad8ceb4 user row + local dev),
  driver logs with exit statuses; driver script
  testplan/qa/scripts/probe-datetime-round3-20261005.mjs.
- Staging rungs are READ-ONLY: dialog opened, segments typed, never saved.

## Not covered
- Real iOS/Android devices (virtual keyboard + WebKit focus rules) — headless
  Chrome at 390px only; unverifiable from this lane.
- The user's original 21:45 tab state (bundle/cache) — not reproducible; all
  rungs ran hard-reload-equivalent fresh pages.
