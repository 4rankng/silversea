# QA-AUDIT-UI-47 — shared portal and shell control ceiling

Environment:local dev. Viewports:390×900,768×900,1440×900.

1. Open a real authenticated expense or trip photo from its actual image control.
   Measure the rendered zoom, reset, close and any available previous/next
   buttons. Click zoom/reset/close and use Escape after reopening.
2. Open a real existing Drawer from an accounting action; inspect and click its
   close button. On mobile/tablet, open and close the actual sidebar.
3. As ADMIN, open the health workspace and click its refresh control. Inspect
   the retry control if a real unavailable state is observed; do not invent an
   error response to claim it.
4. Capture complete screenshots, actual DOM control rectangles/state and driver
   logs. Compare safe business ORM rows before/after; no material write is
   expected from these actions.

Expected:each rendered single-line control is at most40px high; icon controls
are at most40px wide. Focus, accessible names, image zoom/reset, dialog/sidebar
closure and refresh still work. Image/media and multiline content remain
intrinsically sized. Report absent previous/next/retry controls as uncovered.

Initial reproduction:CODE-READ ONLY — explicit44/56/80px rules in existing shared
owners. No runtime claim is made by that source inspection.


Re-run2026-10-01: UI DRIVEN for available toolbar/Drawer/sidebar/health controls,31states at390/768/1440, driverexit0, direct147-table selected ORM parity. Full evidence and absent nav/retry boundaries: `plans/2026-10-01-comprehensive-audit/reports/shared-portal-control-ceiling.md`.
