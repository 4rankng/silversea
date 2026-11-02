# SIL-649 (id 754) — Driver Timesheet Empty-State Redesign & Stray Stripe Elimination

## 1. Problem Statement & Root Cause

### 1.1 Owner Complaint
When a month has no timesheet sheet (e.g. November 2026), the driver timesheet page (`TimesheetGridPage`) showed:
1. A stray vertical stripe artifact floating on the right (`≈ x=1252, y=142..172`, 2px wide, 31px high).
2. The empty state was a single small line of text (`.ts-hint`) floating un-centered in space with no card, no icon, and no role-adaptive layout.
3. The month navigation (`‹ Tháng 11/2026 ›`) was bare and floating directly on the page canvas with no card container.

### 1.2 Root Cause of Stray Stripe
- **Source location:** `frontend/src/pages/TimesheetGridPage.tsx:177` and `frontend/src/pages/TimesheetGridPage.css:23-26`.
- **CSS / DOM mechanism:**
  - `.ts-driver-select` inside `.ts-toolbar` (`display: flex`) had:
    ```css
    .ts-driver-select {
      max-width: 260px;
      margin-left: auto;
    }
    ```
    It had `margin-left: auto` (pinning it to the far right) but **NO width** and **NO min-width**.
  - Inside `.ts-driver-select`, `UuiSelectField` renders `<UUISelect.ComboBox>` when options ≥ 5.
  - The ComboBox has `container: uui-combobox / inline-size;` (`combobox.css:4`) and `min-width: 0`.
  - Under CSS Container Query specification rules, an inline-size container cannot derive its size from contents in the inline axis; its intrinsic size in a shrink-to-fit flex context collapses to 0.
  - The outer button border (`1px` left + `1px` right = 2px) and height `31px` rendered as an isolated 2px-wide gray stripe floating at `x=1252, y=142..172`.
  - In addition, when `driversQuery.data` was empty (`[]`), an empty select component was still being rendered in the DOM.

### 1.3 Proof the Artifact is Exterminated
1. **CSS Fix:** `.ts-driver-select` was assigned explicit sizing in `TimesheetGridPage.css`:
   ```css
   .ts-driver-select {
     width: 260px;
     min-width: 200px;
     max-width: 100%;
     margin-left: auto;
   }
   ```
   This prevents the container from ever collapsing into a 2px sliver in flex layouts.
2. **DOM Guard:** In `TimesheetGridPage.tsx`, `ts-driver-select` is rendered only when `(driversQuery.data ?? []).length > 0`. When no drivers exist in the query, zero DOM elements are emitted (no ghost/empty container).
3. **Automated Test Pin:** Added regression test `exterminates stray stripe artifact when driver list is empty or populated` in `TimesheetGridPage.test.tsx` asserting:
   - When drivers list is empty: `container.querySelector('.ts-driver-select')` is `null`.
   - When drivers exist: `.ts-driver-select` is visible with proper options and width floor.

---

## 2. Dynamic Month Source
- Derived directly from the active route parameters via `useMonthRoute()`:
  - `const { month, year, goPrev, goNext } = useMonthRoute();`
  - Dynamic title: `Chưa có bảng chấm công tháng ${String(month).padStart(2, '0')}/${year}`
  - Example for current view: `Tháng 10/2026` -> `"Chưa có bảng chấm công tháng 10/2026"`; `Tháng 11/2026` -> `"Chưa có bảng chấm công tháng 11/2026"`.
  - Zero hardcoded dates.

---

## 3. Action / CTA Audit ("Mở bảng chấm công")
- **Real API/Route Exists:** `POST /timesheet/months` via `createTimesheetMonth()` in `frontend/src/api/timesheetClient.ts:101`.
- **RBAC Policy:**
  - `canOpenBoard`: Granted to `ADMIN`, `MANAGER`, and `ACCOUNTANT` (`user?.role === Role.ACCOUNTANT`).
  - `DISPATCHER` (Điều vận): Read-only with respect to sheet creation (`canOpenBoard` is false).
- **Implementation:**
  - **Accountant / Admin / Manager:** If sheet is missing and driver is selected (`canOpenBoard && activeDriverId !== null`), the primary CTA `<Btn>Mở bảng chấm công</Btn>` is rendered in `<EmptyState action=... />`. Clicking opens the salary mode selection modal (`Modal boardFormOpen`) which executes `openBoardMutation` to `POST /timesheet/months`.
  - **Dispatcher / Other Roles:** If `canOpenBoard` is false, NO button is rendered. Only guidance text is shown: `"Kế toán mở bảng trước, sau đó Điều vận điền lưới."`
  - **No dead buttons shipped:** House law §5 respected.

---

## 4. Month Navigation Container
- Moved bare month controls into a containerized toolbar card `.ts-toolbar` with `.ts-month-picker`:
  ```css
  .ts-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md, 14px);
    min-height: 48px;
    box-sizing: border-box;
  }
  ```
