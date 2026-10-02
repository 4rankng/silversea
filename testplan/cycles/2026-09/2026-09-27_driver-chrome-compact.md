# Regression spec — driver phone chrome compactness (operator report, 2026-09-27)

**Ticket:** operator report 2026-09-27 (two driver-app screenshots; no kanban card id)
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** READY — verified locally 2026-09-27; staging re-run pending a cut
**Cycle:** PM cycle 2026-09-27 (ad-hoc operator polish)

## Goal

Two operator complaints on the DRIVER phone surface, both "too big / not subtle":
(1) the green topbar stacked identity → plate → month navigator on three rows — the date must ride
inline in the header, compact; (2) the trip-detail completion bar (`Còn thiếu N chứng từ` + its CTA)
read as an oversized grey slab. Make the header one row with a compact date chip, and bring the
completion bar back to the shared control geometry with a quiet disabled face. Scope guardrail:
the shared primitives (`components/layout/topbar.css`, the page's own sticky-bar block) change — no
page-local variant of the month chip, no new breakpoint.

## Out of scope

- Desktop (>1023px) chrome: the month chip keeps its full `Tháng 9/2026 · 01/09 – 30/09` label there.
- Non-driver roles' topbars (they never render the driver identity block).
- The e-POD screen's own footer CTA (`DriverTripPodPage` → `.driver-task-complete`), untouched.
- The accept sticky bar (`Nhận lệnh`), untouched — it is a different emphasis, not this fix.
- Any change to what the month navigator selects or persists.

## Acceptance criteria

### TC-DRIVER-CHROME-01 — driver phone topbar is ONE row

- **Given** role `laixe`/`dvthuc` at 390×844 (touch), any driver route
- **When** the route renders
- **Then** identity, month chip and bell occupy one visual row (vertical ranges overlap), the chip is
  visible, and its period range is `display:none` — the driver name is not ellipsised
- **Assert:** `probeTopbar()` in `testplan/qa/scripts/ui-driver-chrome-20260927.mjs`
- **Evidence:** `testplan/qa/evidence/<run>/390_01-my-trips.png`

### TC-DRIVER-CHROME-02 — completion bar sits on the shared control geometry

- **Given** a driver trip whose detail renders `[data-testid=complete-sticky-bar]`
- **When** the page is scrolled to the bottom at 390 and 768
- **Then** the CTA is ≤46px tall (shared `--control-h`/`--control-touch-h`, not the retired 48px cabin
  size), `border-radius: 8px` (`--radius-field`), `font-weight: 600`, and the live count renders at the
  11px caption token
- **Assert:** `probeSticky()` in the same script
- **Evidence:** `<width>_02-trip-detail.png`

### TC-DRIVER-CHROME-03 — the disabled face is quiet, not a grey slab

- **Given** the same bar, with `disabled` forced (a live run may land on an enabled trip)
- **When** the disabled face is measured
- **Then** background is `--surface-3`, text `--ink-2` (5.7:1), `opacity: 1`, height ≤46px — never the
  ink fill at 55% opacity that the operator screenshotted
- **Assert:** `TC-DRIVER-CHROME-03` block in the same script (`forced: true` in the payload)
- **Evidence:** `<width>_03-disabled-face.png`

## Linked artifacts

- Script (reusable, any env): `testplan/qa/scripts/ui-driver-chrome-20260927.mjs`
  (`QA_USER_LAIXE=dvthuc WIDTHS=390,768 node …` → 6/6 PASS locally 2026-09-27)
- Evidence: `testplan/qa/evidence/2026-09-27T07-08-55-335Z_93528_driver-chrome/`
- Implementation: `frontend/src/components/layout/topbar.css` (≤640 driver band),
  `frontend/src/pages/DriverTripDetailPage.css` (`.driver-task-complete-sticky*`)
- Ruling: `docs/design-guidelines.md` row 2026-09-27 (driver phone chrome), system entry
  `docs/design-system/04-layout-navigation-and-overlays.md` → "Driver phone topbar".
- Memory: `docs/memory/global/conventions/agent-working-contract.md` (case-before-done rule).
