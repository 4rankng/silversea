// Design locks for the two dispatch planning screens.
//
// Every value below was measured on the APPROVED state (2026-09-27, after the
// card rebuild) with:
//   node scripts/design-lock.mjs --probe dieuvan /dispatch-detail 390
// The `was` note on each height lock is the pre-fix measurement the lock
// prevents from coming back.

const PHONE = 390;
const TABLET = 768;

const pageWide = (role, path, width, note) => ([
  { id: `${path}/w${width}/no-page-overflow`, role, path, width, kind: 'noPageOverflow', note },
  { id: `${path}/w${width}/no-clipped-text`, role, path, width, kind: 'noClippedText', note },
  { id: `${path}/w${width}/tap-floor`, role, path, width, kind: 'tapFloor', note },
  { id: `${path}/w${width}/min-font`, role, path, width, kind: 'minFont', note },
]);

// Added 2026-09-27: the 6-width sweep (360…1440) flagged /dispatch-detail at
// 1024 only — 15 clipped nodes, all in the assignment cell (driver name 92px of
// text in an 88px box, carrier "Chưa phân nhà xe" 106px in 88px, nowrap+ellipsis).
// 390 and 768 already had these locks; the 1024 and 1440 bands did not, which is
// why the sweep's new 6-width matrix was the first thing to see it. Names wrap
// now — these two bands hold the fix.
const dispatchDetailTextLocks = [1024, 1440].flatMap((width) => ([
  {
    id: `/dispatch-detail/w${width}/no-clipped-text`,
    role: 'dieuvan',
    path: '/dispatch-detail',
    width,
    kind: 'noClippedText',
    note: 'assignment-cell driver/carrier are names — they wrap (two-line clamp), never a one-line token; 15 nodes clipped at 1024 before the fix',
  },
  {
    id: `/dispatch-detail/w${width}/no-page-overflow`,
    role: 'dieuvan',
    path: '/dispatch-detail',
    width,
    kind: 'noPageOverflow',
    note: 'wrapping the names must not push the dense plan table sideways',
  },
]));

