import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnPicker } from './ColumnPicker';
import { FilterBarModeProvider } from './filter-bar-mode';
import type { LedgerColumn } from '../lib/column-visibility';

const COLUMNS: readonly LedgerColumn[] = [
  { key: 'customer', label: 'Khách hàng', pinned: true },
  { key: 'documents', label: 'Chứng từ' },
  { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
];

const renderPicker = (props: Partial<Parameters<typeof ColumnPicker>[0]> = {}, mode: 'inline' | 'dialog' = 'inline') => {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  render(
    <FilterBarModeProvider value={mode}>
      <ColumnPicker columns={COLUMNS} hidden={['notes']} customized={false} onToggle={onToggle} onReset={onReset} {...props} />
    </FilterBarModeProvider>,
  );
  return { onToggle, onReset };
};

describe('ColumnPicker — the one column-visibility control (card 20260928_193)', () => {
  it('renders one trigger on the bar, and opens a panel of the hideable columns', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Cột hiển thị' })).toBeTruthy();
    // The pinned identity column is never offered, and the two hideable ones are.
    expect(screen.queryByRole('checkbox', { name: 'Khách hàng' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Chứng từ' })).toBeChecked();
    // The auto-hidden column renders as unchecked — the panel shows the truth.
    expect(screen.getByRole('checkbox', { name: 'Ghi chú' })).not.toBeChecked();
  });

  it('reports a toggle and a reset to the page that owns the choice', () => {
    const { onToggle, onReset } = renderPicker({ customized: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chứng từ' }));
    expect(onToggle).toHaveBeenCalledWith('documents');
    fireEvent.click(screen.getByRole('button', { name: 'Mặc định' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('disables "Mặc định" while no choice has been stored', () => {
    renderPicker({ customized: false });
    fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' }));
    expect((screen.getByRole('button', { name: 'Mặc định' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders as a labelled block inside "Bộ lọc" once the bar has folded, with no trigger and no second popover', () => {
    renderPicker({}, 'dialog');
    expect(screen.getByText('Cột hiển thị')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ghi chú' })).toBeTruthy();
  });
});
