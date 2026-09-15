import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnPropertyPanel } from './debit-note-template-columns';
import { cloneStarterColumns } from './debit-note-template-editor-utils';

describe('selected template column inspector', () => {
  it('selects a late column from the navigator and changes the current column visibility', () => {
    const columns = cloneStarterColumns();
    const selected = columns.at(-1)!;
    const onSelectColumn = vi.fn();
    const onToggleColumnVisibility = vi.fn();
    const onReorder = vi.fn();
    const onChange = vi.fn();
    render(<ColumnPropertyPanel column={selected} columns={columns} disabled={false}
      onChange={onChange} onSelectColumn={onSelectColumn} onToggleColumnVisibility={onToggleColumnVisibility} onReorder={onReorder} />);

    expect(screen.getByText(`Thuộc tính cột — ${selected.label}`)).toBeVisible();
    const navigator = screen.getByRole('button', { name: 'Cột đang chỉnh' });
    fireEvent.click(navigator);
    fireEvent.click(screen.getByRole('option', { name: `1. ${columns[0].label}` }));
    expect(onSelectColumn).toHaveBeenCalledWith(columns[0].id);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hiện cột' }));
    expect(onToggleColumnVisibility).toHaveBeenCalledWith(selected);
    fireEvent.change(screen.getByLabelText('Tiêu đề cột'), { target: { value: 'Updated selected column' } });
    expect(onChange).toHaveBeenCalledWith({ label: 'Updated selected column' });
    expect(screen.getByRole('button', { name: 'Đưa xuống sau' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Đưa lên trước' }));
    const reordered = onReorder.mock.calls[0][0];
    expect(reordered.at(-2)).toEqual(selected);
    expect(reordered.at(-1)).toEqual(columns.at(-2));
    expect(columns.at(-1)).toEqual(selected);
  });
});
