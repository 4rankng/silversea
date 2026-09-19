# Current Development Handoff

## Active delivery — edit-cell scroll jump fix on "Chi tiết lô hàng", 19 September 2026

Controller: agent session, 2026-09-19 ~01:40 (+08). Branch `prod`, HEAD
`8add9a37`. Working tree also carries an unrelated pre-existing WIP (one-line
`padding-bottom` removals in six page CSS files + a `pre-polish-patch` stash
entry) — NOT part of this fix, left untouched, uncommitted.

**User report (mobile screenshots):** tapping a ledger cell (e.g. Hạ /
container) on `/shipments-detail` to edit it made the page jump — the tapped
cell flew away from under the finger.

**Root cause:** the inline editor's mount effect called `focus()` without
`preventScroll`; the browser's focusing-steps scroll aligned the whole expanded
editor (328–400px tall) into view, yanking the scrollport. The `autoFocus` on
the first input added a second transient focusing-steps scroll + keyboard flash
before the editor container stole focus back.

**Changed (3 files):**
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx` —
  editor container focuses with `{ preventScroll: true }`; removed `autoFocus`
  from the documents (Số Bill / Số Booking) and container (Số container) inputs.
- `frontend/src/features/shipments/detail/ShipmentIdentityEditor.tsx` — removed
  the dead `autoFocus` on the LCL Nhà máy input (stolen by the container focus
  anyway).
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.test.tsx` —
  regression guard: the editor container must be focused with
  `{ preventScroll: true }` on mount.
- `testplan/2026-09-19-edit-cell-scroll-jump.md` — case IDs EDIT-JUMP-01..05.

**Verified (UI DRIVEN, local dev, CUS `thanhdc`, 390×844 + 1440×800):**
scroll-top delta on open was +498 / +176 / +420px (container / route /
identity) before the fix and **0 on every mode after**, tapped trigger stays
put, editor leading edge mounts at the cell's bottom edge, focus lands on the
editor container (Enter/Esc still work). Artifacts:
`qa/2026-09-19_edit-jump-<mode>-<before|after>_ui-*.png` + `_ui-driver.log`,
plus `qa/2026-09-19_edit-jump-desktop-after_*`. Driver pattern:
puppeteer-spa-auth token injection, handle-click on the in-view trigger,
scroll-event tracing (an earlier driver draft produced false deltas via
puppeteer's own scrollIntoViewIfNeeded on an off-screen first match — superseded).

**QA:** lint 0 errors (9 pre-existing warnings) · frontend `tsc -b` 0 ·
frontend suite 2530/2535 — 4 failures are **pre-existing on the unmodified
tree** (Layout CUS nav matrix ×2, RoleWorkspacePagination filter-rail style,
ShipmentsPage typography rhythm; reproduced via stash baseline) and match the
unrelated CSS WIP; ClerkShipmentCreatePage timeout was parallel-load flake
(passes isolated) · focused ledger/cus suites 213/213 · `make build` ok.

**Not verified:** staging writes; other roles (DISPATCHER/OPS); real iOS
keyboard behavior (headless Chrome has no soft keyboard — the removed
`autoFocus` keyboard-flash reasoning is from the focusing-steps spec, the
measured scrolls are browser-verified); schedule/vehicle/notes modes were not
re-run in the driver (same editor mount path, container/route/identity cover
all three editor layouts).

**Not in scope / not done:** commit (not requested), prod deploy, E2E suite
(frontend-only change — no API/schema/RBAC/shared-calculations touch),
`.ua` graph refresh (already stale at session start `cfa0753` vs HEAD
`8add9a37`; the post-commit hook owns it on the next commit).

---

## Preserved prior state — bulk appointment copy on "Chi tiết lô hàng", 18 September 2026

Prior task, claims not re-verified here. HEAD then `586ce46b`. The copy
affordance was subsequently **reverted** (`047bb654 revert(shipments): drop the
appointment copy affordance from the detail workboard`), so its shipped files
(`AppointmentCopyButton.tsx`, `appointment-copy.ts`, `use-appointment-copy.ts`)
are no longer on the workboard; its testplan
(`testplan/2026-09-18-detail-copy-appointment.md`) and QA artifacts
(`qa/2026-09-18-detail-copy*/`) remain as history. Remaining release-only
checks from the 15 September polish pass still stand: 24h catalog watch,
deployed DB migration history/integrity, GitHub alert closure, physical
devices/push.
