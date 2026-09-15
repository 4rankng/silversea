import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

describe('confirmation keyboard actions', () => {
  it('activates Cancel with Enter without also confirming the destructive action', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog isOpen message="Bỏ thay đổi chưa lưu?" onConfirm={onConfirm} onCancel={onCancel} />);
    const cancel = await screen.findByRole('button', { name: 'Hủy' });
    expect(screen.getByRole('alertdialog', { name: 'Xác nhận thao tác' })).toHaveAccessibleDescription('Bỏ thay đổi chưa lưu?');
    cancel.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(document.activeElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms once from the focused action and contains Tab within the prompt', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<><button>Background</button><ConfirmDialog isOpen message="Rời trang?" onConfirm={onConfirm} onCancel={onCancel} /></>);
    const confirm = await screen.findByRole('button', { name: 'Xác nhận' });
    const cancel = screen.getByRole('button', { name: 'Hủy' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