export default [
  // --- Chrome budget: the space the header+filter block steals from the
  // list. Measured on the approved state (2026-09-27) after the operator's
  // "too messy / group them in bộ lọc" ruling; the pre-ruling block ran
  // ~440px of stacked dropdowns above the first record at 390-500px.
  { id: 'dispatch-detail/phone/chrome-budget', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'maxTop', selector: '.detailed-plan-grid__row', max: 275, note: 'the filter block ran ~440px (title/segment/range/Gán xe/search/4 facet rows/actions) before the facets moved into the drawer; 258px measured now' },
  { id: 'dispatch-detail/split-window/chrome-budget', role: 'dieuvan', path: '/dispatch-detail', width: 500, kind: 'maxTop', selector: '.detailed-plan-grid__row', max: 275, note: 'the operator screenshot width: same promise as the phone band' },
  { id: 'dispatch-detail/tablet/chrome-budget', role: 'dieuvan', path: '/dispatch-detail', width: 768, kind: 'maxTop', selector: '.detailed-plan-grid__row', max: 230, note: 'measured 218px: the canonical button group (2px inset, 44px touch cells) costs ~6px more than the bespoke segment it replaced — the trade the operator ruling asks for' },
  { id: 'dispatch-detail/desktop/chrome-budget', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'maxTop', selector: '.detailed-plan-grid__row', max: 285, note: 'measured 271.7px after the 2026-09-27 cutover: the two-tier header (36px title row + 32px ribbon) is ONE shared strip card now, so the chrome is taller by the card it gained while the strip itself holds two rows. Lower it again if the page drops the visible title row' },
  { id: 'master-plan/phone/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 390, kind: 'maxTop', selector: '.master-plan-grid__row', max: 305, note: 'measured 299px after the 2026-09-27 cutover: the master plan moved off its own drawer toolbar onto the shared strip, which carries four items (search 300 · from/to 342 · Bộ lọc 104 · Tạo lô hàng 109) and therefore packs three lines at a 374px bar — the old toolbar packed two because it stretched its controls. The strip still obeys the two-row law wherever the bar is ≥560px' },
  { id: 'master-plan/split-window/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 500, kind: 'maxTop', selector: '.master-plan-grid__row', max: 305, note: 'measured 299px — same cause as the phone lock: three packed lines at a 484px bar, never a stretched control' },
  { id: 'master-plan/tablet/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 768, kind: 'maxTop', selector: '.master-plan-grid__row', max: 270, note: 'measured 259px: the bar holds two rows here (search · from/to · Bộ lọc on line 1, the page action on line 2) instead of the old toolbar shrink-wrapping a stretched control into one. Lower it again if the action ever leaves the strip' },
  { id: 'master-plan/desktop/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 1440, kind: 'maxTop', selector: '.master-plan-grid__row', max: 260, note: 'measured 241px (the zone panel rides above the grid)' },

  // --- The facets live in the drawer, at every width -----------------------
  { id: 'dispatch-detail/phone/no-ribbon-facet-grid', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'hidden', selector: '.detailed-plan-ribbon__quick', note: 'the 2-up facet grid was the header mess the operator rejected; a later session must not restore it' },
  { id: 'dispatch-detail/desktop/no-ribbon-facet-grid', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'hidden', selector: '.detailed-plan-ribbon__quick', note: 'one home per filter at every device size' },
  { id: 'dispatch-detail/phone/facets-in-drawer', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'visible', selector: '.detailed-plan-filter-panel__quick', open: 'drawer', note: 'grouping the facets must give them a real home, not delete them' },
  { id: 'dispatch-detail/desktop/facets-in-drawer', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'visible', selector: '.detailed-plan-filter-panel__quick', open: 'drawer' },
  { id: 'dispatch-detail/phone/drawer-facet-group-count', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'count', selector: '.detailed-plan-filter-panel__quick > *', max: 5, open: 'drawer', note: 'the facet group lives in the drawer (Khách + Hướng + Điều xe + Dữ liệu + Xe/Tài xế — the vehicle facet landed in 0a2b2864 and this max was left at 4, a stale pin); the two `no-ribbon-facet-grid` hidden locks are what keep it out of the header' },

  // --- Anchoring (card 20260928_158) ---------------------------------------
  // The card reported the sheet covering its own trigger at 1024 and 1440. That
  // no longer reproduces — a later density pass took the panel 876px -> 580px,
  // and at both widths it already cleared the trigger by 4px. The defect is
  // real at 390 instead, and it is the same root cause: the panel was bounded to
  // the VIEWPORT (`100dvh - 24px`) rather than to the space under its trigger,
  // so a sheet taller than that space grew to the viewport ceiling, and the
  // hook's viewport clamp then pinned it to the top padding with the trigger
  // inside it. Measured before the fix: panel top 12 against a trigger bottom of
  // 245, so it covered the trigger by 233px.
  { id: 'dispatch-detail/phone/sheet-clears-its-trigger', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'clearOf', selector: '.filter-dropdown__popover', relative: '.filter-dropdown__trigger', min: 0, open: 'drawer', note: 'the sheet opens BELOW the button that opened it. A sheet that needs more room than its anchor has below must cap and scroll (583px measured, body 581 visible of 822), never grow to the viewport and slide up over its own trigger' },
  { id: 'dispatch-detail/desktop/sheet-clears-its-trigger', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'clearOf', selector: '.filter-dropdown__popover', relative: '.filter-dropdown__trigger', min: 0, open: 'drawer', note: 'same invariant at desk width, where the card first reported it. Currently 4px and not scrolling, so this holds it rather than catching a live regression' },

  // --- Header shape --------------------------------------------------------
  { id: 'dispatch-detail/desktop/header-one-row', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'maxHeight', selector: '.detailed-plan-header', max: 40, note: 'title + presets + range + Gán xe on one 36px row at desk width' },
  { id: 'dispatch-detail/phone/clear-control-not-stretched', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'maxWidth', selector: '.detailed-plan-filters__clear', max: 120, note: 'Xóa lọc claimed half the row in the rejected layout (186px+); it now hugs its content next to Bộ lọc' },
  { id: 'dispatch-detail/desktop/date-scope-is-the-shared-group', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'computed', selector: '.filter-bar__presets .ds-tabs', prop: 'border-top-width', equals: '1px', note: 'operator ruling 2026-09-27: one button group app-wide (the fleet-vehicle status group is the reference). The day scope moved off the header into the shared strip presets slot (card 20260927_152), so the lock follows it there — a bespoke segment shape is still the regression' },
  { id: 'dispatch-detail/phone/date-scope-fits-the-title-row', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'hidden', selector: '.detailed-plan-header__date', note: 'the day scope left the header for the shared strip (card 20260927_152): on a phone the strip folds it into the Bộ lọc dialog, so the header must not own it at any width — the desktop lock proves it is the shared boxed group where it is visible' },
  { id: 'dispatch-detail/phone/no-bespoke-segment', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'hidden', selector: '.detailed-plan-header__preset', note: 'the hand-rolled preset buttons are deleted CSS; nothing may re-render the class' },

  // --- Ke hoach Chi tiet (container cards) ---------------------------------
  ...pageWide('dieuvan', '/dispatch-detail', PHONE, 'dispatch-detail phone: no overflow, no truncated value, 44px taps, caption floor'),
  ...pageWide('dieuvan', '/dispatch-detail', TABLET, 'dispatch-detail tablet: same promises once the tablet band is a touch device'),

  {
    id: 'dispatch-detail/phone/record-row-height',
    role: 'dieuvan', path: '/dispatch-detail', width: PHONE,
    kind: 'maxHeight', selector: '.detailed-plan-grid__row', max: 380,
    note: 'a phone container card printed up to nine uppercase label rows of its own and measured 469px; the short inline label brought it to 371px',
  },
  {
    id: 'dispatch-detail/tablet/record-row-height',
    role: 'dieuvan', path: '/dispatch-detail', width: TABLET,
    kind: 'maxHeight', selector: '.detailed-plan-grid__row', max: 240,
    note: 'tablet kept the desktop uppercase label row above each value (357px row, ~30% content); the shared short-label grammar brought it to 226px — a 742px row with 30% content reads as a hole',
  },
  {
    id: 'dispatch-detail/tablet/cell-wraps',
    role: 'dieuvan', path: '/dispatch-detail', width: TABLET,
    kind: 'computed', selector: '.detailed-plan-grid__cell--documents', prop: 'white-space', equals: 'normal',
    note: 'specificity-proof: the card band releases the desktop one-line rule. A later `tbody td:nth-child(N){nowrap}` (the 2026-09-27 invoice-tracking bug class) wins on specificity while every source assertion stays green',
  },
  {
    id: 'dispatch-detail/desktop/cell-wraps',
    role: 'dieuvan', path: '/dispatch-detail', width: 1440,
    kind: 'computed', selector: '.detailed-plan-grid__cell--documents', prop: 'white-space', equals: 'normal',
    note: 'the worksheet wraps its cells instead of owning a horizontal rail (file header: "cells wrap instead of owning a horizontal rail"). A later `td { nowrap }` reintroduces exactly that rail',
  },
  {
    id: 'dispatch-detail/tablet/decision-and-notes-share-a-row',
    role: 'dieuvan', path: '/dispatch-detail', width: TABLET,
    kind: 'inline', selector: '.detailed-plan-grid__cell--editable', other: '.detailed-plan-grid__cell--notes', tol: 8,
    note: 'the dispatch-decision and notes cells pair in the two card columns; each owning a full-width row wasted ~70% of the row',
  },

  // --- Ke hoach Tong quat (lô cards) ---------------------------------------
  ...pageWide('dieuvan', '/dispatch', PHONE, 'master-plan phone: no overflow, no truncated value, 44px taps, caption floor'),
  ...pageWide('dieuvan', '/dispatch', TABLET, 'master-plan tablet: same promises at the touch tablet width'),

  {
    id: 'master-plan/phone/record-row-height',
    role: 'dieuvan', path: '/dispatch', width: PHONE,
    kind: 'maxHeight', selector: '.master-plan-grid__row', max: 255,
    note: 'the phone lô card was 370px of stacked label rows; short inline labels brought it to 244px',
  },
  {
    id: 'master-plan/tablet/record-row-height',
    role: 'dieuvan', path: '/dispatch', width: TABLET,
    kind: 'maxHeight', selector: '.master-plan-grid__row', max: 295,
    note: 'the tablet lô card was 430px with a full-width label row per field; the shared grammar brought it to 286px',
  },
  {
    id: 'master-plan/tablet/cell-wraps',
    role: 'dieuvan', path: '/dispatch', width: TABLET,
    kind: 'computed', selector: '.master-plan-grid__cell--lift-port', prop: 'white-space', equals: 'normal',
    note: 'specificity-proof card band for the master-plan cells',
  },
  ...dispatchDetailTextLocks,

  // --- No pill chrome in a dispatch data cell (card 20260930_215) ----------
  // The issue-status chip and the Nhập/Xuất direction marker were Untitled UI
  // `Badge type="pill-color"` elements (`border-radius: 9999px`, `padding:
  // 2px 8px`). §1 keeps a data cell plain text (plus the house colour-dot on a
  // real status); a pill is the blob the 2026-09-22 ruling deleted. Measured 0
  // matches on both grids before these locks landed.
  { id: 'dispatch-detail/phone/no-pill-in-grid', role: 'dieuvan', path: '/dispatch-detail', width: PHONE, kind: 'count', selector: '.detailed-plan-grid [class*="rounded-full"]', max: 0, note: 'a status/direction value in a data cell is plain text — never a rounded-full pill' },
  { id: 'dispatch-detail/desktop/no-pill-in-grid', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'count', selector: '.detailed-plan-grid [class*="rounded-full"]', max: 0, note: 'same promise at the desk band' },
  { id: 'master-plan/phone/no-pill-in-grid', role: 'dieuvan', path: '/dispatch', width: PHONE, kind: 'count', selector: '.master-plan-grid [class*="rounded-full"]', max: 0, note: 'carrier allocation is identifying information (label + counts), not a pill' },
  { id: 'master-plan/desktop/no-pill-in-grid', role: 'dieuvan', path: '/dispatch', width: 1440, kind: 'count', selector: '.master-plan-grid [class*="rounded-full"]', max: 0, note: 'same promise at the desk band' },
];
