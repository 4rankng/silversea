import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const queries = vi.hoisted(() => ({ useSalaryPeriod: vi.fn(), useDriverPenalties: vi.fn() }));
vi.mock('../hooks/useQueries', () => queries);
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }), useListAnimations: () => ({ rootRef: { current: null } }) }));
vi.mock('../components/UI', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
import DriverPenaltyPage from './DriverPenaltyPage';

describe('driver deduction summary known versus unavailable amount', () => {
  beforeEach(() => {
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, isError: false });
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' }, isLoading: false, isError: false });
  });
  function deductionValue() {
    return screen.getByText(/^Khấu trừ T/).closest('.kpi')?.querySelector('.kpi__value');
  }
  it('renders zero currency for a successfully loaded period with no deductions', () => {
    render(<DriverPenaltyPage />);
    expect(deductionValue()?.textContent).toBe('0₫');
  });
  it('keeps an unknown amount distinct when the period read fails', () => {
    queries.useSalaryPeriod.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<DriverPenaltyPage />);
    expect(deductionValue()?.textContent).toBe('—');
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
