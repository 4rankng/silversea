import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DriverPayrollTable, type DriverPayrollRow } from './DriverPayrollTable';

function rows(n: number): DriverPayrollRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Lai xe ${String(i + 1).padStart(3, '0')}`,
    salary: {
      tripDays: i,
      standbyDays: i * 2,
      paidDays: i + 1,
      netSalary: (i + 1) * 1000,
      confirmationStatus: i % 2 === 0 ? 'DRAFT' : 'CONFIRMED',
    },
  }));
}

function renderTable(overrides: Partial<React.ComponentProps<typeof DriverPayrollTable>> = {}) {
  const onSelect = vi.fn();
  const onSelectionChange = vi.fn();
  render(
    <DriverPayrollTable
      drivers={overrides.drivers ?? rows(3)}
      selectedDriverId={null}
      onSelect={onSelect}
      loading={false}
      selectedIds={[]}
      onSelectionChange={onSelectionChange}
      {...overrides}
    />,
  );
  return { onSelect, onSelectionChange };
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

describe('DriverPayrollTable', () => {
  it('defaults to biggest net salary first so the roster reads as a worklist', () => {
    renderTable();
    const first = bodyRows()[0];
    expect(within(first).getByText('Lai xe 003')).toBeTruthy();
    expect(within(first).getByText('3.000 ₫')).toBeTruthy();
  });

  it('renders a computed zero as a value, never a dash (owner law D02)', () => {
    renderTable({
      drivers: [{ id: 1, name: 'Khong co luong', salary: { netSalary: 0, tripDays: 0, standbyDays: 0, confirmationStatus: 'DRAFT' } }],
    });
    expect(screen.getByText('0 ₫')).toBeTruthy();
  });

  it('pages at 25 and reports the visible window', () => {
    renderTable({ drivers: rows(30) });
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByRole('status').textContent).toContain('1–25 / 30 lái xe');

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByRole('status').textContent).toContain('26–30 / 30 lái xe');
  });

  it('sorting by name flips to ascending and reorders', () => {
    renderTable({ drivers: rows(3) });
    fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp theo Lái xe' }));
    const first = bodyRows()[0];
    expect(within(first).getByText('Lai xe 001')).toBeTruthy();
  });

  it('select-all marks only the current page', () => {
    const { onSelectionChange } = renderTable({ drivers: rows(30) });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả lái xe trên trang' }));
    // Page 1 is the money-desc head of the roster, so it carries ids 30..6 —
    // the page is selected as a unit, not the raw insertion order.
    const selected = onSelectionChange.mock.calls[0][0] as number[];
    expect(selected).toHaveLength(25);
    expect(new Set(selected)).toEqual(new Set(rows(30).slice(5).map((r) => r.id)));
  });

  it('naming a row checkbox never collides with the confirm action surface', () => {
    renderTable({ drivers: rows(2) });
    expect(screen.getByRole('button', { name: 'Sắp xếp theo Xác nhận' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  });
});