- Consistent across sibling screens:
  - Shared styling imported by `TimesheetMonthlyReportPage.css`.
  - Wrapped month controls in `.ts-month-picker` for consistent touch ergonomics.
  - Mobile (<768px): Stacks toolbar vertically with full-width driver select and `justify-content: space-between` for month controls.

---

## 5. Design Lock & Mockup

### 5.1 Design Language Consulted
- **Untitled UI PRO:** Consulted component family `command-menu-empty-state` and template `email-verification/step-1-check-email` via `pnpm uui:search "empty state card"`.
- **Shared Primitive:** Reused the app's standard design-system primitive `EmptyState` (`frontend/src/design-system/EmptyState.tsx`) with `context="salary"` (resolved via `lib/emptyIllustrations.ts` to `empty-wallet.webp`).
- **House Guidelines:** `docs/design-system/03-data-display-and-feedback.md` §185-194 (Empty states + illustration resolver).

### 5.2 Responsive Mockup Location
- Mockup file created at: `testplan/2026-11-02-sil649-empty-state-mockup.html`
- Contains:
  - Desktop 1440/768 dense view with card container and accountant CTA.
  - Mobile 390 stacked card view with dispatcher guidance text.
  - Token-calibrated styles (`--bg: #E3E8E5`, `--surface: #FFFFFF`, `--line: #C4CDC7`, `--brand: #005A2D`).

### 5.3 Design Lock DOM & Class Structure
```html
<div class="ts-page">
  <PageHeader title="Chấm công lái xe" action={...} />

  <!-- Toolbar Card -->
  <div class="ts-toolbar">
    <div class="ts-month-picker">
      <button class="btn btn--ghost btn--icon btn--sm" aria-label="Tháng trước">
        <ChevronLeft size={16} />
      </button>
      <span class="ts-period">Tháng MM/YYYY</span>
      <button class="btn btn--ghost btn--icon btn--sm" aria-label="Tháng sau">
        <ChevronRight size={16} />
      </button>
    </div>
    <div class="ts-driver-select">
      <UuiSelectField label="Chọn lái xe" ... />
    </div>
  </div>

  <!-- Centered Empty State Card -->
  <div class="ts-empty-card">
    <EmptyState
      context="salary"
      title="Chưa có bảng chấm công tháng MM/YYYY"
      description="Kế toán mở bảng trước, sau đó Điều vận điền lưới."
      action={canOpenBoard ? <Btn>Mở bảng chấm công</Btn> : undefined}
    />
  </div>
</div>
```

---

## 6. Verification & Gate Evidence

### 6.1 Gate 1: TimesheetGridPage Suite
- **Command:** `cd frontend && pnpm exec vitest run src/pages/TimesheetGridPage.test.tsx`
- **Result:**
  - Test Files: 1 passed (1)
  - Tests: 9 passed (9)
  - Output log: `qa/2026-11-02_sil649_vitest_grid.txt`

### 6.2 Gate 2: Frontend Typecheck
- **Command:** `cd frontend && pnpm exec tsc -b`
- **Result:** 0 errors
- **Output log:** `qa/2026-11-02_sil649_tsc.txt`

### 6.3 Gate 3: ESLint
- **Command:** `cd frontend && pnpm exec eslint src/pages/TimesheetGridPage.tsx src/pages/TimesheetMonthlyReportPage.tsx`
- **Result:** 0 errors
- **Output log:** `qa/2026-11-02_sil649_eslint.txt`

### 6.4 Gate 4: Sibling Timesheet Suites
- **Command:** `cd frontend && pnpm exec vitest run src/pages/Timesheet`
- **Result:**
  - Test Files: 4 passed (4)
    - `src/pages/TimesheetGridPage.test.tsx` (9 passed)
    - `src/pages/TimesheetMonthlyReportPage.test.tsx` (4 passed)
    - `src/pages/TimesheetReconciliationPage.test.tsx` (6 passed)
    - `src/pages/TimesheetReconciliationPage.salary-mode.test.tsx` (1 passed)
  - Tests: 20 passed (20)
  - Output log: `qa/2026-11-02_sil649_vitest_timesheet.txt`

### 6.5 Shared Art Coverage Guard
- **Command:** `cd frontend && pnpm exec vitest run src/design-system/empty-state-art-coverage.test.ts`
- **Result:**
  - Test Files: 1 passed (1)
  - Tests: 2 passed (2)

---

```
Status: DONE
Summary: Redesigned the driver timesheet empty state to a centered card using the shared EmptyState primitive with dynamic month title and role-adaptive CTA, containerized the month navigation into a house toolbar card, and eliminated the 2px stray vertical stripe artifact caused by unconstrained flex container collapse.
Concerns/Blockers: None. All gates are green (20/20 sibling tests pass, tsc 0 errors, eslint 0 errors).
```
