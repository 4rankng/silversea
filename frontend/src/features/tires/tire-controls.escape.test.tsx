import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { Modal } from '../../design-system/Modal';
import { ToastProvider } from '../../components/shared/Toast';
import { PositionPicker, SupplierPicker, TirePositionsManagerDialog } from './tire-controls';
import { floatingPickerMenuStyle } from './tire-picker-placement';

describe('QA-AUDIT-UI-68-P1 floating picker placement budget', () => {
  // Actual supplier bounds from native22 at390 and native47 at768. Menu content
  // heights are layout budgets, not fabricated supplier/position records.
  const phoneSupplier = { top: 797.953125, bottom: 837.953125, left: 23, width: 344 };
  const tabletSupplier = { top: 349.890625, bottom: 389.890625, left: 27, width: 276 };

  it.each([
    ['one option', 42],
    ['empty position menu with Manage', 90],
    ['scrolling menu at the height limit', 280],
  ] as const)('keeps an upward %s menu 8px from its field at its natural height', (_content, contentHeight) => {
    const style = floatingPickerMenuStyle(phoneSupplier, { width: 390, height: 1000 });
    expect(style.top).toBeUndefined();
    expect(style.bottom).toBe(210.046875);
    expect(style.height).toBeUndefined();
    const menuBottom = 1000 - Number(style.bottom);
    const menuTop = menuBottom - contentHeight;
    expect(phoneSupplier.top - menuBottom).toBe(8);
    expect(menuTop).toBeGreaterThanOrEqual(8);
    expect(style.maxHeight).toBe(280);
  });

  it('retains the captured downward 8px gap and releases its opposite anchor', () => {
    const style = floatingPickerMenuStyle(tabletSupplier, { width: 768, height: 1000 });
    expect(style.top).toBe(397.890625);
    expect(style.bottom).toBeUndefined();
    expect(style.height).toBeUndefined();
    expect(style.width).toBe(276);
    expect(style.left).toBe(27);
    expect(style.maxHeight).toBe(280);
  });

  it('bounds upward and downward scrolling to the actual cramped viewport space', () => {
    const up = floatingPickerMenuStyle({ top: 100, bottom: 140, left: 8, width: 200 }, { width: 220, height: 220 });
    expect(up.bottom).toBe(128);
    expect(up.top).toBeUndefined();
    expect(up.maxHeight).toBe(84);
    expect(220 - Number(up.bottom) - Number(up.maxHeight)).toBe(8);
    const down = floatingPickerMenuStyle({ top: 20, bottom: 60, left: 8, width: 200 }, { width: 220, height: 220 });
    expect(down.top).toBe(68);
    expect(down.bottom).toBeUndefined();
    expect(down.maxHeight).toBe(144);
    expect(Number(down.top) + Number(down.maxHeight)).toBe(212);
  });

  it('never invents positive space when the trigger exhausts both viewport sides', () => {
    const style = floatingPickerMenuStyle({ top: 8, bottom: 48, left: 8, width: 200 }, { width: 220, height: 56 });
    expect(style.maxHeight).toBe(0);
  });

  it('clamps menu width and its horizontal origin while preserving caller limits', () => {
    const viewportBound = floatingPickerMenuStyle({ ...phoneSupplier, left: 360, width: 500 }, { width: 390, height: 1000 });
    expect(viewportBound.width).toBe(374);
    expect(viewportBound.left).toBe(8);
    const callerBound = floatingPickerMenuStyle({ ...phoneSupplier, left: 360, width: 500 }, { width: 390, height: 1000 }, { maxWidth: 220, maxHeight: 200 });
    expect(callerBound.width).toBe(220);
    expect(callerBound.left).toBe(162);
    expect(callerBound.maxHeight).toBe(200);
    const exhaustedWidth = floatingPickerMenuStyle(phoneSupplier, { width: 12, height: 1000 });
    expect(exhaustedWidth.width).toBe(0);
  });

  it('applies visible natural-height style to the unmocked empty picker and retains Escape/reopen', () => {
    render(<PositionPicker value="" labels={[]} onChange={() => {}} onManage={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Chọn vị trí lốp' });
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(trigger);
      const menu = screen.getByRole('listbox');
      expect(menu).toHaveTextContent('Chưa có vị trí lốp');
      expect(menu).toHaveTextContent('Sửa / xóa vị trí');
      expect(menu.style.visibility).toBe('visible');
      expect(menu.style.height).toBe('');
      expect(menu.style.top).not.toBe('');
      expect(menu.style.bottom).toBe('');
      fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    }
  });
});

function Harness() {
  const [backCount, setBackCount] = useState(0);
  const [serial, setSerial] = useState('');
  useBackShortcut(() => setBackCount(count => count + 1));
  return <>
    <output aria-label="Back count">{backCount}</output>
    <input aria-label="Serial draft" value={serial} onChange={event => setSerial(event.target.value)} />
    <PositionPicker value="" labels={[]} onChange={() => {}} onManage={() => {}} />
  </>;
}

describe('QA-AUDIT-UI-38 picker Escape lifecycle', () => {
  it('closes the real menu while yielding page back, then releases back ownership', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Serial draft'), { target: { value: 'UNSAVED-SERIAL' } });
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Chọn vị trí lốp' }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Back count')).toHaveTextContent('0');
      expect(screen.getByLabelText('Serial draft')).toHaveValue('UNSAVED-SERIAL');
    }
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    expect(screen.getByLabelText('Back count')).toHaveTextContent('1');
  });
});

