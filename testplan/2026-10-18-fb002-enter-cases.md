# Case 2026-10-18 — FB-002 (181026000027) Enter save-flow: cases 1–3 on TimeInput

QA retest on staging `8fc1bcf5` (MIXED) — three concrete cases on the same
"Chỉnh sửa Lịch trình" dialog TimeInput, to land together with the FB-030/075
work on `fix-fb030-advance-regress`, one commit per case.

- **CASE 1 (PASS — must not break)**: type "14:30" WITH colon + Enter → saves.
- **CASE 2 (FB-002, FAILS on staging)**: type "1430" NO colon + Enter → first
  Enter does not save; second Enter does. QA suspect: the "1430" draft is not
  normalized to "14:30" at Enter time → validation fails → the invalid-draft
  swallow eats the save key.
- **CASE 3 (FB-002, FAILS on staging)**: ArrowDown opens the picker → type by
  hand + Enter → only the picker closes, dialog stays. QA suspect: after
  ArrowDown focus sits in the picker panel, keystrokes never reach the input
  so `typedSinceOpen` is never set. Unit test "FB-002 keyboard path" passes
  because `fireEvent.change` writes the input regardless of focus — a real
  driver is required.

## Live repro (driver `testplan/qa/scripts/2026-10-18-fb002-enter-case-probe.mjs`,
evidence `qa/2026-10-18_fb002-enter-cases_repro*/`, fixture lot 130022,
account cus, dev stack + vite build)

- CASE 2 click→type→Enter PASSES locally (value normalizes "1"→"14"→"143"→
  "14:30", onComplete hands focus to the Ngày day segment, Enter there saves
  — 1 PUT, toast). The unnormalized-"1430"-at-Enter state did not reproduce
  on this build's onChange path; QA's staging observation is ground truth for
  the defect class, so the fix hardens the Enter decision itself.
- CASE 3 REPRODUCED (real driver): ArrowDown with focus NOT on the input does
  nothing (`pickerOpen:false`), typing lands nowhere, first Enter closes the
  dialog with 0 mutations (unchanged-path close) and the second Enter REOPENS
  it (focus-restored trigger). With focus on the input, ArrowDown opens the
  picker in keyboard mode and `useFocusTrap(panelRef, keyboard)` STEALS focus
  to the panel's first focusable (the header "Đóng" button) — keystrokes die
  in the panel, `typedSinceOpen` stays false, Enter only finishes the picker.
- **Additional repro (autoFocus interplay)**: on dialog open, the Modal focus
  trap steals focus from the `autoFocus`'d Giờ input to the modal's first
  focusable ("Đóng") — every probe log's dialog-open state shows
  `activeLabel:"Đóng"`. Keyboard users' first keystrokes land on a button.

## Expected behavior after the fixes

1. Enter with a 4-digit unnormalized draft ("1430") normalizes it to "14:30"
   and decides the swallow on the NORMALIZED value — first Enter saves.
2. Any printable keystroke in the field marks the draft hand-typed
   (`typedSinceOpen`) even when the browser drops it (maxLength) or it never
   reaches `onChange` — Enter flows to the host while the picker is open.
3. ArrowDown keeps focus on the input (the typing surface): digits land in
   the input, `typedSinceOpen` sets, Enter saves (the card 326 "the popup
   stole focus" ruling applied to the desktop keyboard-opened picker).
4. A Modal whose content `autoFocus`es an input keeps focus there — the
   focus trap no longer yanks it to the first focusable.
5. CASE 1 unchanged; picker-finishing Enter (open, nothing typed) still
   swallowed; invalid drafts still never submit; FB-030/075 hand-off intact.

## Regression tests

- `TimeInput.test.tsx`: unnormalized "1430" Enter normalizes + reaches the
  host (red/green); printable-keystroke `typedSinceOpen` hardening;
  ArrowDown keeps focus on the input and typed digits + Enter reach the host
  (focus-honest — asserts activeElement, the assertion fireEvent.change
  cannot make).
- `Modal.test.tsx`: autoFocus'd content keeps focus when the trap activates.

## Re-verification

Re-run `2026-10-18-fb002-enter-case-probe.mjs` (cases 1–3 + fixture restore)
and `2026-10-18-fb030-advance-live-probe.mjs` (FB-030 (a)(b)(c) + the
'1430-no-colon' / 'ArrowDown-then-type' flows) — all green, then gates.
