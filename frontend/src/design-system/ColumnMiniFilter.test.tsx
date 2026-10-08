import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnMiniFilter } from './ColumnMiniFilter';

/**
 * ColumnMiniFilter — the ONE per-column quick filter. These cases pin the
 * interaction contract the register board depends on: the header keeps its
 * label, the popover portals to <body> (overlay law), typing + Enter or the
 * `Lọc` button commits, `Bỏ lọc` clears, Escape hands focus back to the
 * trigger.
 */

function renderFilter(overrides: Partial<Parameters<typeof ColumnMiniFilter>[0]> = {}) {
  const onApply = vi.fn();
  const onClear = vi.fn();
  const props = {
    label: 'Thông tin xe',
    value: '',
    placeholder: 'Nhập biển số xe',
    dialogLabel: 'Lọc Thông tin xe',
    onApply,
    onClear,
    ...overrides,
  };
  const view = render(<ColumnMiniFilter {...props} />);
  return { ...view, onApply, onClear };
}

describe('ColumnMiniFilter', () => {
  it('keeps the column label as the trigger name and opens the filter dialog', () => {
    const { container } = renderFilter();
    const trigger = screen.getByRole('button', { name: 'Thông tin xe' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Overlay law: the panel is portaled to <body>, never nested in the header.
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Lọc Thông tin xe' });
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Thông tin xe' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Lọc Thông tin xe' })).toBeInTheDocument();
    expect(container.querySelector('.column-mini-filter__popover')).toBeNull();
  });

  it('applies the typed value with Enter, trimmed, and closes', () => {
    const { onApply } = renderFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin xe' }));
    const input = screen.getByRole('textbox', { name: 'Lọc Thông tin xe' });
    fireEvent.change(input, { target: { value: '  51A-123  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith('51A-123');
    expect(screen.queryByRole('dialog', { name: 'Lọc Thông tin xe' })).toBeNull();
  });

  it('hands the trimmed draft to onApply via the Lọc button', () => {
    const { onApply } = renderFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin xe' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Lọc Thông tin xe' }), { target: { value: ' Gaya ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));
    expect(onApply).toHaveBeenCalledWith('Gaya');
  });

  it('seeds the draft from the applied value on reopen and marks the applied state', () => {
    renderFilter({ value: '51A-123' });
    const trigger = screen.getByRole('button', { name: 'Thông tin xe' });
    expect(trigger.querySelector('.column-mini-filter__dot')).not.toBeNull();
    fireEvent.click(trigger);
    const input = screen.getByRole('textbox', { name: 'Lọc Thông tin xe' }) as HTMLInputElement;
    expect(input.value).toBe('51A-123');
  });

  it('Bỏ lọc clears and closes without applying the draft', () => {
    const { onApply, onClear } = renderFilter({ value: '51A-123' });
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin xe' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Lọc Thông tin xe' }), { target: { value: 'bỏ hết' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Lọc Thông tin xe' })).toBeNull();
  });

  it('Escape closes the dialog and returns focus to the trigger', async () => {
    renderFilter();
    const trigger = screen.getByRole('button', { name: 'Thông tin xe' });
    fireEvent.click(trigger);
    const input = screen.getByRole('textbox', { name: 'Lọc Thông tin xe' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Lọc Thông tin xe' })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('clicks on dead space close the dialog', () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin xe' }));
    expect(screen.getByRole('dialog', { name: 'Lọc Thông tin xe' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Lọc Thông tin xe' })).toBeNull();
  });
});
