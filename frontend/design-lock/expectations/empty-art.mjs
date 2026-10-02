// Design locks for the shared empty-state art (docs §6).
//
// Why these exist: on 2026-09-27 the deployed driver empty states rendered
// text-only because the illustration files were unreadable on the host (403)
// while the code was correct — an unloadable image was simply hidden by the
// primitive. Two halves are pinned per surface now:
//   - `artShown`   — the empty state actually renders shared art (a text-only
//                    face has zero illustration images),
//   - `noBrokenArt`— none of the illustrations on the page failed to load.
//
// The surfaces below are the ones a QA driver account reliably sees empty, so
// the lock is not vacuous. Operator-provided set: bell (notifications),
// wallet with a sprout (earnings/advances), container doors (shipments),
// magnifier over a box (no results), folder (documents).

const WIDTHS = [390, 768];

// Surfaces the QA driver account reliably sees empty — a lock on a surface
// that has data would be vacuous.
const EMPTY_SURFACES = [
  {
    path: '/my-payslips',
    art: 'empty-wallet.webp',
    note: 'wallet — "Chưa có kỳ lương nào" (money surfaces share the wallet art)',
  },
  {
    path: '/my-earnings',
    art: 'empty-approvals-cleared.webp',
    note: '"Chưa có khoản khấu trừ nào" — a clean deduction history is a positive state, so it gets the approvals-cleared art, not an error or money face',
  },
  {
    path: '/my-trips/two-orders',
    art: 'empty-tasks.webp',
    note: 'clipboard + truck — "Hôm nay không có lệnh"',
  },
];
//
// Not locked here, and why: the bell art (`empty-notifications.webp`) is wired to
// the notifications empty state, but this QA driver has one notification, so the
// empty face never renders for it. The resolver mapping is pinned in
// `src/lib/emptyIllustrations.test.ts`; add a bell lock once an account with an
// empty inbox exists.

// A search that matches nothing is a repeatable way to see the CUS list empty.
const FILTERED = {
  path: '/shipments?searchSuffix=zzzznope',
  role: 'cus',
  art: 'empty-no-results.webp',
  note: '"Không có lô hàng phù hợp" — the magnifier-over-a-box art (a filtered-empty is not the same empty as a fresh list)',
};

export default [
  ...EMPTY_SURFACES.flatMap(({ path, art, note }) => WIDTHS.flatMap((width) => ([
    {
      id: `${path}/w${width}/art-shown`,
      role: 'laixe',
      path,
      width,
      kind: 'artShown',
      min: 1,
      note: `${note} — ${art} must be decoded, not hidden`,
    },
    {
      id: `${path}/w${width}/no-broken-art`,
      role: 'laixe',
      path,
      width,
      kind: 'noBrokenArt',
      note: 'an illustration that failed to load must fail a measurement, never vanish silently',
    },
  ]))),
  ...WIDTHS.flatMap((width) => ([
    {
      id: `shipments-filtered/w${width}/art-shown`,
      role: FILTERED.role,
      path: FILTERED.path,
      width,
      kind: 'artShown',
      min: 1,
      note: `${FILTERED.note} — ${FILTERED.art} must be decoded, not hidden`,
    },
    {
      id: `shipments-filtered/w${width}/no-broken-art`,
      role: FILTERED.role,
      path: FILTERED.path,
      width,
      kind: 'noBrokenArt',
    },
  ])),
];
