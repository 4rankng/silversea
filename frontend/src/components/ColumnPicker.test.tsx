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

  it('lists a required column LOCKED — KT4 reads it checked, no offered action can hide it (FB-093 lan 3 × card 191026181942)', () => {
    const columns: readonly LedgerColumn[] = [
      { key: 'customer', label: 'Khách hàng', pinned: true },
      { key: 'tongThu', label: 'Tổng thu', essential: true },
      { key: 'container', label: 'Thông số container', essentialWhenHasData: true },
      { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
    ];
    const { onToggle } = renderPicker({ columns, hidden: ['container', 'notes'] });
    fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 2 cột' }));
    // The essential rollup is on the board and reads checked…
    const rollup = screen.getByRole('checkbox', { name: 'Tổng thu' });
    expect(rollup).toBeChecked();
    expect((rollup.closest('label') as HTMLLabelElement).className).toContain('cursor-not-allowed');
    // …the empty action column is hidden by the default and reads unchecked —
    // the truth either way, because neither can be toggled.
    expect(screen.getByRole('checkbox', { name: 'Thông số container' })).not.toBeChecked();
    // Clicking a locked row fires no toggle; the ordinary column still does.
    fireEvent.click(rollup);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Thông số container' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ghi chú' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('notes');
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

  it('SIL-560: count badge uses accent triad (accent-soft fill + accent-ink text) for WCAG AA contrast', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ColumnPicker.css'), 'utf8');
    const badge = css.match(/\.column-picker__count\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(badge).toMatch(/background:\s*var\(--accent-soft\);/);
    expect(badge).toMatch(/color:\s*var\(--accent-ink\);/);
    expect(badge).not.toMatch(/color:\s*var\(--fg-on-brand\);/);
  });
});
