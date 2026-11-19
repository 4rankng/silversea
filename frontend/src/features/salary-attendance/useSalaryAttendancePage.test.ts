import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Ticket 18/11 Task 3.5b — the count law of the Lương & Chấm công page.
 *
 * The KPI "Tổng lái xe", the hero "… lái xe" line and the master-list header
 * "Lái xe (N)" must all derive from the ONE useSalaryList result: without a
 * search term the list count IS the KPI total (same array identity), and an
 * active search narrows only the list count while the KPI total stays the
 * whole roster. The backend roster itself is ACTIVE-only
 * (computeAllDriverSalaries, same ticket) — this file pins the frontend half.
 */

const salaryQueriesMock = vi.hoisted(() => ({
  useSalaryList: vi.fn(),
  useDriverSalary: vi.fn(),
  useDriverWorkDays: vi.fn(),
  useUpdateWorkDays: vi.fn(),
  useConfirmSalary: vi.fn(),
  useUnconfirmSalary: vi.fn(),
  useSalaryPeriodOverview: vi.fn(),
  useCloseSalaryPeriod: vi.fn(),
  useReopenSalaryPeriod: vi.fn(),
  useIssueSalaryPeriod: vi.fn(),
  usePostSalaryPeriod: vi.fn(),
  useRequestPostCloseAdjustment: vi.fn(),
}));

vi.mock('../../hooks/useSalaryQueries', () => salaryQueriesMock);
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'ACCOUNTANT' } }) }));
vi.mock('../../hooks/useMonth', () => ({
  useMonth: () => ({ month: 7, year: 2026, goPrev: vi.fn(), goNext: vi.fn() }),
}));
vi.mock('../../components/shared/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));
vi.mock('../../hooks/useBackShortcut', () => ({ useBackShortcut: () => undefined }));
vi.mock('../../hooks/useCatalogQueries', () => ({
  useSalaryPeriod: () => ({ data: { start: '2026-07-01', end: '2026-07-31' } }),
}));

import { useSalaryAttendancePage } from './useSalaryAttendancePage';

const mutation = () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false });

const roster = [
  { id: 1, name: 'Nguyễn Văn Ba', baseSalary: '5000000', status: 'ACTIVE', salaryMode: 'PER_TRIP', salary: null },
  { id: 2, name: 'Trần Bình', baseSalary: '5000000', status: 'ACTIVE', salaryMode: 'FLAT_MONTHLY', salary: null },
  { id: 3, name: 'Lê Hoàng Nam', baseSalary: '5000000', status: 'ACTIVE', salaryMode: 'PER_TRIP', salary: null },
];

beforeEach(() => {
  salaryQueriesMock.useSalaryList.mockReturnValue({ data: { items: roster }, isLoading: false });
  salaryQueriesMock.useDriverSalary.mockReturnValue({ data: undefined, isLoading: false });
  salaryQueriesMock.useDriverWorkDays.mockReturnValue({ data: undefined, isLoading: false });
  salaryQueriesMock.useSalaryPeriodOverview.mockReturnValue({ data: undefined, isLoading: false });
  for (const key of [
    'useUpdateWorkDays', 'useConfirmSalary', 'useUnconfirmSalary', 'useCloseSalaryPeriod',
    'useReopenSalaryPeriod', 'useIssueSalaryPeriod', 'usePostSalaryPeriod', 'useRequestPostCloseAdjustment',
  ] as const) {
    salaryQueriesMock[key].mockReturnValue(mutation());
  }
});

describe('useSalaryAttendancePage — one roster, one count law (ticket 18/11 Task 3.5b)', () => {
  it('without a search term the list count IS the KPI total (same list identity)', () => {
    const { result } = renderHook(() => useSalaryAttendancePage(''));

    expect(result.current.drivers).toBe(roster);
    expect(result.current.filteredDrivers).toBe(result.current.drivers);
    expect(result.current.aggregates.total).toBe(result.current.drivers.length);
    expect(result.current.aggregates.total).toBe(3);
  });

  it('an active search narrows the list count while the KPI total stays the roster', () => {
    const { result } = renderHook(() => useSalaryAttendancePage('hoang'));

    expect(result.current.filteredDrivers.map(d => d.name)).toEqual(['Lê Hoàng Nam']);
    expect(result.current.filteredDrivers.length).toBe(1);
    // The KPI never follows the filter.
    expect(result.current.aggregates.total).toBe(3);
    expect(result.current.aggregates.total).toBe(result.current.drivers.length);
  });

  it('the search is diacritic-insensitive, matching the page search box', () => {
    const { result } = renderHook(() => useSalaryAttendancePage('binh'));

    expect(result.current.filteredDrivers.map(d => d.name)).toEqual(['Trần Bình']);
  });
});
