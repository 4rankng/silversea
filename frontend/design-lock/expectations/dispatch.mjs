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
  { id: 'dispatch-detail/desktop/chrome-budget', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'maxTop', selector: '.detailed-plan-grid__row', max: 215, note: 'measured 200px; the two-row desk header stays two rows' },
  { id: 'master-plan/phone/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 390, kind: 'maxTop', selector: '.master-plan-grid__row', max: 260, note: 'measured 242px' },
  { id: 'master-plan/split-window/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 500, kind: 'maxTop', selector: '.master-plan-grid__row', max: 260, note: 'measured 242px' },
  { id: 'master-plan/tablet/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 768, kind: 'maxTop', selector: '.master-plan-grid__row', max: 215, note: 'measured 198px' },
  { id: 'master-plan/desktop/chrome-budget', role: 'dieuvan', path: '/dispatch', width: 1440, kind: 'maxTop', selector: '.master-plan-grid__row', max: 260, note: 'measured 241px (the zone panel rides above the grid)' },

  // --- The facets live in the drawer, at every width -----------------------
  { id: 'dispatch-detail/phone/no-ribbon-facet-grid', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'hidden', selector: '.detailed-plan-ribbon__quick', note: 'the 2-up facet grid was the header mess the operator rejected; a later session must not restore it' },
  { id: 'dispatch-detail/desktop/no-ribbon-facet-grid', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'hidden', selector: '.detailed-plan-ribbon__quick', note: 'one home per filter at every device size' },
  { id: 'dispatch-detail/phone/facets-in-drawer', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'visible', selector: '.detailed-plan-filter-panel__quick', open: 'drawer', note: 'grouping the facets must give them a real home, not delete them' },
  { id: 'dispatch-detail/desktop/facets-in-drawer', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'visible', selector: '.detailed-plan-filter-panel__quick', open: 'drawer' },
  { id: 'dispatch-detail/phone/drawer-facet-group-count', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'count', selector: '.detailed-plan-filter-panel__quick > *', max: 5, open: 'drawer', note: 'the facet group lives in the drawer (Khách + Hướng + Điều xe + Dữ liệu + Xe/Tài xế — the vehicle facet landed in 0a2b2864 and this max was left at 4, a stale pin); the two `no-ribbon-facet-grid` hidden locks are what keep it out of the header' },

  // --- Header shape --------------------------------------------------------
  { id: 'dispatch-detail/desktop/header-one-row', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'maxHeight', selector: '.detailed-plan-header', max: 40, note: 'title + presets + range + Gán xe on one 36px row at desk width' },
  { id: 'dispatch-detail/phone/clear-control-not-stretched', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'maxWidth', selector: '.detailed-plan-filters__clear', max: 120, note: 'Xóa lọc claimed half the row in the rejected layout (186px+); it now hugs its content next to Bộ lọc' },
  { id: 'dispatch-detail/desktop/date-scope-is-the-shared-group', role: 'dieuvan', path: '/dispatch-detail', width: 1440, kind: 'computed', selector: '.detailed-plan-header__date .ds-tabs', prop: 'border-top-width', equals: '1px', note: 'operator ruling 2026-09-27: one button group app-wide (the fleet-vehicle status group is the reference). A bespoke segment shape here is the regression' },
  { id: 'dispatch-detail/phone/date-scope-fits-the-title-row', role: 'dieuvan', path: '/dispatch-detail', width: 390, kind: 'maxWidth', selector: '.detailed-plan-header__date', max: 230, note: 'group + page title share one 374px row at 390px; a group that outgrows its track pushes the title or the row' },
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
];