describe('QA-AUDIT-UI-68 shared tire modal ownership', () => {
  it.each(['pointer', 'Enter', 'Space'] as const)('opens the empty manager once on completed %s activation and returns to the connected picker trigger', async (activation) => {
    const unexpectedMutation = async () => { throw new Error('Catalog writes are forbidden in this activation-only regression'); };
    function PickerManagerHarness() {
      const [open, setOpen] = useState(false);
      const [serial, setSerial] = useState('');
      const [openCount, setOpenCount] = useState(0);
      return <ToastProvider>
        <input aria-label="Serial draft" value={serial} onChange={event => setSerial(event.target.value)} />
        <output aria-label="Manager open count">{openCount}</output>
        <PositionPicker value="" labels={[]} onChange={() => {}} onManage={() => {
          setOpenCount(count => count + 1);
          setOpen(true);
        }} />
        {open && <TirePositionsManagerDialog positions={[]} saving={false} oncreate={unexpectedMutation} onupdate={unexpectedMutation} ondelete={unexpectedMutation} oncancel={() => setOpen(false)} />}
      </ToastProvider>;
    }
    render(<PickerManagerHarness />);
    fireEvent.change(screen.getByLabelText('Serial draft'), { target: { value: 'UNSAVED-SERIAL' } });
    const trigger = screen.getByRole('button', { name: 'Chọn vị trí lốp' });
    trigger.focus();
    fireEvent.click(trigger);
    const manage = screen.getByRole('button', { name: 'Sửa / xóa vị trí' });
    if (activation === 'pointer') {
      fireEvent.pointerDown(manage, { pointerType: 'touch', bubbles: true, cancelable: true });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.pointerUp(manage, { pointerType: 'touch', bubbles: true, cancelable: true });
      fireEvent.click(manage, { detail: 1 });
    } else {
      manage.focus();
      const key = activation === 'Space' ? ' ' : 'Enter';
      // jsdom does not synthesize native button clicks from keys. Dispatch the
      // matching browser-generated click (detail0); native keys are driven separately.
      fireEvent.keyDown(manage, { key, bubbles: true, cancelable: true });
      if (activation === 'Enter') fireEvent.click(manage, { detail: 0 });
      fireEvent.keyUp(manage, { key, bubbles: true, cancelable: true });
      if (activation === 'Space') fireEvent.click(manage, { detail: 0 });
    }
    const dialog = await screen.findByRole('dialog', { name: 'Vị trí lắp' });
    expect(screen.getByLabelText('Manager open count')).toHaveTextContent('1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Đóng' })).toHaveFocus());
    if (activation === 'pointer') fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    else fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText('Serial draft')).toHaveValue('UNSAVED-SERIAL');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Manager open count')).toHaveTextContent('1');
  });

  it('consumes only the child Escape, returns picker focus and keeps the draft until parent dismissal', async () => {
    function ModalPickerHarness() {
      const [open, setOpen] = useState(false);
      const [serial, setSerial] = useState('');
      const [backCount, setBackCount] = useState(0);
      useBackShortcut(() => setBackCount(count => count + 1));
      return <>
        <output aria-label="Back count">{backCount}</output>
        <button type="button" onClick={() => setOpen(true)}>Mở hộp chọn lốp</button>
        {open && <Modal chrome="bare" isOpen title="Hộp chọn lốp" ariaLabel="Hộp chọn lốp" onClose={() => setOpen(false)}>
          <input aria-label="Serial draft" value={serial} onChange={event => setSerial(event.target.value)} />
          <PositionPicker value="" labels={[]} onChange={() => {}} onManage={() => {}} />
          <SupplierPicker value="" suppliers={[]} onChange={() => {}} />
          <button type="button">Giữ biểu mẫu</button>
        </Modal>}
      </>;
    }
    render(<ModalPickerHarness />);
    const opener = screen.getByRole('button', { name: 'Mở hộp chọn lốp' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Hộp chọn lốp' });
    await waitFor(() => expect(screen.getByLabelText('Serial draft')).toHaveFocus());
    fireEvent.change(screen.getByLabelText('Serial draft'), { target: { value: 'UNSAVED-SERIAL' } });
    const trigger = within(dialog).getByRole('button', { name: 'Chọn vị trí lốp' });
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(trigger);
      await screen.findByRole('listbox');
      screen.getByRole('button', { name: 'Sửa / xóa vị trí' }).focus();
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      fireEvent(document.body, escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Hộp chọn lốp' })).toBe(dialog);
      expect(trigger).toHaveFocus();
      expect(screen.getByLabelText('Serial draft')).toHaveValue('UNSAVED-SERIAL');
      expect(screen.getByLabelText('Back count')).toHaveTextContent('0');
    }
    const supplier = within(dialog).getByRole('textbox', { name: 'Tìm nhà cung cấp lốp' });
    supplier.focus();
    await screen.findByRole('listbox');
    within(dialog).getByRole('button', { name: 'Giữ biểu mẫu' }).focus();
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(supplier).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Hộp chọn lốp' })).toBe(dialog);
    expect(screen.getByLabelText('Serial draft')).toHaveValue('UNSAVED-SERIAL');
    expect(screen.getByLabelText('Back count')).toHaveTextContent('0');
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(screen.getByLabelText('Back count')).toHaveTextContent('0');
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    expect(screen.getByLabelText('Back count')).toHaveTextContent('1');
  });

  it('traps both Tab directions in the actual empty manager, guards busy dismissal and restores scroll/opener', async () => {
    const unexpectedMutation = async () => { throw new Error('Catalog writes are forbidden in this close-only regression'); };
    function ManagerHarness({ saving }: { saving: boolean }) {
      const [open, setOpen] = useState(false);
      return <ToastProvider>
        <button type="button" onClick={() => setOpen(true)}>Mở quản lý vị trí</button>
        {open && <TirePositionsManagerDialog positions={[]} saving={saving} oncreate={unexpectedMutation} onupdate={unexpectedMutation} ondelete={unexpectedMutation} oncancel={() => setOpen(false)} />}
      </ToastProvider>;
    }
    const originalOverflow = document.body.style.overflow;
    const { rerender } = render(<ManagerHarness saving />);
    const opener = screen.getByRole('button', { name: 'Mở quản lý vị trí' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Vị trí lắp' });
    const input = within(dialog).getByRole('textbox', { name: 'Tên vị trí' });
    expect(within(dialog).getByRole('button', { name: 'Đóng' })).toBeDisabled();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog', { name: 'Vị trí lắp' })).toBe(dialog);
    rerender(<ManagerHarness saving={false} />);
    const close = within(dialog).getByRole('button', { name: 'Đóng' });
    expect(close).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Thêm' })).toBeDisabled();
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', bubbles: true, cancelable: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    expect(input).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });
});
