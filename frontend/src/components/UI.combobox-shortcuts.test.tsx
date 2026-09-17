import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer, Modal } from './UI';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';

const options = ['Hải Phòng', 'Quế Võ', 'Đông Mai', 'Hà Nội', 'Đà Nẵng'].map((label, index) => ({ value: String(index), label }));

function Form({ kind, onConfirm }: { kind: 'modal' | 'drawer'; onConfirm: () => void }) {
  const [open, setOpen] = useState(true);
  const [route, setRoute] = useState('0');
  const Surface = kind === 'modal' ? Modal : Drawer;
  return <Surface isOpen={open} title="Tạo định mức" onClose={() => setOpen(false)} onConfirm={onConfirm}>
    <input aria-label="Ghi chú" defaultValue="Giữ nội dung đang nhập" />
    <UuiSelectField label="Tuyến đường" value={route} onChange={e => setRoute(e.target.value)} options={options} />
  </Surface>;
}

describe('nested combobox owns its keyboard events', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200, width: 280, height: 34 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['modal', 'drawer'] as const)('Escape closes only the list inside a %s', async kind => {
    render(<Form kind={kind} onConfirm={vi.fn()} />);
    const input = await screen.findByRole('combobox', { name: 'Tuyến đường' });
    await act(async () => { input.focus(); fireEvent.click(input); });
    fireEvent.change(input, { target: { value: 'que vo' } });
    await screen.findByRole('option', { name: 'Quế Võ' });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
    expect(await screen.findByRole('dialog', { name: 'Tạo định mức' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ghi chú')).toHaveValue('Giữ nội dung đang nhập');
    fireEvent.keyDown(screen.getByLabelText('Ghi chú'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tạo định mức' })).not.toBeInTheDocument());
  });

  it.each(['modal', 'drawer'] as const)('Enter selects an option without confirming the %s', async kind => {
    const onConfirm = vi.fn();
    render(<Form kind={kind} onConfirm={onConfirm} />);
    const input = await screen.findByRole('combobox', { name: 'Tuyến đường' });
    await act(async () => { input.focus(); fireEvent.click(input); });
    fireEvent.change(input, { target: { value: 'que vo' } });
    await screen.findByRole('option', { name: 'Quế Võ' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(input).toHaveValue('Quế Võ');
    expect(screen.getByRole('dialog', { name: 'Tạo định mức' })).toBeInTheDocument();
  });
});
