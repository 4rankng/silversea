# CUS datetime and requirement retest

Base: 9b99b1aa568e9e06c899a6ca86f2915e41bc23fe. User requires direct authorized operation, online only, compact mobile/tablet/desktop UI. Ticket completion labels are not evidence. No commit, index change or deployment.

## Cases before implementation

| ID | Requirement / reproduction | Expected proof |
|---|---|---|
| CUS-DT-01 | IMG_6377, QA-144, _34: add/change appointment by typing complete 24h text then Enter | Exactly one authorized write; success closes appointment and drawer; failure/invalid remain editable; no competing parent Enter handler |
| CUS-DT-02 | Same appointment chosen through date/time panels, then confirmation | Same wire value and save/exit behavior as typing; no silent save or unexpected parent submit |
| CUS-DT-03 | IMG_6378, QA-143, _32/_39/_43: create-grid datetime picker | Discoverable trigger, separate app-styled day/time panels, fully within viewport at390x844,834x1112,1280x600,1440x900; portal positioned once; panel expansion, resize/scroll remain bounded |
| CUS-DT-04 | Escape/cancel, nested picker, invalid partial typing, rejected API, repeated Enter | No write or drawer exit on cancel/invalid; focus restoration; single in-flight write; stale completion does not close newer editor |
| CUS-DT-05 | QA-021/022/026: 24h/Vietnam appointment semantics, clear and save | 08:00/13:30/20:46/00:15/23:45 round-trip unchanged; explicit null clears; no AM/PM |
| CUS-REQ-01 | Current CUS Kanban requirements independent of status | Read current requirement text; map each to source and existing/new tests, record untested UI/API scope honestly |
| CUS-EXIT-01 | _42: repeated appointment save/exit | No blank page; deterministic save settlement; parent owns actual browser repeated cycles |

## Validation

Run focused CUS/design-system/create tests and TypeScript; record exact commands and full logs under ignored qa/2026-09-15_cus-dispatch-driver-retest. Parent runs serialized Chrome UI checks and combined full gates. Unit geometry checks establish positioning calculations and resize reaction; only actual browser verifies rendered viewport fit. No DOM-only visibility claim substitutes for screenshots or actual interaction.

Additional code-audit regressions: CUS-DT-06 detail-list locale-independent HH:mm entry with invalid-time refusal and disabled shortcuts; CUS-DT-07 LCL quick-edit read/write use the Vietnam timezone including midnight; CUS-DT-08 calendar adjacent-month/year accessible labels agree with the emitted ISO date.

## User steering — split controls, before implementation

CUS-DT-09: replace the create-grid combined datetime text box with separate visible Giờ (HH:mm,24h) and Ngày (DD/MM/YYYY) controls. Both support manual partial entry and their own application-styled picker. Parent wire contract stays YYYY-MM-DDTHH:mm -> Vietnam+07. Validate complete date/time pairs before create; allow both blank for unscheduled draft. No native combined datetime popup. Copy/add-row keeps both parts; clearing/editing a partial value must not silently reuse the old saved timestamp. Check keyboard/Enter/Escape, picker focus return and geometry, all container/LCL/combined create consumers at390/834/1440.

CUS-DT-10: retain the standalone TimePanel44px phone targets while bounding the expanded full appointment dialog. Its time panel scrolls internally within200px, preserving footer confirmation visibility and containing scroll gestures. CSS contract regression plus parent actual Chrome measurements verify full-dialog height/viewport fit.

## Final direct-field picker steering (before implementation)

CUS-DT-11: remove separate clock/calendar buttons. Clicking the time/date text input opens its own picker without stealing focus, so manual typing continues. Alt+Down opens the same picker with keyboard focus; selection/close restores input without reopening. Apply to both split create fields and detail schedule time input.

CUS-DT-12: partial date/time pairs remain natively invalid for submission, but show no red aria-invalid/error while entering parts or selecting the first picker. Validate visually only after exiting the whole field group, Enter, or form submission; moving from time to date or into the popup is not a group exit. Use concise Vietnamese feedback. Test partial first selection, group exit, invalid submit, continued typing and picker keyboard close.

CUS-DT-13 (latest approved design): reuse installed React Aria ListBox/ListBoxItem for two compact scrollable hour/minute columns.00–23 hours,00–59 minutes; list rows remain44px on phone with176px viewport. Arrow navigation does not commit, explicit click/Enter/Space does; selecting the already selected minute still completes an edited hour. Minute-first with empty time stays draft until hour exists. Keep keyboard Enter inside TimePanel from submitting the parent appointment.

CUS-DT-14 real Chrome follow-up: minute03 then hour01 closes the list but React Aria/browser focus cleanup can blur the immediately restored input to document body, triggering premature partial-pair validation. Restore focus after the selector press/unmount completes, ignore only that transient focus handoff, and do not steal focus from a genuinely chosen external field. Regression must model pointer activation plus the late blur before the next animation frame; test both retained focus/no-error and explicit external focus/validation.

CUS-DT-15 (supersedes DT-13 presentation, approved adaptive design): desktop keeps a compact anchored time popup; at <=640px use a compact modal bottom sheet with subtle backdrop, small screen gutters, and an editable exact HH:mm control inside the sheet. Hour shortcuts00–23 and minute shortcuts00/05/…/55 preserve any selected off-step minute (e.g.03/17/46) visibly. Opening/cancelling never rounds or fabricates a value; a minute-first blank selection remains partial until an hour is activated. Exact invalid typing is retained with concise feedback on explicit Enter/Xong, valid exact typing commits without parent form submission. Both split create and shipment schedule controls, plus the combined appointment dialog, use the same surface. Verify mobile focus containment, backdrop/Escape dismissal, return focus without reopening, neutral incomplete pairs, keyboard selection, disabled state, and desktop manual typing. Parent verifies real Chrome geometry/keyboard limits; responsive DOM tests are not physical-device proof.
