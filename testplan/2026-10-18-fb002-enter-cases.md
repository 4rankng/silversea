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

## Re-verification (done)

Driver `2026-10-18-fb002-enter-case-probe.mjs` — **4/4 green post-fix on BOTH
the local dev stack and the production `vite build`**, with fixture
restoration (closingAt back to the pre-probe 2026-10-20T08:45Z; version churn
disclosed — each save bumps the row version):

- CASE2 typed "1430" + FIRST Enter saves (toast "Đã cập nhật lịch đóng/trả.",
  1 PUT) — `qa/2026-10-18_fb002-enter-cases_fix/case-driver-{dev,prodbuild}.log`
- CASE3 ArrowDown picker + typed "1430" + FIRST Enter saves — same logs.
- CASE1 typed "14:30" + Enter saves (unchanged law) — same logs.
- Screenshots: `qa/2026-10-18_fb002-enter-cases_fix/ui-{dev,prodbuild}/`.
- Surfaces: dev = worktree vite `:7179` (the standard `:7175` was serving the
  main checkout on this shared machine) and prodbuild = `vite preview :4181`
  of this worktree's `make build` output; API `:3002` + dev DB `:5441`.
  Roles/widths: account `cus`, 1440×900.

FB-030/075 regression intact: `2026-10-18-fb030-advance-live-probe.mjs`
**12/12 on dev AND production build**
(`qa/2026-10-18_fb002-enter-cases_fix/advance-driver-{dev,prodbuild}.log`).
Probe-driver hardening: the shared dev DB is churned concurrently by sibling
agent fixtures, which reshuffles queue pages mid-run (lot 143351 drifted
page 1 → 6 in seconds) — `openDialog` now relocates a missing trigger with a
bounded re-scan (`relocated` log records) instead of trusting a pinned page.

Red-before evidence: `qa/2026-10-18_fb002-enter-cases_fix/case2-red-before.log`
(2 failed without the TimeInput Enter normalization/typedSinceOpen hardening)
and `case3-red-before.log` (2 failed without the focus-steal fixes — the
ArrowDown focus contract and the Modal autoFocus interplay).

Pre-fix live repro of CASE 3 and the autoFocus interplay:
`qa/2026-10-18_fb002-enter-cases_repro/case-driver-dev-prefx.log` (case-3 fix
reverted on the dev surface: CASE3 FAIL — `mutations=0`, first Enter closes
the dialog via the unchanged path, second Enter reopens it; every
`case*_open`/`case3_open` record shows `activeLabel:"Đóng"` — focus on the
modal close button instead of the autoFocus'd input) + `ui-dev/` screenshots.
The original pre-fix repro (2026-10-18 06:51 UTC run against staging-parity
build `8fc1bcf5`) is likewise preserved in the session transcript; its
worktree-resident `qa/` copies were destroyed when that worktree was wiped.

## Coverage table (AGENTS.md §9)

|Claim / bug|Rung|Evidence|Not covered|
|---|---|---|---|
|CASE2 "1430"+first Enter saves|UI DRIVEN|case-driver-{dev,prodbuild}.log + ui-*/case2_*.png + PUT record|Unnormalized-draft origin on staging (local onChange path always normalized; the Enter decision is now hardened regardless); mobile sheet ≤640px|
|CASE3 ArrowDown→type+Enter saves|UI DRIVEN|case-driver-{dev,prodbuild}.log + ui-*/case3_*.png + PUT record; pre-fix FAIL in _repro/case-driver-dev-prefx.log|Mobile keyboard sheet (react-aria Modal containment, deliberately unchanged per card 326); listbox keyboard nav of the picker panel (focus stays on the typing surface — pointer use unchanged)|
|CASE1 "14:30"+Enter saves (kept)|UI DRIVEN|case-driver-{dev,prodbuild}.log + ui-*/case1_*.png|—|
|Dialog opens focused on the autoFocus'd field|UI DRIVEN|pre-fix `activeLabel:"Đóng"` repro log vs post-fix case logs (ArrowDown opens the picker → focus was on the input)|Other roles/widths|
|Picker-finishing Enter still swallowed; invalid drafts still never submit|Automated unit|TimeInput.test.tsx (44/44 scoped suite incl. the pre-existing swallow laws)|—|
|FB-030/075 hand-off intact|UI DRIVEN|advance-driver-{dev,prodbuild}.log 12/12|—|
