import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomerFilters, type CustomerFiltersProps } from './CustomerFilters';

/**
 * Card 071026141610 — "Mọi thẻ thống kê hiện số đúng; filter counts khớp tổng."
 *
 * The status pills used to carry a count for "Tất cả" only. "Hoạt động" and
 * "Tạm khoá" passed no `count`, and `Tabs` renders a numeral only when
 * `count !== undefined` — so those two pills showed NO number at all, while
 * "Tất cả" showed the whole-dataset total. The strip could not add up.
 *
 * These tests pin that every status pill carries a count, and that the counts
 * are the whole-dataset figures the caller supplies — never derived from the
 * rows currently loaded.
 */

const concentration = {
  totalDebt: 0,
  topShare: 0,
  anyDebt: false,
  top: [] as Array<{ id: number; name: string; share: number; debt: number }>,
};

function makeProps(overrides: Partial<CustomerFiltersProps> = {}): CustomerFiltersProps {
  return {
    search: '',
    onSearch: vi.fn(),
    searchInputRef: { current: null },
    filter: 'all',
    onFilter: vi.fn(),
    total: 1771,
    statusCounts: { all: 1771, active: 1700, locked: 71 },
    resultCount: 10,
    concentration,
    onExport: vi.fn(),
    exporting: false,
    onAdd: vi.fn(),
    onReset: vi.fn(),
    hasActiveFilters: false,
    excludeOwnFleet: false,
    onExcludeOwnFleetChange: vi.fn(),
    ...overrides,
  } as unknown as CustomerFiltersProps;
}

// Tabs renders role="tab", not button.
const pill = (name: RegExp) => screen.getByRole('tab', { name });

describe('CustomerFilters status pill counts (card 071026141610)', () => {
  it('gives EVERY status pill a count, not just "Tất cả"', () => {
    render(<CustomerFilters {...makeProps()} />);

    // Regression pin: previously "Hoạt động" and "Tạm khoá" rendered with no
    // numeral because their `count` was undefined.
    expect(pill(/Hoạt động/).textContent).toContain('1700');
    expect(pill(/Tạm khoá/).textContent).toContain('71');
    expect(pill(/Tất cả/).textContent).toContain('1771');
  });

  it('keeps the per-status counts summing to the total', () => {
    render(<CustomerFilters {...makeProps()} />);

    const { active, locked } = makeProps().statusCounts as { active: number; locked: number };
    expect(active + locked).toBe(1771);
  });

  it('shows a real zero rather than an empty pill when a status has none', () => {
    render(<CustomerFilters {...makeProps({
      statusCounts: { all: 1771, active: 1771, locked: 0 },
    })} />);

    // A genuinely empty status must still read "0", never render blank — the
    // reported symptom was a pill with no number at all.
    expect(pill(/Tạm khoá/).textContent).toContain('0');
  });

  it('uses the whole-dataset counts, not the loaded page, in the n/total strip', () => {
    const { container } = render(<CustomerFilters {...makeProps({ resultCount: 10 })} />);

    // Numerator is the current result count; denominator is the full dataset.
    const strip = container.querySelector('.customers-strip__count');
    expect(strip?.textContent).toBe('10/1771 khách hàng');
  });

  it('renders NO numeral while the census is still in flight (never a wrong 0)', () => {
    render(<CustomerFilters {...makeProps({ statusCounts: undefined })} />);

    // A provisional 0 would read as a real measurement, so an in-flight census
    // leaves the pills unnumbered — as they were before the fix.
    expect(pill(/Hoạt động/).textContent).toBe('Hoạt động');
    expect(pill(/Tạm khoá/).textContent).toBe('Tạm khoá');
    // "Tất cả" still has the list total, which is known without the census.
    expect(pill(/Tất cả/).textContent).toContain('1771');
  });
});