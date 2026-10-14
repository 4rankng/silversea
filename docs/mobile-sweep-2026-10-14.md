# Mobile Responsive Sweep — 2026-10-14

Two sweeps landed on this date. The first (`a2069021`) recorded "no layout
breaks found" from a browser-automation run. A second, independently driven
sweep (M3.1, branch `fix/mobile-sweep-m31`) re-measured the same pages with
verified detectors and is the record that supersedes it. Where the two differ,
the corrected findings are in **Ambiguous / out-of-scope** below.

## Scope (M3.1)

Viewports **375** and **768**. Pages: login, dashboard, customer debt pages
(list, detail, customers, customer detail) and the reports section
(`/profit`, `/finance` — the app has no `/reports` route; `section: 'reports'`
in `Layout.tsx:107-108` maps to those two).

Fix mandate was narrow — **clear layout breaks only**: horizontal overflow,
clipped columns, stacked-action overflow, truncation. Touch-target size,
text-size floors, row-height contracts and search width floors were
deliberately NOT measured, because other running agents own those contracts
(see `paseo ls` at sweep time).

## Method

Isolated stack (the machine's :3002/:7175 pair belongs to another agent's
worktree, so this sweep ran its own backend on **:3012** and frontend on
**:7275** against the existing `ss-prod-db`/`ss-prod-redis` containers).
Role `admin`, token injected into `localStorage` before SPA navigation, as
`puppeteer-spa-auth` requires.

Debt detail id was resolved from `GET /reports/receivables-aging` (customer
16825, a row with a real 4.500.000 ₫ balance) — the debt list navigates by JS
`onClick`, so there are no `href`s to scrape.

Three measurement passes, in `qa/mobile-sweep-m31/`:

1. `driver.mjs` — geometry: `hscroll`, `offscreen`, `clipped`. Scrolls to full
   document height before measuring, and the horizontal test is
   scroll-invariant, so below-the-fold defects are caught (these pages are long).
2. `actions.mjs` — `actionOverflow` (control text cut off) and `truncation`
   (single-line ellipsis on digit-bearing values, i.e. money/qty/dates).
3. `interact.mjs` — four real clicks (nav drawer, `/debt` grouping accordion,
   `/debt/:id` aging disclosure, `/finance` month popover) with a post-click
   state assertion, so a silent no-op click cannot masquerade as a pass.

### Detector self-checks

A clean sweep is only evidence if the detector can fail. Both were checked
against injected defects (`selfcheck.mjs`, `selfcheck2.mjs`):

- 2000px-wide block → `hscroll` fires, offender located.
- Below-the-fold 900px block → `offscreen` fires (confirms the scroll pass).
- `overflow:hidden` nowrap text → `clipped` fires.
- 80px button with ellipsis → `actionOverflow` fires.
- Ellipsised money string → `truncation` fires; ellipsised prose does not.

## Result

**No clear layout breaks in scope.** 16 page/width combinations across 8 pages,
plus 8 click-state measurements, all zero defects, zero page errors.

| Page | 375 | 768 | Evidence |
|---|---|---|---|
| Login `/login` | ok | ok | `login-375.png`, `login-768.png` |
| Dashboard `/dashboard` | ok | ok | `dashboard-*.png` |
| Debt list `/debt` | ok | ok | `debt-list-*.png` |
| Debt detail `/debt/16825` | ok | ok | `debt-detail-*.png` |
| Customers `/customers` | ok | ok | `customers-*.png` |
| Customer detail `/customers/1` | ok | ok | `customer-detail-*.png` |
| Profit report `/profit` | ok | ok | `report-profit-*.png` |
| Finance report `/finance` | ok | ok | `report-finance-*.png` |

Artifacts: `qa/2026-10-14_mobile-sweep-m31/` (screenshots, `findings.json`,
`action-truncation.json`, `interaction.json`, drivers).

## Ambiguous / out-of-scope — recorded, NOT redesigned

### 1. `.risk-dot` renders 0×0 on `/customers` and `/debt` — real defect, wrong sweep

`CustomersPage.tsx:588` and `DebtListPage.tsx:434,511` emit
`<span class="risk-dot risk-dot--{level}" />`, but the only rule for it lives in
`DashboardPage.css:145-149`, which `DashboardPage.tsx:21` imports. Neither
`CustomersPage.css` nor `DebtListPage.css` defines it, and it is in no global
sheet. Measured: 10 dots on `/customers` and 26 on `/debt` at width 0, height 0,
`background-color: rgba(0,0,0,0)`, `display: inline`.

Not fixed here, for two reasons. It is a **CSS-scope bug, not a layout break** —
it is width-independent (identical 0×0 at 1440), so fixing it is not a mobile
sweep concern. And the fix is a design decision, not a mechanical one: either
move `.risk-dot` to a shared sheet, or define it per page — that changes which
sheet owns a shared primitive, which is exactly the kind of call that should be
ruled on rather than absorbed into a layout pass. **Recommend a follow-up card.**

