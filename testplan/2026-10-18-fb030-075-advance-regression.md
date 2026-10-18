# Case 2026-10-18 — FB-030/075 regression: typed-complete Giờ must hand focus to the date field in EVERY TimeInput host

Card: **171026215500** (FB-030/075) — QA re-test on staging `8fc1bcf5`:
"gõ '14' không tự nhảy sang tháng" trong dialog "Chỉnh sửa Lịch trình";
FB-002 (Enter save) on the same dialog PASSES on that build (typedSinceOpen
fix is alive).

## Live investigation (rung 3, evidence `qa/2026-10-18_fb030-advance_repro/`
dev + `qa/2026-10-18_fb030-advance_prodbuild/` production build, driver
`testplan/qa/scripts/2026-10-18-fb030-advance-live-probe.mjs`, account `cus`,
lots 143351 (empty date) + fixture 130022 (date 20/10/2026 + giờ 15:45))

The quick-edit dialog "Chỉnh sửa Lịch trình" (ShipmentsPage modal) advances
correctly on build `8fc1bcf5` in BOTH dev and `vite build` output — 11/12
probes green, mutation-free:

- a1/a2/a3/a4: Ngày day "14" → month focus — empty date, type-over, dialog
  re-open, and right after the Giờ→dd hand-off. PASS.
- a6/a6b: QA's exact fixture (lot 130022, prefilled complete date — the
  complete-draft parent-echo path empty-date probes never touch): typing "14"
  over the old day → dd=14 + month focus. PASS.
- b1/b2: Giờ "14" stays a partial draft; "1430" → "14:30" + onComplete moves
  focus to the Ngày day segment. PASS.
- **c2 FAIL (the live regression)**: `/shipments-detail` container ledger
  inline editor ("Chỉnh sửa lịch trình CONT-…" — `ScheduleEditorBody`):
  typing "1430" in Giờ formats "14:30" but focus STAYS on the giờ box —
  the FB-030 `onComplete` hand-off was never wired in this sibling host.

## Root cause (the unit-vs-live delta)

`5ef5ace7`'s successor fix (53eb9f2a) implemented the FB-030/075 hand-off as
`TimeInput onComplete` + one host wiring in `CusQuickEdit.tsx` only.
`ShipmentContainerScheduleEditor.tsx` (ScheduleEditorBody) renders the same
`TimeInput` → `BufferedUuiDateInput` pair with NO `onComplete` — sibling
sweep miss. Unit tests pass because `TimeInput.test.tsx` covers the callback
in isolation and `ShipmentsPage.test.tsx` covers the CUS dialog host; no test
covers the ledger host's giờ→ngày hand-off, so the gap hid behind green gates.

QA symptom mechanism on the affected host: focus is stuck in the giờ box
after a typed time, so the follow-up day "14" is typed into giờ (swallowed by
maxLength) and the date field never advances day→month — "gõ '14' không tự
nhảy sang tháng".

## Expected behavior after the fix

- Container ledger inline schedule editor: typing a complete valid giờ
  ("1430" → "14:30") moves focus to the appointment date's day segment
  (`[data-seg="dd"]`) — the same hand-off the CUS schedule dialog runs; typing
  "14" there then advances to the month segment (engine already proven).
- Quick-edit dialog behavior unchanged (probes a*/b* stay green).
- `DispatchTimeFilterField` (a filter with no natural next field) unchanged.

## Regression tests

`ShipmentContainerScheduleEditor.test.tsx`: typed giờ completion ("1430")
advances focus to the Ngày day segment (FB-030/075 sibling regression —
mirrors the ShipmentsPage quick-edit host test).

## Re-verification (done)

Re-run `2026-10-18-fb030-advance-live-probe.mjs` after the fix: **12/12 probes
green, mutation-free, on BOTH surfaces** — local dev stack
(`qa/2026-10-18_fb030-advance_fix/ui-driver-dev.log`, screenshots
`qa/2026-10-18_fb030-advance_fix/ui-dev/`) and the production `vite build`
served like staging (`qa/2026-10-18_fb030-advance_fix/ui-driver-prodbuild.log`,
screenshots `qa/2026-10-18_fb030-advance_fix/ui-prodbuild/`). c2 now lands
focus on the Ngày day segment after a typed-complete giờ (evidence
`c2_ledger-gio-1430.png` + the `activeSeg: "dd"` probe records).

Pre-fix failure evidence: `qa/2026-10-18_fb030-advance_repro/probe-run.log`
(dev) and `qa/2026-10-18_fb030-advance_prodbuild/probe-run.log` (production
build) — c2 FAIL records with full DOM state. Disclosure: the screenshot PNGs
first captured into `qa/2026-10-18_fb030-advance_repro/` were overwritten by
the post-fix runs (the driver's output dir was hardcoded then; now `QA_OUT`
overridable) — the pre-fix text records above are the surviving pre-fix
evidence.

## Coverage table (AGENTS.md §9)

|Claim / bug|Rung|Evidence|Not covered|
|---|---|---|---|
|a1–a4 quick-edit dialog day→month advance (incl. re-open + post-hand-off)|UI DRIVEN|ui-driver-{dev,prodbuild}.log + ui-*/a1..a4*.png + probe-log.json|Mobile sheet ≤640px; roles other than cus|
|a6 QA fixture case — prefilled complete date (lot 130022) day→month|UI DRIVEN|ui-*/a6*.png + probe-log.json (`activeSeg: mm2`)|Same as above|
|b1/b2 dialog Giờ "1430" → "14:30" + hand-off to Ngày dd|UI DRIVEN|ui-*/b1,b2*.png + probe-log.json|Same as above|
|c1 ledger Ngày day→month|UI DRIVEN|ui-*/c1*.png + probe-log.json|Same as above|
|c2 ledger Giờ typed-complete → Ngày dd hand-off (the fix)|UI DRIVEN|ui-*/c2*.png + probe-log.json (post-fix `activeSeg: dd`; pre-fix FAIL in *_repro/probe-run.log)|LCL "Ngày vận chuyển" field hand-off (no natural time→transport-date pair); DispatchTimeFilterField (filter, no next field)|
|Red-before/green-after regression test|Automated unit|fe-hosts-vitest.log (13/13 with fix; 1 failed without — stash-run transcript in session)|—|
