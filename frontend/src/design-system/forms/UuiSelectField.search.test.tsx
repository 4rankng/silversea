import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UuiSelectField } from './UuiSelectField';

const options = [
  { value: '', label: 'Tất cả tuyến' },
  { value: '1', label: 'Hải Phòng — Quế Võ' },
  { value: '2', label: 'Đông Mai' },
  { value: '3', label: 'Hà Nội' },
  { value: '4', label: 'Đã ngừng', disabled: true },
];

describe('searchable field catalogue refresh', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 120, y: 200, width: 280, height: 34 }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the empty label as a placeholder so the first typed term searches directly', async () => {
    render(<UuiSelectField label="Tuyến" value="" onChange={vi.fn()} options={options} />);
    const input = screen.getByRole('combobox', { name: 'Tuyến' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Tất cả tuyến');
    await act(async () => { input.focus(); fireEvent.click(input); });
    fireEvent.change(input, { target: { value: 'que vo' } });
    expect(await screen.findByRole('option', { name: 'Hải Phòng — Quế Võ' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('selects the committed label on focus for replacement typing', async () => {
    render(<UuiSelectField label="Tuyến" value="1" onChange={vi.fn()} options={options} />);
    const input = screen.getByRole('combobox', { name: 'Tuyến' }) as HTMLInputElement;
    await act(async () => { input.focus(); fireEvent.click(input); });
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Hải Phòng — Quế Võ'.length);
    fireEvent.change(input, { target: { value: 'dong mai' } });
    expect(await screen.findByRole('option', { name: 'Đông Mai' })).toBeInTheDocument();
  });

  it('does not reselect a typed query when a popup restores input focus', async () => {
    render(<UuiSelectField label="Tuyến" value="1" onChange={vi.fn()} options={options} />);
    const input = screen.getByRole('combobox', { name: 'Tuyến' }) as HTMLInputElement;
    await act(async () => { input.focus(); fireEvent.click(input); });
    fireEvent.change(input, { target: { value: 'q' } });
    input.setSelectionRange(1, 1);
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
    fireEvent.change(input, { target: { value: 'que vo' } });
    expect(await screen.findByRole('option', { name: 'Hải Phòng — Quế Võ' })).toBeInTheDocument();
  });

  it('preserves a focused search when the parent supplies equivalent or extended options', async () => {
    const onChange = vi.fn();
    const view = render(<UuiSelectField label="Tuyến" value="" onChange={onChange} options={options} />);
    const input = screen.getByRole('combobox', { name: 'Tuyến' });
    await act(async () => { input.focus(); fireEvent.click(input); });
    fireEvent.change(input, { target: { value: 'que vo' } });
    await screen.findByRole('option', { name: 'Hải Phòng — Quế Võ' });
    view.rerender(<UuiSelectField label="Tuyến" value="" onChange={onChange} options={options.map(o => ({ ...o }))} />);
    expect(input).toHaveValue('que vo');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    view.rerender(<UuiSelectField label="Tuyến" value="" onChange={onChange} options={[...options, { value: '5', label: 'Quế Võ — Hà Nội' }]} />);
    expect(input).toHaveValue('que vo');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resynchronizes when the committed value or its label actually changes', () => {
    const onChange = vi.fn();
    const view = render(<UuiSelectField label="Tuyến" value="1" onChange={onChange} options={options} />);
    const input = screen.getByRole('combobox', { name: 'Tuyến' });
    fireEvent.change(input, { target: { value: 'draft' } });
    view.rerender(<UuiSelectField label="Tuyến" value="2" onChange={onChange} options={options} />);
    expect(input).toHaveValue('Đông Mai');
    view.rerender(<UuiSelectField label="Tuyến" value="2" onChange={onChange} options={options.map(o => o.value === '2' ? { ...o, label: 'KCN Đông Mai' } : o)} />);
    expect(input).toHaveValue('KCN Đông Mai');
  });
});