### 2. Dashboard KPI label wraps to 3 lines at 375 — density, not a break

`.wf-kpi .lbl` ("Doanh thu · 10/2026") is 72.5px wide at 375 and wraps to three
lines beside the delta chip. Measured `overflow: visible`, `scrollHeight ==
clientHeight`, so nothing is clipped — it wraps. Ambiguous because it is
visibly cramped and the fix would be a density/column change, not a break fix.
No change made.

### 3. The 3px green rail on `/customers` cards is intentional

Each `m-card` carries an absolutely-positioned 3px accent span at `left: 9`,
inside the card box. It reads as "clipped at the edge" in a screenshot but is
fully within the card. No change.

### 4. Corrections to the first sweep's notes

`a2069021` stated "touch targets meet 44px minimum on mobile". The repo's own
ruling (2026-09-27, card 20260930_217) is that the touch floor **is**
`--control-max-h` = **40px**; 44 was the value that generated false positives.
It also noted "some flaky tests when run together" without naming them. Both
claims are not carried forward here — M3.1 measured neither.

## Gates

| Gate | Command | Result |
|---|---|---|
| Frontend typecheck | `cd frontend && npx tsc -b` | **0 errors**, exit 0 |
| Frontend build | `cd frontend && npx vite build` | succeeded, exit 0 |
| Frontend tests | `cd frontend && pnpm test` | **4785 passed / 1 failed** (629 files) |

### The one failing test is pre-existing on `main` — not caused by this sweep

`src/tests/dev-port-contract.test.ts > leaves no live QA script hardcoding a
frontend port` fails on:

```
scripts must use 7175 (frontend) / 3002 (api):
uibatch-ui-rung.mjs:3013, uibatch-ui-rung.mjs:7186, uibatch-ui-rung.mjs:3013
```

That file is `testplan/qa/scripts/uibatch-ui-rung.mjs`, committed to `main` in
`b3323012` and present unchanged on `main` today (`git show main:testplan/qa/scripts/uibatch-ui-rung.mjs`).
It hardcodes 3013/7186 behind a deliberate comment — *"HANDOFF hazard: never
proxy :3002"* — so the test and the script genuinely disagree, and the
disagreement predates this branch.

Proof it is not mine: this worktree differs from `main` by exactly one file,
`docs/mobile-sweep-2026-10-14.md`. No `src/` file was touched.

Deliberately **not** fixed here. It is unrelated to a mobile layout sweep, and
repointing that harness's ports would desync the QA run another agent has live
right now (its `uibatch-throwaway-db`/`-redis` containers on :5444/:6394 are
still up). Per AGENTS.md §2/§4, unrelated in-flight work is preserved rather
than absorbed. **Recommend a separate card for whoever owns the UI-batch
harness.**

### Two other initial failures were environmental, not defects

- `src/styles/numeric-identity.styles.test.ts` (2 tests) pins the **production**
  CSS bundle and throws `dist/assets missing — run pnpm build first` on a fresh
  worktree. `npx vite build` (exit 0) made both pass.
- `src/components/work-inbox/RoleWorkInbox.test.tsx > preserves restored queue
  and page through first asynchronous customer scope hydration (UI43)` failed on
  the first full run and passed on re-run and in the final run — an async
  timing test, not a regression from this work.

Scope was frontend-only (no source change), so backend/shared gates were not
run — per AGENTS.md §5 those are required only when the change can affect them.


## Commits

No page required a fix, so there are **no per-page fix commits**. The only
commit on `fix/mobile-sweep-m31` is this document.

## Coverage limits (AGENTS.md §9)

Pages were loaded and measured at both widths and four controls were really
clicked (each with a screenshot and a post-click state assertion). Coverage
rungs are stated per claim, not blanket "works end-to-end".

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| No hscroll/offscreen/clipped on the 8 pages at 375+768 | UI DRIVEN | `qa/2026-10-14_mobile-sweep-m31/*.png`, `findings.json` | Other roles (driver/CUS/dispatcher surfaces); 360/414/600/820/1024 |
| No action overflow / value truncation on the same pages | UI DRIVEN | `action-truncation.json` | Prose labels behind a deliberate ellipsis (by design, not measured) |
| Nav drawer, debt accordions, finance month popover stay clean when opened | UI DRIVEN | `ix-*.png`, `interaction.json` | Keyboard-only navigation paths; screen-reader announcement |
| `.risk-dot` is unstyled off-dashboard | DB/API VERIFIED (computed style) | `probe-riskdot.mjs` output above | Visual confirmation of intended dot appearance — needs the design ruling |
| Everything else on these pages | CODE-READ ONLY | — | No behaviour beyond load + the four clicks was exercised |

Local-only: no production UI or database was touched. No deploy performed.
