import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ColumnPicker } from './ColumnPicker';
import { FilterBarModeProvider } from '../design-system/filter-bar-mode';
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

  it.each(['inline', 'dialog'] as const)('reports toggle/reset unchanged in the %s placement', (mode) => {
    const { onToggle, onReset } = renderPicker({ customized: true }, mode);
    if (mode === 'inline') fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chứng từ' }));
    expect(onToggle).toHaveBeenCalledWith('documents');
    fireEvent.click(screen.getByRole('button', { name: 'Mặc định' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it.each(['inline', 'dialog'] as const)('disables reset without a stored choice in the %s placement', (mode) => {
    renderPicker({ customized: false }, mode);
    if (mode === 'inline') fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' }));
    expect((screen.getByRole('button', { name: 'Mặc định' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders as a labelled block inside "Bộ lọc" once the bar has folded, with no trigger and no second popover', () => {
    renderPicker({}, 'dialog');
    expect(screen.getByText('Cột hiển thị')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ghi chú' })).toBeTruthy();
  });

  it('reserves the complete reset label while the folded options wrap within their available track', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ColumnPicker.css'), 'utf8');
    const reset = css.match(/\.column-picker__reset\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(reset).toMatch(/flex-shrink:\s*0/);
    expect(reset).toMatch(/white-space:\s*nowrap/);
    const body = css.match(/\.column-picker--inline \.column-picker__body\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(body).toMatch(/width:\s*100%/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
    const options = css.match(/\.column-picker--inline \.column-picker__options\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(options).toMatch(/min-width:\s*0/);
    expect(options).toMatch(/flex:\s*1\s+1\s+0\s*;/);
  });
});
