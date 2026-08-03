# Shipment Milestone Table Overflow

## Context

The `/shipments` desktop table had a real overflow regression in the delivery
column. A long next-milestone label/date string was painting past the cell
boundary and visually colliding with the status column. This was not a data
bug; it was a layout bug caused by the cell being treated like unconstrained
inline content.

## What Happened

The fix narrowed the blast radius instead of rewriting the table. In
`frontend/src/pages/ShipmentsPage.tsx`, the milestone now renders once, keeps
its full combined value in `title`, and splits label/date into separate lines.
In `frontend/src/pages/ShipmentsPage.css`, the delivery cell now clips
overflow, the milestone can shrink, and each text line ellipsizes instead of
spilling into the next column.

The red-green sequence mattered here. The first focused test run failed with
`TestingLibraryElementError: Unable to find an element with the title:
Giao dự kiến 15/8/2026.` After the fix, the rerun passed cleanly and the full
frontend suite stayed green.

## Reflection

The frustrating part is that the table looked fine until one realistic milestone
name pushed it over the edge. That means the original code was relying on
implicit width assumptions instead of hard containment. We shipped a row layout
that only behaved when the content was short. That is exactly the kind of bug
that survives happy-path review and then bites you in real data.

## Decisions

- Keep the fix local to the shipments page instead of changing shared table
  primitives.
- Preserve the desktop/tablet table and the mobile card surface; only the
  delivery cell needed containment.
- Trust the browser geometry evidence over jsdom alone.

## Next

No deployment or commit claim here. The verification chain is complete for this
change: `pnpm lint` passed with pre-existing warnings only, `cd frontend &&
npx tsc -b` passed, `cd frontend && pnpm exec vitest run
src/pages/ShipmentsPage.test.tsx` failed once then passed on rerun, `cd
frontend && pnpm test` passed, `make build` passed, `pnpm context:check && git
diff --check` passed, the adversarial review passed, and manual Puppeteer QA on
1920x1080, 1024x768, and 390x844 showed `documentOverflow: 0` at every size.
Desktop had `tableClientWidth: 1302`, `tableScrollWidth: 1302`, and 18
contained milestones; tablet had `tableClientWidth: 663`,
`tableScrollWidth: 1040`, and 18 contained milestones; mobile hid the desktop
table entirely and showed the card surface with zero overflow.
