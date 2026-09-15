import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripEditConflictDialog } from './TripEditConflictDialog';
import { TripEditConflictError } from '../../hooks/tripSubmitReconcile';

const makeConflict = (version = 4) => new TripEditConflictError(version, [
  { key: 'notes', label: 'Ghi chú', local: 'Ghi chú của tôi', latest: 'Ghi chú đã lưu' },
  { key: 'revenue', label: 'Doanh thu', local: 100, latest: 200 },
]);

describe('TripEditConflictDialog', () => {
  it('requires each choice and submits the reviewed version without silently selecting values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<TripEditConflictDialog conflict={makeConflict()} submitting={false} onSave={onSave} onClose={onClose} onConflict={vi.fn()} />);
    const save = screen.getByRole('button', { name: 'Lưu giá trị đã chọn' });
    expect(save).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Ghi chú' })).getByRole('radio', { name: /Bản nháp của tôi/ }));
    expect(save).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Doanh thu' })).getByRole('radio', { name: /Đã lưu trên hệ thống/ }));
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(4, { notes: 'local', revenue: 'server' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('requires new choices when another concurrent update changes the reviewed version', async () => {
    const next = makeConflict(5);
    const onConflict = vi.fn();
    const props = { submitting: false, onSave: vi.fn().mockRejectedValue(next), onClose: vi.fn(), onConflict };
    const { rerender } = render(<TripEditConflictDialog {...props} conflict={makeConflict()} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Ghi chú' })).getByRole('radio', { name: /Bản nháp của tôi/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Doanh thu' })).getByRole('radio', { name: /Đã lưu trên hệ thống/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu giá trị đã chọn' }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(next));
    expect(props.onClose).not.toHaveBeenCalled();
    rerender(<TripEditConflictDialog {...props} conflict={next} />);
    expect(screen.getByRole('button', { name: 'Lưu giá trị đã chọn' })).toBeDisabled();
    expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).checked)).toBe(true);
  });
});
