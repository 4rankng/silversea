import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomerFilters, type CustomerFiltersProps } from './CustomerFilters';

/**
 * Card 071026141610 — "Mọi thẻ thống kê hiện số đúng; filter counts khớp tổng"
 * — carried into the SIL-169 toolbar: every RENDERED pill carries a count,
 * and the counts are the whole-dataset figures the caller supplies.
 *
 * SIL-169 verdict (24/10) supersedes two of the old pins on purpose:
 *  - "Tạm khoá · 0" no longer renders at all — the owner called the zero tab
 *    dead weight; the tab returns the moment the census says it has rows.
 *  - the "n/total khách hàng" strip line is gone — the pills and the
 *    pagination carry the same numbers without a second row of chrome.
 * New: the "Rủi ro cao" pill joins the segment with the aging census count.
 */

function makeProps(overrides: Partial<CustomerFiltersProps> = {}): CustomerFiltersProps {
  return {
    search: '',
    onSearch: vi.fn(),
    searchInputRef: { current: null },
    filter: 'all',
    onFilter: vi.fn(),
    total: 1771,
    statusCounts: { all: 1771, active: 1700, locked: 71 },
    riskCount: 12,
    onExport: vi.fn(),
    exporting: false,
    onAdd: vi.fn(),
    onReset: vi.fn(),
    hasActiveFilters: false,
    excludeOwnFleet: false,
    onExcludeOwnFleetChange: vi.fn(),
    ...overrides,
  };
}

// Tabs renders role="tab", not button.
const pill = (name: RegExp) => screen.getByRole('tab', { name });

describe('CustomerFilters pill counts (card 071026141610 + SIL-169)', () => {
  it('gives every rendered pill a whole-dataset count, including Rủi ro cao', () => {
    render(<CustomerFilters {...makeProps()} />);

    expect(pill(/Tất cả/).textContent).toContain('1771');
    expect(pill(/Rủi ro cao/).textContent).toContain('12');
    expect(pill(/Hoạt động/).textContent).toContain('1700');
    expect(pill(/Tạm khoá/).textContent).toContain('71');
  });

  it('hides the Tạm khoá pill while it counts zero rows (SIL-169 verdict)', () => {
    render(<CustomerFilters {...makeProps({
      statusCounts: { all: 1771, active: 1771, locked: 0 },
    })} />);

    // A zero tab is dead weight the owner called out — it must not render,
    // unlike the other statuses which always show their (non-zero) count.
    expect(screen.queryByRole('tab', { name: /Tạm khoá/ })).toBeNull();
    expect(pill(/Hoạt động/).textContent).toContain('1771');
  });

  it('renders NO numeral while the census is still in flight (never a wrong 0)', () => {
    render(<CustomerFilters {...makeProps({ statusCounts: undefined, riskCount: undefined })} />);

    // A provisional 0 would read as a real measurement, so an in-flight
    // census leaves the pills unnumbered — and the zero-or-unknown Tạm khoá
    // pill stays hidden rather than guessing.
    expect(pill(/Hoạt động/).textContent).toBe('Hoạt động');
    expect(pill(/Rủi ro cao/).textContent).toBe('Rủi ro cao');
    expect(screen.queryByRole('tab', { name: /Tạm khoá/ })).toBeNull();
    // "Tất cả" still has the list total, which is known without the census.
    expect(pill(/Tất cả/).textContent).toContain('1771');
  });

  it('keeps the icon-only export button accessible and busy-labelled (card 20261006_391)', () => {
    const busy = render(<CustomerFilters {...makeProps({ exporting: true })} />);
    // SIL-169: the export is an icon button — its accessible name must still
    // say what it does, and report busy while the sheet builds.
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeDisabled();
    busy.unmount();

    render(<CustomerFilters {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy();
  });
});
