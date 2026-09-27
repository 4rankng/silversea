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
];
