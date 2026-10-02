import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { OpsModalBackdrop } from '../features/ops/OpsModalBackdrop';
import { UuiSelectField } from './forms/UuiSelectField';

/**
 * The one overlay suite (card 20260930_227): every dialog in the app rides
 * this module's mechanics — house-chrome dialogs, the ops shell adapter and
 * the positioned dispatch panels. Escape (incl. nested-picker deference),
 * focus trap + focus return, scroll lock (+ nesting), backdrop dismissal and
 * its opt-out are contracted HERE, once, instead of per dialog.
 */

function Harness(props: Partial<Parameters<typeof Modal>[0]> & { title?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <Modal
      isOpen={open}
      onClose={() => setOpen(false)}
      title={props.title ?? 'Dialog'}
      {...props}
    >
      {props.children ?? <button type="button">Hành động</button>}
    </Modal>
  );
}

/** A child that renders its button through a body-level portal — the same
 *  DOM shape as SearchableSelect's selector overlay and react-aria popovers. */
function PortaledPing({ onPing }: { onPing: () => void }) {
  return createPortal(
    <button type="button" onClick={onPing}>ping-portaled</button>,
    document.body,
  );
}

describe('Modal overlay suite — house chrome', () => {
  it('carries role=dialog, aria-modal and the title as its accessible name', async () => {
    render(<Harness title="Xóa cấu hình biểu phí" ariaLabel="Xóa cấu hình biểu phí" />);
    const dialog = await screen.findByRole('dialog', { name: 'Xóa cấu hình biểu phí' });
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Xóa cấu hình biểu phí');
  });

  it('names itself from the title heading when ariaLabel is absent', async () => {
    render(<Harness title="Chuyển loại hàng?" />);
    const dialog = await screen.findByRole('dialog', { name: 'Chuyển loại hàng?' });
    expect(dialog.querySelector('.modal__title')?.getAttribute('id')).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby') || dialog.getAttribute('aria-label')).toBeTruthy();
  });

  it('Escape dismisses and returns focus to the opener', async () => {
    function Openable() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Mở</button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Dialog">
            <button type="button">Hành động</button>
          </Modal>
        </>
      );
    }
    render(<Openable />);
    const opener = screen.getByRole('button', { name: 'Mở' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Dialog' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('traps Tab inside the dialog', async () => {
    render(<Harness><button type="button">Bỏ qua</button><button type="button">Lưu</button></Harness>);
    await screen.findByRole('dialog', { name: 'Dialog' });
    const store = screen.getByRole('button', { name: 'Lưu' });
    store.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    // Wrap-around: the last focusable in DOM order cycles to the first
    // (the header close control, announced "Đóng").
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đóng' }));
  });

  it('dismisses on a direct scrim hit but not on a dialog click', async () => {
    render(<Harness />);
    const overlay = (await screen.findByRole('dialog', { name: 'Dialog' }));
    fireEvent.click(overlay.querySelector('.modal__content')!);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeTruthy());
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open when a click fires from a portaled child', async () => {
    const pings: string[] = [];
    render(
      <Harness>
        <PortaledPing onPing={() => pings.push('modal')} />
      </Harness>,
    );
    await screen.findByRole('dialog', { name: 'Dialog' });
    fireEvent.click(screen.getByRole('button', { name: 'ping-portaled' }));
    expect(pings).toEqual(['modal']);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeTruthy());
  });

  it('locks body scroll while open and restores it on close', async () => {
    document.body.style.overflow = '';
    const { unmount } = render(<Harness />);
    await screen.findByRole('dialog', { name: 'Dialog' });
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Enter confirms (outside buttons/textarea), Escape cancels', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <Harness onConfirm={onConfirm} onClose={onClose}>
        <input aria-label="Ghi chú" />
      </Harness>,
    );
    await screen.findByRole('dialog', { name: 'Dialog' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ghi chú' }), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Đóng' }), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('forwards the size budget through --modal-max-w', async () => {
    render(<Harness maxWidth={720} />);
    const dialog = await screen.findByRole('dialog', { name: 'Dialog' });
    const content = dialog.querySelector('.modal__content') as HTMLElement | null;
    expect(content).toBeTruthy();
    expect(content!.style.getPropertyValue('--modal-max-w')).toBe('720px');
  });
});

