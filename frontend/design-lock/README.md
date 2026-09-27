# design-lock — lock a design you have approved

The problem this solves: a screen looks right on Tuesday, a later session edits
CSS/markup, and the *rendered* result regresses while every existing test stays
green. `pnpm test` proves behaviour, not appearance; the page-level CSS tests
assert that a rule **exists in the file**, which an override elsewhere (a
higher-specificity desktop rule winning in a card band — the 2026-09-27
`nowrap` bug) defeats silently.

A **lock** is one measured promise about one surface at one viewport width.
Locks are measured in a real browser against the running dev server, so a lock
holds no matter how the CSS is refactored, renamed, or re-specificitied.

## Run

```bash
cd frontend
pnpm design:lock                 # every lock, exits 1 on any drift
pnpm design:lock --only dispatch # filter by id substring
```

Evidence lands in `qa/design-lock/` (gitignored): `report.json` plus a
screenshot of every failing lock.

## Add a lock when you approve a design

```bash
# 1. Measure the surface you just approved (prints its live geometry)
node scripts/design-lock.mjs --probe dieuvan /dispatch-detail 390

# 2. Write the promise into the matching expectations module
```

`design-lock/expectations/*.mjs` export one array of lock objects:

```js
export default [
  {
    id: 'dispatch-detail/phone/record-card-height',
    role: 'dieuvan',            // cus | dieuvan | laixe | ops
    path: '/dispatch-detail',
    width: 390,                 // 390 phone, 768 tablet (touch), 1440 desktop
    kind: 'maxHeight',
    selector: '[class*="__rule"]',   // first visible match
    max: 240,
    note: 'a nine-label phone card was 469px before 2026-09-26',
  },
];
```

## Kinds

| kind | promise | extra keys |
|---|---|---|
| `noPageOverflow` | the document never scrolls sideways | — |
| `noClippedText` | no text node is truncated by `overflow:hidden`/ellipsis | `max` (default 0) |
| `tapFloor` | every visible control is ≥ 44px on touch widths | `min` (default 44) |
| `minFont` | no text renders below the caption token | `min` (default 11) |
| `maxHeight` / `minHeight` | element box height | `max` / `min`, `tol` |
| `maxWidth` / `minWidth` | element box width (e.g. a control must not stretch) | `max` / `min`, `tol` |
| `maxTop` | **chrome budget**: the first record starts no lower than N px | `max` |
| `count` | ≤ N visible matches in a region | `max`, `selector` |
| `visible` / `hidden` | element is / is not rendered | `selector` |
| `inline` | two selectors share one line box | `selector`, `other`, `tol` |
| `rows` | a container lays its children out in N visual rows | `selector`, `n` |
| `computed` | **the winning** declaration equals a value | `selector`, `prop`, `equals` |
| `unscrolled` | an inner container does not hide its own overflow | `selector` |
| `noBrokenArt` | no shared illustration on the page failed to load | `max` (default 0) |
| `artShown` | at least N shared illustrations are on screen **and decoded** | `min` (default 1) |

`noBrokenArt` / `artShown` are the two halves of the empty-state art promise
(docs §6). An illustration the browser could not load is *invisible by design* —
`EmptyState` hides it and renders text-only — so an unloadable file looks merely
plainer in review, never broken. `noBrokenArt` catches that case; `artShown`
catches the other one, a surface that forgot its art entirely (a text-only face
has zero illustration images). Both are measured on a page that is reliably
empty, otherwise the lock is vacuous.

`computed` is the specificity-proof kind: it asks the browser for the value
that actually won, not the value some rule in the file declares. Use it for
every trap where a broader selector can silently out-rank the approved one
(`white-space`, `display`, `font-size`, `overflow`, `grid-template-columns`).

## Reaching a surface that is not on screen at load

| key | effect |
|---|---|
| `open: 'drawer'` | opens the filter drawer (the `Bộ lọc` trigger) before measuring — for locks on drawer-only surfaces |
| `click: '<selector>'` | clicks a selector first, for locks that describe an applied state (e.g. an active preset cell) |

## Rules

- A lock's `note` states the incident it prevents (what it looked like broken
  and when). Locks without evidence rot silently.
- Lock what the eye judges — heights, rows, inline-ness, clipping — not
  incidental values that a legitimate redesign may move.
- Every `docs/design-guidelines.md` ruling that a later session could undo
  should have a lock here, and the ruling row should name its lock id.
- Locks are measured on real seeded data. A lock that only passes on an empty
  page locks nothing; pick a route with rows.
