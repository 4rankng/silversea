import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DebitNoteFreightOverride } from './DebitNoteFreightOverride';

describe('DebitNoteFreightOverride', () => {
  const base = { systemFreight: 5071744 };

  it('saves with no reason when final equals system', () => {
    const onSave = vi.fn();
    render(<DebitNoteFreightOverride {...base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(onSave).toHaveBeenCalledWith({ finalDebitFreight: null });
  });

  it('requires reason when final differs from system', () => {
    const onSave = vi.fn();
    render(<DebitNoteFreightOverride {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Giá cước đàm phán'), { target: { value: '4600000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bắt buộc nhập lý do');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with reason when valid override', () => {
    const onSave = vi.fn();
    render(<DebitNoteFreightOverride {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Giá cước đàm phán'), { target: { value: '4600000' } });
    fireEvent.change(screen.getByLabelText('Lý do điều chỉnh'), { target: { value: 'Chiết khấu 472K theo thỏa thuận' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(onSave).toHaveBeenCalledWith({
      finalDebitFreight: 4600000,
      overrideReason: 'Chiết khấu 472K theo thỏa thuận',
    });
  });
});
