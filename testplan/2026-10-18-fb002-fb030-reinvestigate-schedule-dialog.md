# Case 2026-10-18 — FB-002 re-investigation: the REAL surface is TimeInput inside the quick-edit "Chỉnh sửa Lịch trình" dialog

Tickets: **181026000027-fb002** (R22: gõ tay giờ + Enter trong dialog "Chỉnh sửa
Lịch trình" → KHÔNG LƯU trên staging `da73a743` ĐÃ chứa fix `5ef5ace7`),
**171026215500-fb030-075** (ô ngày/giờ không tự nhảy segment).

## Why the 5ef5ace7 fix missed the QA surface

`5ef5ace7` fixed `SplitDateTimeField` (CUS appointment popover, add-container
row, dispatch assignment dialog, shipment-create). The dialog QA drove is the
**ShipmentsPage quick-edit modal** (title from `quickEditTitle('schedule')` =
"Chỉnh sửa Lịch trình"), whose Giờ field is the **design-system `TimeInput`**
(single `HH:mm` box + picker) and whose Ngày is `BufferedUuiDateInput`
(segmented). `TimeInput` was never touched by `5ef5ace7` — surface mismatch,
not a failed fix.

## Reproduced at HEAD (worktree `fix-fb002-fb030-reinvestigate-1`, main `89dc27dd`)

Driver `testplan/qa/scripts/2026-10-18-fb002-schedule-dialog-repro.mjs`,
local dev stack (vite :7179 worktree, API :3002, account `cus`, lot 130022),
evidence `qa/2026-10-18_fb002-reinvestigate_repro/`:

- **P1/P2 (FB-002, REPRODUCED)**: click the Giờ input (any click opens the
  picker — `TimeInput.onClick → setOpen(true)`), hand-type a valid time,
  press Enter → **0 API mutations, dialog stays open, NO error shown**. The
  Enter was consumed by `TimeInput`'s picker-open swallow
  (`if (open || validation) preventDefault+stopPropagation`) — the host form's
  R17 Enter→`requestSubmit()` handler never ran. QA sees exactly "Enter
  KHÔNG LƯU".
- **P2b**: without the click (picker closed) Enter DID reach the form and the
  dialog closed through the submit path — the host wiring was never broken;
  only the picker-open swallow ate the key.
- **P3 (FB-030, second root cause)**: on a lot whose Giờ is prefilled
  (QA edits an existing schedule), the field is a single input with
  `maxLength=5` already full; a digit typed at a collapsed caret is silently
  dropped by maxLength (caret observed stuck, `qa/…debug` probe
  `2026-10-18-fb002-debug-typeland.mjs`). Click + type over a prefilled giờ
  is a dead field unless the user selects first.
- **P4**: dialog "Ngày đóng/trả" segments auto-advance correctly (day "18" →
  month focus). **P5**: filter "Từ ngày" /shipments auto-advances correctly
  (day "17" → month focus). Both PASS at HEAD — consistent with the 12
  rung-3 probes from the 5ef5ace7 investigation.

## Fix (this card)

`frontend/src/design-system/forms/TimeInput.tsx` (shared owner — the whole
defect class lives here; sibling hosts swept):

1. **Hand-typed Enter flows to the host** (FB-002): track `typedSinceOpen`;
  Enter with the picker open + a hand-typed draft + no validation closes the
  picker and does NOT swallow — it reaches the host's save path (quick-edit
  form `requestSubmit()`, ledger InlineEditor `save()`). Picker-finishing
  Enters (open, nothing typed — card 20260915_6/8 law) and invalid drafts
  keep the swallow.
2. **Type-over restart** (FB-002 second cause, card 326/061026172803 law):
  a digit typed into a FULL field (maxLength 5) with a collapsed caret
  restarts the entry instead of being dropped.
3. **`onComplete` callback** (FB-030/075): fires when a typed entry completes
  a valid time — the single-box analog of the segmented fields'
  complete-segment advance.

`frontend/src/features/shipments/cus/CusQuickEdit.tsx`: the schedule dialog's
Giờ passes `onComplete` → focus advances to the "Ngày đóng/trả" day segment
(the same hand-off `SplitDateTimeField` runs from its time half to its date
half).

`DispatchTimeFilterField` (the third TimeInput host) passes its own
`onKeyDown` that preventDefaults Enter first — behavior unchanged.

## Expected behavior after the fix