describe('Modal overlay suite — stacking + picker deference', () => {
  it('the topmost dialog owns Escape; the unlock order is innermost-first', async () => {
    function Stacked() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <Modal isOpen={outer} onClose={() => setOuter(false)} title="Ngoài">
          <button type="button" onClick={() => setInner(true)}>Mở trong</button>
          <Modal isOpen={inner} onClose={() => setInner(false)} title="Trong">
            <button type="button">Hành động trong</button>
          </Modal>
        </Modal>
      );
    }
    render(<Stacked />);
    await screen.findByRole('dialog', { name: 'Ngoài' });
    await screen.findByRole('dialog', { name: 'Trong' });
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trong' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Ngoài' })).toBeTruthy();
    // The outer dialog still owns the page: the lock persists until it closes.
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  it('an expanded picker trigger consumes Escape without dismissing the dialog', async () => {
    const onClose = vi.fn();
    render(
      <Harness onClose={onClose}>
        <button type="button" aria-expanded="true" aria-haspopup="listbox">Chọn loại phí</button>
        <button type="button">Lưu</button>
      </Harness>,
    );
    await screen.findByRole('dialog', { name: 'Dialog' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chọn loại phí' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lưu' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Modal overlay suite — bare mode (ops shell, positioned panels)', () => {
  it('contains focus while every control is disabled and enters controls when loading ends', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const content = (disabled: boolean) => (
      <Harness chrome="bare" ariaLabel="Đang tải giấy báo nợ">
        <button disabled={disabled}>Đóng</button>
        <button disabled={disabled}>Lưu</button>
      </Harness>
    );
    const { rerender, unmount } = render(content(true));
    const dialog = await screen.findByRole('dialog', { name: 'Đang tải giấy báo nợ' });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    rerender(content(false));
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Đóng' }), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lưu' }), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('renders mechanics only: children own the surface, no house chrome', async () => {
    render(
      <Harness chrome="bare" ariaLabel="Khai báo chi phí">
        <div className="ops-modal"><button type="button">Lưu</button></div>
      </Harness>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Khai báo chi phí' });
    expect(dialog.querySelector('.modal__head')).toBeNull();
    expect(dialog.querySelector('.modal__content')).toBeNull();
    expect(dialog.className).toContain('modal--bare');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeTruthy();
  });

  it('bare defaults: scrim click never dismisses, Escape does, scroll locks', async () => {
    const onClose = vi.fn();
    function BareHarness() {
      const [open, setOpen] = useState(true);
      return (
        <Modal
          chrome="bare"
          title="Khai báo chi phí"
          ariaLabel="Khai báo chi phí"
          isOpen={open}
          onClose={() => { onClose(); setOpen(false); }}
        >
          <div className="ops-modal"><button type="button">Lưu</button></div>
        </Modal>
      );
    }
    render(<BareHarness />);
    const overlay = await screen.findByRole('dialog', { name: 'Khai báo chi phí' });
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Khai báo chi phí' })).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lưu' }), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  it('returns focus to the opener even when unmounted while still open', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <Modal chrome="bare" title="Điều chỉnh" ariaLabel="Điều chỉnh" isOpen onClose={() => {}}>
        <div className="ops-modal"><button type="button">Lưu</button></div>
      </Modal>,
    );
    await screen.findByRole('dialog', { name: 'Điều chỉnh' });
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe('Modal overlay suite — ops shell adapter (OpsModalBackdrop)', () => {
  it('lets a searchable child consume Escape without discarding its parent dialog', async () => {
    const onClose = vi.fn();
    function Form() {
      const [value, setValue] = useState('');
      return (
        <OpsModalBackdrop ariaLabel="Chi phí" onClose={onClose}>
          <div className="ops-modal">
            <UuiSelectField
              label="Loại phí"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              options={[
                { value: '', label: 'Chọn loại phí' },
                ...['Nâng', 'Hạ', 'Cân', 'Bốc xếp', 'Khác'].map((label) => ({ value: label, label })),
              ]}
            />
            <button>Lưu</button>
          </div>
        </OpsModalBackdrop>
      );
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
    const shell = (onClose: () => void) => (
      <OpsModalBackdrop ariaLabel="Chi phí" onClose={onClose}>
        <div className="ops-modal"><button>Đóng</button><button>Lưu</button></div>
      </OpsModalBackdrop>
    );
    const { unmount, rerender } = render(shell(vi.fn()));
    expect(document.body.style.overflow).toBe('hidden');
    screen.getByRole('button', { name: 'Lưu' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    rerender(shell(vi.fn()));
    unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe(originalOverflow);
    opener.remove();
  });
});
