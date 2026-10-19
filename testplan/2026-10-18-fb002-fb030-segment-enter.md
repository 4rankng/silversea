# Case 2026-10-18 — FB-002 + FB-030/075 segmented datetime: Enter-commit & auto-advance

Tickets: 181026000027-fb002 (R22: gõ tay giờ + Enter KHÔNG LƯU — R17 pass),
171026215500-fb030-075 (gõ '14' vào segment giờ không auto-advance sang phút;
segment ngày "Từ ngày" /shipments tương tự).

## Investigation (evidence `qa/2026-10-18_fb002-fb030_repro/`, driver
`testplan/qa/scripts/2026-10-18-fb002-fb030-repro.mjs`, local dev + production
build, real Chrome via puppeteer)

Auto-advance probes at HEAD (1105d184) — ALL PASS, rung 3:

- /shipments "Từ ngày" (DateRangeFields → BufferedUuiDateInput): '17' → month
  focus, '10' → year focus (empty start AND prefilled type-over).
- CUS drawer appointment popover (SplitDateTimeField + onCommit): hour '14' →
  minute focus, minute '30' → date day focus (empty AND prefilled type-over).
- /shipments/new per-container appointment (combinedPicker host): '14'/'30'
  advance with the picker open.

Enter probes: the popover commit path WORKS (toast 'Đã lưu giờ hẹn.',
`customerAppointmentAt` persisted, restored after probe).

## Root cause (FB-002, code-level, reproduces by construction)

`SplitDateTimeField`'s group keydown intercepts EVERY Enter in a segment:
`preventDefault()` + `stopPropagation()` unconditionally, then commits only
`if (!validation) onCommit?.(...)`. Hosts that do not pass `onCommit` get a
dead key:

- dispatch assignment dialog `DispatchPlanEditorCell` — `<form
  onSubmit={save}>` ("Giờ trả hàng" `DateTimeField`): implicit submission is
  killed by the preventDefault and the dialog-level handler never sees the
  key (stopPropagation). Enter → nothing saves.
- CUS add-container row (`CusContainerAddRow`) — the `<tr>`
  `onKeyDown={submitOnEnter}` checks `event.defaultPrevented` and sits ABOVE
  the field group in the bubble path: Enter in its datetime field never
  submits the row.
- shipment-create (`UDateTimeField`) — same swallow inside the create form.

The intercept predates 2026-09-16 (75856b8d added `onCommit` into an already
unconditional swallow), so every onCommit-less host has had a dead Enter since
then; the R22 card surfaces it on the trip/lô giờ forms.

## Expected behavior (this fix)

1. Two complete in-range digits auto-advance to the next segment (already
   correct at HEAD — pinned with real-typing regression tests so the engine
   cannot regress silently again; existing suites only drove `fireEvent.change`,
   which bypasses the keydown path entirely).
2. Enter on a hand-typed segment:
   - host passed `onCommit` → intercept + commit + blur (unchanged);
   - no `onCommit`, draft valid/empty, picker closed → the field no longer
     swallows the key: it flows to the host's own save path. NOTE (review
     finding): browsers run NO implicit submission for a form without a
     submit button and with several text inputs — so such hosts must answer
     Enter themselves:
     - CUS add-container row: its `<tr>` Enter handler submits the row
       (rung 3 driven below);
     - dispatch assignment dialog: the form now answers Enter via
       `requestSubmit()` (the R18 FB-002 house pattern) — added in
       `DispatchPlanEditorCell.tsx`;
     - shipment-create: unchanged (its form also has no submit button; making
       stray Enter CREATE a lot is a product decision outside these cards);
   - incomplete/invalid draft → still swallowed (a partial draft must never
     submit a stale timestamp);
   - picker open → still closes the picker and swallows (unchanged).
3. A single-digit (incomplete) segment value is not flagged while typing
   (`isOutOfRange` requires full length; field message gated on `touched`).

## Regression tests

`frontend/src/design-system/forms/SplitDateTimeField.enter.test.tsx`:
real-typing auto-advance (time + date), Enter-commit via onCommit, Enter not
swallowed by the field when no onCommit (host layer sees it unprevented),
incomplete draft still swallowed, single digit not flagged.
`DispatchPlanEditorCell.test.tsx`: Enter in a hand-typed Giờ trả hàng segment
saves the dialog via requestSubmit; an incomplete draft still blocks the save.

## Gates

`cd frontend && npx tsc -b` 0 errors; scoped vitest suites for
src/design-system/forms + affected hosts 0 failed; full frontend suite
5077/5077; root lint 0; `make build` ok. Rung-3 drives (real Chrome, local
stack, dev + production build):

- CUS add-row (qa/2026-10-18_fb002-fb030_fix/): typed datetime + Enter
  submits the row; container QAFB2000009 persisted with appointment
  2026-10-18T07:30Z; removed after.
- Dispatch assignment dialog (qa/2026-10-18_fb002-fb030_fix/04-06*.png +
  ui-dispatch-driver.log): typed Giờ trả hàng + Enter closes the dialog and
  PATCHes the plan; fulfillment 14562 plannedEndAt 2026-10-18T07:30Z;
  restored to null via the same plan API.
- FB-030/075 probes (qa/2026-10-18_fb002-fb030_repro/): 12/12 pass at HEAD
  (date + time auto-advance, empty + prefilled type-over, combinedPicker,
  popover Enter-commit).

## Not covered / follow-ups

- The exact staging build the cards were filed against could not be driven
  (production prohibition); the auto-advance failure did not reproduce at
  main HEAD on any named surface — the pinning tests now guard the engine's
  real-typing path so a recurrence cannot hide behind `fireEvent.change`.
- shipment-create keeps its current Enter behavior (no submit button in that
  form; Enter-to-create is a product decision outside these cards).
- Typing over a PREFILLED date half in the dispatch field (runAt-inherited
  value) showed a scrambled round-trip in one probe — not exercised by these
  cards' flows (their date half was empty); left as an observation.