- Lot WITH a date, click Giờ → picker opens → type "1545" (restart + auto-colon
  → "15:45") → focus auto-advances to the Ngày day segment → Enter → dialog
  saves (PUT with the typed time), closes, toast "Đã cập nhật lịch đóng/trả."
- Lot WITHOUT a date, same flow → Enter reaches the save, which shows the
  visible guard error "Chọn ngày đóng/trả trước khi nhập giờ." (no silent dead
  key).
- Picker-open Enter with NOTHING typed still only finishes the picker; invalid
  drafts still never submit.

## Regression tests

- `TimeInput.test.tsx`: hand-typed Enter reaches the host with picker open;
  picker-finishing Enter still consumed; invalid still consumed; typed 4-digit
  completion fires `onComplete`; full-field digit restarts (type-over law).
- `ShipmentsPage.test.tsx`: FB-002 round 22 — typed giờ + Enter (picker open
  from the focusing click) saves the schedule quick-edit with the typed
  `plannedReturnAt`; FB-030/075 — completed typed giờ advances focus to the
  Ngày day segment.

## Gates (all exit 0; logs under `qa/2026-10-18_fb002-reinvestigate_*`)

- `cd frontend && npx tsc -b` — 0 errors
- `pnpm lint` — 0 errors
- scoped vitest (TimeInput, TimePickerSurface, DateTimePickerDialog,
  SplitDateTimeField.enter, ShipmentsPage, ShipmentContainerScheduleEditor,
  DispatchPlanEditorCell) — 253/253
- `make build` — ok

## Rung 3 (real Chrome, local stack, account `cus`)

Driver `testplan/qa/scripts/2026-10-18-fb002-schedule-dialog-fix-rung.mjs`,
evidence `qa/2026-10-18_fb002-reinvestigate_fix/`:

- `01_dialog-open.png` → click Giờ (picker opens) → type "1545":
  `02_after-typing-1545.png` — value "15:45", focus on the Ngày day segment.
- Enter → `03_after-enter.png` — dialog CLOSED, toast "Đã cập nhật lịch đóng/trả."
- DB side effect (`db-side-effect.txt`): PUT `/api/shipments/130022`
  `{"expectedVersion":2,"expectedDeliveryDate":"2026-10-20","closingAt":"2026-10-20T15:45:00+07:00"}`
  → re-read: `closingAt = 2026-10-20T08:45:00.000Z` (15:45+07:00), version 3.
- No-date lot (repro driver P1): typed "14:30" + Enter → visible alert
  "Chọn ngày đóng/trả trước khi nhập giờ." — save path executed, no dead key.

## Fixture residue (disclosed)

QA fixture lot **130022** (dev DB only): the with-date probe PUT a fixture
schedule (date 2026-10-20 + closingAt). Restoring the original all-null
schedule is blocked by the API's own rule (409 "Lô hàng đã sẵn sàng điều xe
nên phải giữ ngày vận chuyển, giờ đóng hoặc thời gian trả hàng") — the lot
now appears ONLY under the 2026-10-20 date filter, out of the default
"Chưa chốt ngày" queue. Three restore attempts logged. If the residue
matters, an owner-approved DB cleanup or the qa-fixture purge path must
remove it; I did not touch the DB directly.

## FB-030/075 verdict on the other named surfaces

- "Từ ngày" filter and the dialog's segmented Ngày auto-advance PASS at HEAD
  (rung 3, this card + the 12 probes from `5ef5ace7`). The dialog Giờ is a
  single box by design; "segment kế" after a completed giờ is now the Ngày
  day segment (implemented).
- Staging `da73a743` could not be driven (production prohibition). If QA's
  filter/segment failure persists on the NEXT staging build that contains
  this fix, capture the exact field + buildHash — local HEAD cannot
  reproduce it, which points at a stale or divergent staging build rather
  than the engine.

## Not covered

- Staging/prod builds (production prohibition) — owner re-verification needed
  after the next push.
- Mobile sheet variant (≤640px) of the same dialog flows (desktop 1440 driven).
- Other roles (admin/ops view of the same dialog).
- The ledger InlineEditor dialog ("Chỉnh sửa lịch trình CONT-…") shares the
  fixed TimeInput and its own Enter→save host wiring, but was not separately
  UI-driven in this card (jsdom suite covers its editor body).
- Error/rollback path beyond the no-date guard (409 conflict flow not driven).
