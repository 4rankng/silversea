# Salary Review Fixes (3 Deferred Findings)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 deferred code review findings: N+1 confirmation query, missing confirm error feedback, and ambiguous `getGrade` naming.

**Architecture:** Three independent fixes across backend service, frontend page, and frontend utility. Each is self-contained and can be committed separately.

**Tech Stack:** Express/Drizzle (backend), React/TanStack Query (frontend), existing Toast system

---

## Files Involved

| File | Change | Task |
|------|--------|------|
| `backend/src/services/attendance.service.ts` | Add optional `confirmationMap` param to `computeSalary`; batch-fetch in `computeAllDriverSalaries` | 1 |
| `frontend/src/pages/SalaryAttendancePage.tsx` | Show error toast on confirm mutation failure | 2 |
| `frontend/src/features/penalties/utils.ts` | Rename `getGrade` → `getViolationGrade` | 3 |
| `frontend/src/features/penalties/components/PenaltyTable.tsx` | Update import/call for rename | 3 |

---

### Task 1: Batch salary confirmations (N+1 fix)

**Files:**
- Modify: `backend/src/services/attendance.service.ts:266-387`

**Problem:** `computeSalary` (line 331-340) does a per-driver SELECT on `salary_confirmations`. When `computeAllDriverSalaries` calls it N times via `Promise.all`, that's N redundant confirmation queries. The fix: batch-fetch all confirmations once, pass a lookup map into `computeSalary`.

- [ ] **Step 1: Add `ConfirmationMap` type and `confirmationMap` parameter to `computeSalary`**

At the top of `computeSalary`, add an optional `confirmationMap` parameter. When provided, use it instead of the DB query. When absent, fall back to the existing query (preserves backward compat for `confirmSalary` which calls `computeSalary` for a single driver).

In `backend/src/services/attendance.service.ts`, replace the `computeSalary` function signature and confirmation lookup:

```typescript
type ConfirmationMap = Map<number, { status: string | null; confirmedBy: number | null; confirmedAt: Date | null }>;

/**
 * Compute the full salary breakdown for a driver in a month.
 * @param confirmationMap Optional pre-fetched confirmation map (avoids N+1 in batch calls).
 */
export async function computeSalary(
  driverId: number,
  year: number,
  month: number,
  confirmationMap?: ConfirmationMap,
) {
```

Then replace the confirmation DB query block (lines 331-340) with:

```typescript
  // Get salary confirmation status — use pre-fetched map if available
  let confirmationRow: { status: string | null; confirmedBy: number | null; confirmedAt: Date | null } | undefined;
  if (confirmationMap) {
    confirmationRow = confirmationMap.get(driverId);
  } else {
    [confirmationRow] = await db.select({
      status: s.salaryConfirmations.status,
      confirmedBy: s.salaryConfirmations.confirmedBy,
      confirmedAt: s.salaryConfirmations.confirmedAt,
    }).from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driverId),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      )).limit(1);
  }
```

The rest of the return block (lines 342-357) stays unchanged — it already reads from `confirmationRow`.

- [ ] **Step 2: Batch-fetch confirmations in `computeAllDriverSalaries`**

Replace the `computeAllDriverSalaries` function body to batch-fetch all confirmations for the month in a single query, build a Map keyed by `driverId`, and pass it to each `computeSalary` call:

