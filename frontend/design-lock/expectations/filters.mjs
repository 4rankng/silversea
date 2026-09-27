// Design locks for the shared filter strip (`components/FilterBar.css` +
// `ListFilterBar.css`, the one layout every shared-bar surface inherits).
//
// Origin: the operator's three 2026-09-27 reports on /shipments —
//   1. "too many fucking rows" (3-4 visual rows at 976-1402px CSS);
//   2. "some control the value very short but why the fuck it does take full
//      row? the width of control should relative to value it holds";
//   3. "tab row longer than row below" — the ≤767 band stripped the card from
//      the bar, so the bar sat 12px narrower than the tab row above it;
// and the ruling that followed: "try to keep filter section max 2 rows only",
// "search bar will never need to occupy full row width", "text 11px 12px
// component size max 40px".
//
// Every number below was measured with `--probe cus /shipments <width>` on the
// fixed state. The `rows` locks use `max` (a budget, ≤ N) rather than `n`,
// because the row count is allowed to DROP as the bar gets room — only growing
// back past 2 is a regression.
const WIDTHS = [1440, 1187, 1024, 768, 594, 500, 460];

const TWO_ROWS = 'the strip packs to at most 2 visual rows — the operator counted 3-4 on /shipments and ruled "max 2 rows only" at every device size';
const VALUE_WIDTH = 'a control is as wide as the value it holds; a short-value select that owns a full row is the operator\'s "why the fuck it does take full row" defect';
const NOT_OVERSIZED = 'a 12px text field is ≤40px tall (the operator\'s /shipments screenshot: a coarse pointer inflated every filter control to 44px = "component size too oversize compared to text")';

export default [
  ...WIDTHS.map((width) => ({
    id: `filters/w${width}/max-two-rows`,
    role: 'cus',
    path: '/shipments',
    width,
    kind: 'rows',
    selector: '.filter-bar > *',
    max: 2,
    note: TWO_ROWS,
  })),

  {
    id: 'filters/shipments/from-to-pair-not-stretched',
    role: 'cus',
    path: '/shipments',
    width: 1440,
    kind: 'maxWidth',
    selector: '.date-range-fields',
    max: 348,
    note: `${VALUE_WIDTH} — the from/to group caps at its 348px natural width (was the page-local grid stretching it across the row)`,
  },
  {
    id: 'filters/shipments/secondary-trigger-width',
    role: 'cus',
    path: '/shipments',
    width: 594,
    kind: 'maxWidth',
    selector: '.filter-dropdown__trigger',
    max: 180,
    note: `${VALUE_WIDTH} — the Bộ lọc trigger holds two words, so it caps at 180px`,
  },
  {
    id: 'filters/shipments/plan-select-width',
    role: 'cus',
    path: '/shipments',
    width: 1440,
    kind: 'maxWidth',
    selector: '.shipments-control__plan',
    max: 320,
    note: `${VALUE_WIDTH} — the inline Kế hoạch combobox is capped at 320px (it measured ~1480px in the operator's report)`,
  },
  {
    id: 'filters/shipments/quick-ranges-width',
    role: 'cus',
    path: '/shipments',
    width: 1440,
    kind: 'maxWidth',
    selector: '.filter-bar__presets',
    max: 340,
    note: `${VALUE_WIDTH} — the quick-range chips are content-sized (313px measured) and never stretch to a line's width`,
  },

  // The operator's words are RELATIVE — "component height are inconsistent
  // [...] please follow same height as [the tab row]" — so these compare against
  // the tab chip: a magic ceiling would lock in one of the two pointer variants
  // (32px with a mouse, 40px on touch).
  {
    id: 'filters/phone/controls-match-the-tab-row',
    role: 'cus',
    path: '/shipments',
    width: 390,
    kind: 'matchHeight',
    selector: '.filter-bar__search',
    of: '.shipments-control__tabs [role="tab"]',
    note: NOT_OVERSIZED,
  },
  {
    id: 'filters/touch/controls-match-the-tab-row',
    role: 'cus',
    path: '/shipments',
    width: 594,
    kind: 'matchHeight',
    selector: '.filter-bar__search',
    of: '.shipments-control__tabs [role="tab"]',
    note: NOT_OVERSIZED,
  },
  {
    id: 'filters/touch/date-fields-match-the-tab-row',
    role: 'cus',
    path: '/shipments',
    width: 594,
    kind: 'matchHeight',
    selector: '.date-range-fields [data-input-wrapper]',
    of: '.shipments-control__tabs [role="tab"]',
    note: 'the from/to fields follow the tab-row height (CHIEF 2026-09-27: "these two oversize [...] please follow same height as [the tab row]") — the ≤640 band used to raise every bar control to the mobile touch height while the tab chips stayed compact',
  },
  {
    id: 'filters/desktop/controls-match-the-tab-row',
    role: 'cus',
    path: '/shipments',
    width: 1440,
    kind: 'matchHeight',
    selector: '.filter-bar__search',
    of: '.shipments-control__tabs [role="tab"]',
    note: NOT_OVERSIZED,
  },
  {
    id: 'filters/desktop/quick-ranges-match-the-tab-row',
    role: 'cus',
    path: '/shipments',
    width: 1440,
    kind: 'matchHeight',
    selector: '.filter-bar__presets',
    of: '.shipments-control__tabs [role="tab"]',
    note: 'the quick-range group is a control group, not a second tab bar — the operator flagged it as the inconsistent one ("component height are inconsistent")',
  },
  {
    id: 'filters/shipments/min-font',
    role: 'cus',
    path: '/shipments',
    width: 594,
    kind: 'minFont',
    note: 'control text stays on the 11-12px role scale — the other half of "text 11px 12px component size max 40px"',
  },

  // The same promise on the surfaces the operator's audit found worst — each of
  // these measured 3-4 rows (or a full-width short-value control) before the
  // cutover, and every one of them now inherits the one bar. Widths are the ones
  // the pre-cutover audit actually failed on.
  ...[
    ['shipments-detail', 'cus', '/shipments-detail', [1440, 1187, 1024, 768]],
    ['shipments-debit', 'cus', '/shipments-debit', [1440, 1024, 768]],
    ['invoice-tracking', 'ketoan', '/accounting/invoice-tracking', [1440, 1024, 768]],
    ['expenses', 'ketoan', '/expenses', [1440, 1024, 768]],
    ['debt', 'ketoan', '/debt', [1440, 768]],
    ['penalties', 'ketoan', '/penalties', [1440, 1024, 768]],
    ['phoi-phieu', 'ketoan', '/accounting/phoi-phieu', [1440, 1024, 768]],
    ['deposit-tracker', 'ketoan', '/accounting/deposit-tracker', [1440, 1024, 768]],
    ['expense-accounting', 'ketoan', '/accounting/expenses', [1440, 1024, 768]],
    ['dispatch', 'dieuvan', '/dispatch', [1440, 1024, 768]],
    ['config-customers', 'admin', '/config/customers', [1440, 768]],
  ].flatMap(([label, role, path, widths]) =>
    widths.map((width) => ({
      id: `filters/${label}/w${width}/max-two-rows`,
      role,
      path,
      width,
      kind: 'rows',
      selector: '.filter-bar > *',
      max: 2,
      note: `${TWO_ROWS} — measured on /${label} (this surface failed the 2026-09-27 pre-cutover audit)`,
    })),
  ),
];
