import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, useConfirm } from './confirm-dialog';

function ConfirmHarness({ onResult }: { onResult: (value: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  return <><button onClick={async () => onResult(await confirm('Lưu chính sách?', { confirmLabel: 'Lưu' }))}>Mở xác nhận</button>{dialog}</>;
}

describe('confirmation keyboard actions', () => {
  it('restores focus after Escape, Cancel and Confirm and resolves each reopened prompt once', async () => {
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);
    const trigger = screen.getByRole('button', { name: 'Mở xác nhận' });
    for (const [index, action] of ['Escape', 'Hủy', 'Lưu'].entries()) {
      trigger.focus();
      fireEvent.click(trigger);
      await screen.findByRole('dialog');
      if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      else fireEvent.click(screen.getByRole('button', { name: action }));
      await waitFor(() => expect(trigger).toHaveFocus());
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(onResult).toHaveBeenCalledTimes(index + 1);
      expect(onResult).toHaveBeenLastCalledWith(action === 'Lưu');
    }
  });

  it('activates Cancel with Enter without also confirming the destructive action', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog isOpen message="Bỏ thay đổi chưa lưu?" onConfirm={onConfirm} onCancel={onCancel} />);
    const cancel = await screen.findByRole('button', { name: 'Hủy' });
    expect(screen.getByRole('dialog', { name: 'Xác nhận thao tác' })).toHaveAccessibleDescription('Bỏ thay đổi chưa lưu?');
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

  it('exposes the dialog probe contract: role=dialog, aria-modal set, named, described', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog isOpen message="Xóa cấu hình này?" onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  });
});