```typescript
/**
 * Compute salary summaries for ALL active drivers in a given month/year.
 */
export async function computeAllDriverSalaries(year: number, month: number) {
  const drivers = await db.select({
    id: s.drivers.id,
    name: s.drivers.name,
    baseSalary: s.drivers.baseSalary,
    status: s.drivers.status,
  }).from(s.drivers)
    .where(isNull(s.drivers.deletedAt))
    .orderBy(s.drivers.name);

  // Batch-fetch all confirmations for this month (eliminates N+1)
  const confirmations = await db.select({
    driverId: s.salaryConfirmations.driverId,
    status: s.salaryConfirmations.status,
    confirmedBy: s.salaryConfirmations.confirmedBy,
    confirmedAt: s.salaryConfirmations.confirmedAt,
  }).from(s.salaryConfirmations)
    .where(and(
      eq(s.salaryConfirmations.year, year),
      eq(s.salaryConfirmations.month, month),
    ));

  const confirmationMap = new Map(
    confirmations.map(c => [c.driverId, c]),
  );

  const summaries = await Promise.all(
    drivers.map(async (driver) => {
      try {
        const salary = await computeSalary(driver.id, year, month, confirmationMap);
        return { ...driver, salary };
      } catch (err) {
        console.error(`[salary] computeSalary failed for driver ${driver.id}:`, err);
        return { ...driver, salary: null };
      }
    })
  );

  return { year, month, items: summaries };
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd /Users/dev/Documents/projects/nepocorp/backend && npx tsc --noEmit 2>&1 | tail -15`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/attendance.service.ts
git commit -m "perf: batch salary confirmations to eliminate N+1 query in computeAllDriverSalaries"
```

---

### Task 2: Add confirm error feedback (toast)

**Files:**
- Modify: `frontend/src/pages/SalaryAttendancePage.tsx:485-497`

**Problem:** The confirm button at line 485-497 calls `confirmMutation.mutate()` with no error handler. If the API returns an error, the user sees nothing — the button just stops loading. The app already has a `Toast` system (`useToast` from `frontend/src/components/shared/Toast.tsx`).

- [ ] **Step 1: Import `useToast` and wire error feedback**

At the top of `SalaryAttendancePage.tsx`, add the `useToast` import. Find the existing import block and add:

```typescript
import { useToast } from '../components/shared/Toast';
```

Inside the `SalaryAttendancePage` component, after the existing hook calls (around line 170), add:

```typescript
const { toast } = useToast();
```

- [ ] **Step 2: Add error handler to the confirm button's `onClick`**

Replace the confirm button's `onClick` handler (currently `onClick={() => confirmMutation.mutate()}`) with one that shows an error toast on failure:

```typescript
onClick={() => {
  confirmMutation.mutate(undefined, {
    onError: (err: any) => {
      toast({
        kind: 'error',
        message: err?.message || 'Không thể xác nhận kỳ lương. Vui lòng thử lại.',
      });
    },
  });
}}
```

Note: `useMutation.mutate()` accepts a second argument with `onError` callback. The existing `useConfirmSalary` hook already handles `onSuccess` (invalidates queries), so we only need the error path.

- [ ] **Step 3: Run TypeScript check**

Run: `cd /Users/dev/Documents/projects/nepocorp/frontend && npx tsc --noEmit 2>&1 | tail -15`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SalaryAttendancePage.tsx
git commit -m "fix: show error toast when salary confirmation fails"
```

---

### Task 3: Rename `getGrade` → `getViolationGrade`

**Files:**
- Modify: `frontend/src/features/penalties/utils.ts:16`
- Modify: `frontend/src/features/penalties/components/PenaltyTable.tsx:112`

**Problem:** `getGrade(totalPoints)` takes a violation *count* (not points), and the name `getGrade` is generic. The spec uses "points" terminology but the input is actually `violationsInPeriod` (an integer count of violations in the filtered period). Rename to `getViolationGrade` to disambiguate.

- [ ] **Step 1: Rename function in `utils.ts`**

In `frontend/src/features/penalties/utils.ts`, rename the function from `getGrade` to `getViolationGrade`:

```typescript
export function getViolationGrade(violationCount: number): string {
  if (violationCount === 0) return 'A+';
  if (violationCount <= 2) return 'A';
  if (violationCount <= 5) return 'B';
  return 'C';
}
```

Also rename the parameter from `totalPoints` → `violationCount` for clarity.

- [ ] **Step 2: Update the import and call in `PenaltyTable.tsx`**

In `frontend/src/features/penalties/components/PenaltyTable.tsx`:

Find the import line (around line 1-5) that imports `getGrade` from `../utils` and change it to `getViolationGrade`.

Find the call site at line 112:
```typescript
const grade = getGrade(violationsInPeriod);
```
Change to:
```typescript
const grade = getViolationGrade(violationsInPeriod);
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd /Users/dev/Documents/projects/nepocorp/frontend && npx tsc --noEmit 2>&1 | tail -15`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/penalties/utils.ts frontend/src/features/penalties/components/PenaltyTable.tsx
git commit -m "refactor: rename getGrade to getViolationGrade for clarity"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 3 findings addressed — N+1 batch (#3), error toast (#6), rename (#7)
- [x] **Placeholder scan:** No TBD/TODO/fill-in-later — all code shown inline
- [x] **Type consistency:** `ConfirmationMap` type matches what `computeSalary` expects; `getViolationGrade` return type unchanged (`string`); `useToast` hook matches existing `Toast.tsx` signature
- [x] **No tests exist** for these files per codegraph (all 3 symbols marked "no covering tests found") — plan relies on `tsc --noEmit` for validation, consistent with project's current test coverage
