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
];
