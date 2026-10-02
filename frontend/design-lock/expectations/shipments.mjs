// Design locks for the shipment (CUS) surfaces the operator reviews most.
//
// `/shipments-detail` was also the one page the sweeps kept flagging as having
// sub-44px controls at touch widths. It is a false positive worth pinning
// explicitly: the tap target of a segmented date field is the GROUP, and each
// digit box is em-measured to its own glyphs at 12px
// (design-system/forms/DateTimeSegments.css pins 1.706em / 1.956em / 2.91em so
// `DD` never shaves into an E-like sliver). The locks below state both halves:
// the group meets the floor, and the page holds the general promises.

const WIDTHS = [390, 768];

export default [
  {
    id: 'my-trips/phone/no-broken-art',
    role: 'laixe',
    path: '/my-trips',
    width: 390,
    kind: 'noBrokenArt',
    note: 'the deployed empty states rendered text-only because empty-fuel/costs.webp returned 403 (unreadable on the host) while the code was correct — an unloadable illustration must fail a measurement, not just look plainer',
  },
  ...WIDTHS.flatMap((width) => ([
    {
      id: `/shipments-detail/w${width}/no-page-overflow`,
      role: 'cus',
      path: '/shipments-detail',
      width,
      kind: 'noPageOverflow',
    },
    {
      id: `/shipments-detail/w${width}/no-clipped-text`,
      role: 'cus',
      path: '/shipments-detail',
      width,
      kind: 'noClippedText',
      note: 'container ledger values wrap (the 2026-09-27 card-band release) — a higher-specificity nowrap is the regression',
    },
    {
      id: `/shipments-detail/w${width}/tap-floor`,
      role: 'cus',
      path: '/shipments-detail',
      width,
      kind: 'tapFloor',
      note: 'every control clears 44px; digit segments inside a date field are excluded by the sweep (the group is the target)',
    },
    {
      id: `/shipments-detail/w${width}/min-font`,
      role: 'cus',
      path: '/shipments-detail',
      width,
      kind: 'minFont',
    },
  ])),
  {
    id: 'shipments-detail/phone/date-seg-group-is-the-tap-target',
    role: 'cus',
    path: '/shipments-detail',
    width: 390,
    kind: 'minWidth',
    selector: '.date-seg-group',
    min: 44,
    note: 'the segmented date field is click-open: the group carries the floor (measured 169x46) while its digit boxes stay em-measured to their glyphs',
  },
  {
    id: 'shipments-detail/phone/date-seg-group-height',
    role: 'cus',
    path: '/shipments-detail',
    width: 390,
    kind: 'minHeight',
    selector: '.date-seg-group',
    min: 40,
    note: 'the group is the click-open tap target and follows the 2026-09-27 control ceiling (max 40px) — it measured 46px while a coarse pointer inflated every control, 40px after',
  },
  // Data-dense record card (operator 2026-09-27, screenshot of one card at ~500px:
  // "also redesign this to make it data dense card"). The card used to stack seven
  // full-width sections, each with its own label line, at 375px for a row with no
  // data at all; it is a two-column fact grid now with the label riding the first
  // value's line and all-placeholder cells collapsing onto one line.
  //
  // Re-measured 2026-09-28 after the inline fact-run rework: the label no longer
  // owns a grid column of its own (it squeezed the value into a ~100px strip that
  // wrapped), so the same empty row went 241px → 198px at 390 and 219px → 194px
  // at 500. The ceilings below are the measured maxima with headroom for a row
  // that DOES carry data (a scheduled lot with containers and a note).
  {
    id: 'shipments/phone/record-card-density',
    role: 'cus',
    path: '/shipments',
    width: 500,
    kind: 'maxHeight',
    selector: '.cus-dashboard-row',
    max: 245,
    note: 'measured 223.8px after the inline fact-run rework (241px before, 203px in the 2026-09-27 pass). The ceiling sits ABOVE the measured row on purpose — card height follows how much a lot actually carries and the dataset is reseeded between dev runs, so a ceiling pinned to one row fails on the next run for no real regression. A card past this means the label regained a column of its own, or a section regained a full-width row (40px+).',
  },
  {
    id: 'shipments/phone-390/record-card-density',
    role: 'cus',
    path: '/shipments',
    width: 390,
    kind: 'maxHeight',
    selector: '.cus-dashboard-row',
    max: 260,
    note: 'measured 243.2px at 390px after the inline fact-run rework (241px before); an empty row is 198px. Same headroom rule as the 500px lock above — the two widest-card bands need it most, because a lot with containers AND a note prints the most lines here.',
  },
  {
    id: 'shipments/tablet/record-card-density',
    role: 'cus',
    path: '/shipments',
    width: 768,
    kind: 'maxHeight',
    selector: '.cus-dashboard-row',
    max: 240,
    note: 'measured 222.8px after the inline fact-run rework (263px in the 2026-09-27 pass). The ceiling is set above the measured row, not equal to it: card height follows how much a lot actually carries, and the dataset is reseeded between dev runs — 220px was a single-row measurement that failed by 2.8px on the next run. 240 still catches the regression this lock exists for (a section regaining a full-width row costs 40px+), well under the 285px pre-rework budget.',
  },
  // Card 20260928_161 — the CONTROL PLANE above the record card. The operator
  // photographed 258px of chrome standing in front of the first record on a
  // phone ("the UI not very elegant, seem very unstyled"). The two-row rule
  // below is the operator's own wording, measured rather than asserted.
  {
    id: 'shipments/phone/filter-strip-two-rows',
    role: 'cus',
    path: '/shipments',
    width: 390,
    kind: 'rows',
    selector: '.filter-bar > *',
    max: 2,
    note: 'measured 2 visual rows at 390px after the from/to pair moved inside `Bo loc` (was 3). The pair is 348px — 93% of the 374px row — so as a DIRECT bar child nothing could ever share its line and the bar\'s own fold ladder had nothing left to move. One more row means a criterion regained a full-width row, or a control lost its width floor.',
  },
  {
    id: 'shipments/phone/control-plane-height',
    role: 'cus',
    path: '/shipments',
    width: 390,
    kind: 'maxHeight',
    selector: '.shipments-control',
    max: 100,
    note: 'measured 96px at 390px: the heading + action cluster share one 40px line (the 2026-09-27 "button same row with page title" ruling) and the status tab strip owns the second at 46px, with a 10px row gap. 100 leaves 4px of headroom and still fails by 20+px if a third control row returns. Card 20260928_161 asked for 170px of TOTAL chrome including the filter bar; the measured total is 210px, because the strip holds 6 controls (heading, 2 actions, 4-cell tab strip, search, filter trigger, reset) and a phone row fits 2. CHIEF ruling on the card records why the remaining 40px was not bought by shrinking a control below the 40px touch floor.',
  },
  {
    id: 'shipments/phone/tab-cells-never-clip',
    role: 'cus',
    path: '/shipments',
    width: 390,
    kind: 'noClippedText',
    selector: '.shipments-control__tabs .ds-tabs__btn',
    note: 'the four status cells keep their intrinsic width inside the scrolling strip; a cell that compresses again clips its own count numeral (measured 2026-09-28 before the `flex: 0 0 auto` fix: countRight past btnRight on all four).',
  },
];