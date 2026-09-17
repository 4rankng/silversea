import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { UuiSelectField } from '../../design-system';

describe('OpsModalBackdrop', () => {
  it('lets a searchable child consume Escape without discarding its parent dialog', async () => {
    const onClose = vi.fn();
    function Form() {
      const [value, setValue] = useState('');
      return <OpsModalBackdrop ariaLabel="Chi phí" onClose={onClose}><div className="ops-modal">
        <UuiSelectField label="Loại phí" value={value} onChange={event => setValue(event.target.value)} options={[
          { value: '', label: 'Chọn loại phí' },
          ...['Nâng', 'Hạ', 'Cân', 'Bốc xếp', 'Khác'].map(label => ({ value: label, label })),
        ]} />
        <button>Lưu</button>
      </div></OpsModalBackdrop>;
    }
    render(<Form />);
    const input = screen.getByRole('combobox');
    await act(async () => { input.focus(); fireEvent.click(input); });
    fireEvent.change(input, { target: { value: 'Nâng' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Chi phí' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lưu' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('contains focus, preserves the opener across rerenders and restores scroll on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const originalOverflow = document.body.style.overflow;
    const { unmount, rerender } = render(<OpsModalBackdrop ariaLabel="Chi phí" onClose={vi.fn()}><div className="ops-modal"><button>Đóng</button><button>Lưu</button></div></OpsModalBackdrop>);
    expect(document.body.style.overflow).toBe('hidden');
    screen.getByRole('button', { name: 'Lưu' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    rerender(<OpsModalBackdrop ariaLabel="Chi phí" onClose={vi.fn()}><div className="ops-modal"><button>Đóng</button><button>Lưu</button></div></OpsModalBackdrop>);
    unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe(originalOverflow);
    opener.remove();
  });

  it('ignores Escape from a portaled child picker but dismisses from its own controls', () => {
    const onClose = vi.fn();
    render(<OpsModalBackdrop ariaLabel="Chi phí" onClose={onClose}><div className="ops-modal"><button>Lưu</button></div></OpsModalBackdrop>);
    const picker = document.createElement('button');
    document.body.append(picker);
    fireEvent.keyDown(picker, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lưu' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    picker.remove();
  });
});
