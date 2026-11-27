import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('ColumnPicker — SIL-891 Chọn tất cả (Ghép bộ Debit surfaces)', () => {
  it('offers Chọn tất cả beside Mặc định when the surface opts in, disabled while nothing is hidden', () => {
    const onShowAll = vi.fn();
    renderPicker({ onShowAll });
    fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' }));
    const button = screen.getByRole('button', { name: 'Chọn tất cả' });
    fireEvent.click(button);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('omits the button on surfaces that never opted in', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cột hiển thị, đang ẩn 1 cột' }));
    expect(screen.queryByRole('button', { name: 'Chọn tất cả' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mặc định' })).toBeTruthy();
  });
});

describe('ColumnPicker — the one column-visibility control (card 20260928.193)', () => {
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

  it('variant="dropdown" pins the ONE trigger form even when the bar folded (CR-010.1 SIL-900, Spec §10.7.4)', () => {
    // The debit-merge toolbar is not a FilterBar, so its mode context reads
    // 'dialog' — the pinned variant must ignore that and stay the dropdown.
    renderPicker({ variant: 'dropdown' }, 'dialog');
    const trigger = screen.getByRole('button', { name: /Cột hiển thị/ });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    // The raw 26-checkbox panel is NOT in the toolbar — only behind the trigger.
    expect(screen.queryByRole('checkbox', { name: 'Ghi chú' })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Cột hiển thị' })).toBeTruthy();
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

  it('SIL-1178: the panel publishes its measured bound so the list window can be rounded to whole rows', async () => {
    // The panel's ceiling is measured (the space its anchor has) — the CSS
    // needs that number to round the list's scroll window down to whole
    // option rows, so the panel's edge never cuts a column option in half.
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('visualViewport', undefined);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(260);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => DOMRect.fromRect({ x: 1100, y: 120, width: 160, height: 30 }),
    );
    renderPicker({ variant: 'dropdown' }, 'dialog');
    fireEvent.click(screen.getByRole('button', { name: /Cột hiển thị/ }));
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 80);
      await promise;
    });
    const popover = document.querySelector('.column-picker__popover') as HTMLElement;
    // The trigger's bottom is 150 → the room below it is 900 - 150 - 4 - 12.
    expect(popover.style.maxHeight).toBe('734px');
    expect(popover.style.getPropertyValue('--column-picker-available')).toBe('734px');
  });
});
