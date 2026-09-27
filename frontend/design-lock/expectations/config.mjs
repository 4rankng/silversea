// Design locks for the configuration surfaces (catalog/route master data).
//
// `/config/routes` was the page the new instrument first caught: 289 route
// names clipped at 180px inside the 768px tablet band, because two page-level
// rules (`td.routes-table__name .row-strong` and `td:nth-child(3)`, both
// `nowrap + overflow hidden + ellipsis`) out-ranked the shared wrap bands that
// the card band's release relies on — the same specificity trap class as the
// 2026-09-27 invoice-tracking `nowrap` bug. The page rules are deleted; the
// wrap contract lives in the shared bands, and these locks hold it there.

const WIDTHS = [390, 768, 1024, 1440];
const ROUTE_NAME = 'route name/short-name cells are values, not one-line tokens';

export default [
  ...WIDTHS.flatMap((width) => ([
    {
      id: `/config/routes/w${width}/no-clipped-text`,
      role: 'dieuvan',
      path: '/config/routes',
      width,
      kind: 'noClippedText',
      note: `${ROUTE_NAME} — a page-level nowrap/ellipsis here re-clips them (289 clipped at 768px before the fix)`,
    },
    {
      id: `/config/routes/w${width}/no-page-overflow`,
      role: 'dieuvan',
      path: '/config/routes',
      width,
      kind: 'noPageOverflow',
      note: 'releasing the clip must not push the table sideways',
    },
  ])),

// --- Data-dense catalogue cards (operator 2026-09-27: "redesign this to fit data
// dense UI philosophy", screenshot of /config/fuel-price-periods). The shared
// `record-table` card band (container ≤1100px) printed each fact as a label line
// above its value, so a four-fact card was 230px tall for four short facts. The
// label rides the value's line now and the rhythm is the control scale; measured
// 117px at 1147/768 and 118px at 390 (was 230 / 138). These locks hold the card
// and its label/height relationship, not a magic number per page.
  { id: 'config/fuel-price-periods/w1147/card-density', role: 'admin', path: '/config/fuel-price-periods', width: 1147, kind: 'maxHeight', selector: '.record-table tbody tr', max: 140, note: 'measured 117px after the dense rework (230px before): a card taller than this means a fact regained a label line of its own or the cell padding grew back' },
  { id: 'config/fuel-price-periods/w768/card-density', role: 'admin', path: '/config/fuel-price-periods', width: 768, kind: 'maxHeight', selector: '.record-table tbody tr', max: 140, note: 'measured 117px; the tablet band pairs the same facts two-up' },
  { id: 'config/fuel-price-periods/w1147/no-clipped-text', role: 'admin', path: '/config/fuel-price-periods', width: 1147, kind: 'noClippedText', note: 'the inline label must not clip the value beside it' },
  { id: 'config/fuel-price-periods/w768/no-clipped-text', role: 'admin', path: '/config/fuel-price-periods', width: 768, kind: 'noClippedText', note: 'same promise at the tablet width' },
  { id: 'config/ports/w1147/card-density', role: 'admin', path: '/config/ports', width: 1147, kind: 'maxHeight', selector: '.record-table tbody tr', max: 150, note: 'a second catalogue page on the same shared card band — the density is a band property, not a page one' },
];
