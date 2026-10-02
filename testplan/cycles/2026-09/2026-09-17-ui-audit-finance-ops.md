# Accounting and OPS local UI audit — 2026-09-17

Base: `prod` 756ec1cc, preserving the existing uncommitted changes. Local app `http://localhost:7175`, API `http://localhost:3001`. This plan is written before the new audit fixes. Local QA records may be used; no production or external messages.

## Acceptance cases

| ID | Role / surface | Actions and expected outcome |
|---|---|---|
| FIN-UI-01 | ACCOUNTANT navigation | Follow available finance/accounting, expenses, advances, cash, debt/payables, reports and settlement navigation. Each destination renders its own content without application errors or an unexplained empty screen. |
| FIN-UI-02 | OPS navigation | Follow orders, job detail, fleet, wallet, advances and settlements. Preserve role boundaries and offer clear return navigation from detail/create screens. |
| FIN-UI-03 | Both / responsive | Inspect 360, 390, 820 and 1440px layouts. No page-level horizontal overflow, clipped fields/dialog actions, overlapping labels or visible mobile vertical scrollbar. Tables may own a horizontal scroller where necessary. |
| FIN-UI-04 | Both / filters and search | Click, type, clear and select actual searchable controls, including Vietnamese text, nonmatching text and existing values. Results and empty states correspond to the displayed query; clearing restores choices/results. Filter controls use one consistent height at each density. |
| FIN-UI-05 | Both / dialogs and dates | Open/cancel/reopen forms; use date/time selectors and keyboard input. Picker interaction does not dismiss its owning dialog. Focus and draft contents behave predictably. Escape/backdrop affects only the intended overlay. |
| FIN-UI-06 | Both / validation and recovery | Submit incomplete/invalid local forms; correct values. Show actionable field errors without clearing drafts or accepting invalid amounts. An API failure retains current input and permits a deliberate retry, with no automatic replay. |
| FIN-UI-07 | Accounting / financial meaning | Read list/detail/export amounts and labels. Actual cost, customer charge, allocated advances and actual receipts remain distinct; direct financial operations retain existing role/lock/idempotency protections. |
| FIN-UI-08 | Both / regression | For every confirmed bug, add a specific reproducible case here before code changes, a meaningful unit regression when feasible, and repeat the actual browser interaction after the fix. Record tested routes, evidence, failures and gaps accurately. |

## Execution evidence

Evidence directory: `qa/2026-09-17-ui-audit/finance-ops/`.
Detailed results and uncovered cases: `plans/260917-ui-audit/reports/finance-ops.md`.
Initial status: NOT RUN. Browser smoke, actual interaction and database verification are separate evidence levels; a route screenshot alone is not complete flow coverage.

## Confirmed regressions to fix

| ID | Reproduction before fix | Acceptance |
|---|---|---|
| FIN-UI-09 | `/expenses/new`, click empty supplier/category and type directly. Text becomes `Chọn nhà cung cấp…Hai` / `Chọn hạng mục…Bảo`, with no options. | Empty option acts as placeholder, typed query starts empty, selected value can be replaced by typing. Clearing restores choices. Shared component fix coordinated with root. |
| FIN-UI-10 | `/expenses/new` at 1440px: text/date/amount controls are 40px; select controls are 30px; cancel/save are 43/46px. | Ordinary expense form uses semantic `md` sizing for all selects and standard action buttons; common row controls align. Mobile controls retain the touch floor. |
| FIN-UI-11 | ACCOUNTANT opens `/expenses/999999999/edit`; GET returns 404, but page presents an empty editable form and “Cập nhật”. | Show an explicit load failure with retry and return actions. Do not show editable financial form or submit when the source record has not loaded. A successful retry restores the actual record. |
| FIN-UI-12 | Expense catalog request fails or becomes unavailable before entering `/expenses/new`. Current form silently shows empty supplier/category choices. | Show a visible catalog error with deliberate retry; preserve typed notes/amount/date and photos; disable submission while required catalogs are unavailable. A successful retry restores options without discarding draft. |
| FIN-UI-13 | OPS `/ops/orders` → “Khai chi phí” → type `nâng` into “Loại phí” → Escape: the entire expense dialog closes and draft is lost. | Escape first dismisses the nested picker and keeps the expense dialog/draft. Escape from an ordinary dialog control closes the dialog and restores opener focus. Verify both searchable and date pickers. |
| FIN-UI-14 | Search a nonexistent shipment on OPS `/ops/orders`: empty result says there are no shipments that day, although clearing returns nine rows. | Distinguish no search match from an empty day; offer one clear-search action that restores that day’s results and keeps the selected date. Display day caption using the app’s Vietnamese date format. |
| FIN-UI-15 | ACCOUNTANT `/advances` at 360px: decorative KPI images overlap totals; the amount `108.069.000 ₫` splits into `108.069.` / `000 ₫` because obsolete image padding reserves 48px. | Remove the redundant decorative images and reserved padding from advance/settlement summaries; totals have the available column width and remain readable at 360/390/820/1440px. |
| FIN-UI-16 | ACCOUNTANT `/finance/treasury`390: account name, account code, funding source and conversion status concatenate without line spacing because the responsive table overrides the cell's grid. | Account identity has its own internal stack independent of table-cell layout. Name, code/type, fund, and conversion text each retain a separate readable line at360/390/820/1440; sorting/actions unchanged. Browser geometry verifies the layout, with existing component regressions rerun. |
| FIN-UI-17 | ACCOUNTANT `/finance`820: shared summary rail splits `25.580.000 ₫` inside digits and `63.2 %` between value/unit. | Summary adapts label/value layout before digits are broken; money stays a readable single number and values remain contained. Shared SummaryRail fix coordinated with root. |
| FIN-UI-18 | ACCOUNTANT `/accounting/fuel-evidence`390: the filter wrapper retains a220px flex basis when the toolbar becomes a column, leaving about200px of empty space before the result. | Mobile uses a natural-height full-width filter; status/results follow within the normal toolbar gap. At360/390/820/1440, verify empty and filtered states have no reserved blank block or page overflow. This flex-axis layout regression requires actual browser geometry; retain the measured visual check rather than a unit assertion that merely mirrors CSS. |

## PRD-directed follow-up

| ID / requirement | Reproduction / actions | Acceptance |
|---|---|---|
| FIN-PRD-01 / OpsVanHanh §3.3, §6; O2C §8.1 | Fail `/ops/expense-types` with503 before opening create or editable own-expense dialog. Enter amount/note; restore the API and retry. | Distinguish loading, failed and genuinely empty catalogs. Show an explicit retry without closing the dialog or discarding draft/photo selection. Do not submit or silently offer an empty fee selector while required catalog data is unavailable. After recovery, select the real fee and continue with the retained draft. |
| FIN-PRD-02 / O2C §7.5, §8.1–8.2; TC-CP-KT-12/22 | Open an actual cash voucher from the accounting expense board; enter a partial amount, fund/account/reference; return503 on its POST. Restore connectivity without clicking, then explicitly retry; cancel without any real money write in this probe. | Failure retains the amount/reference/account and owning drawer. Reconnect alone sends no POST. Explicit retry reuses the same transaction identity; blocked requests leave source and cash totals unchanged. This browser probe does not claim server commit/replay correctness; the full integration suite covers that separately. |
