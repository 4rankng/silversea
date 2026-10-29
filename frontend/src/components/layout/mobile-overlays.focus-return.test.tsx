import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

vi.mock('../../hooks/useCatalogQueries', () => ({
  useSalaryPeriod: () => ({ data: null }),
}));
vi.mock('../shared/BuildVersion', () => ({ BuildVersion: () => null }));

import { MobileAccountSheet } from './MobileAccountSheet';
import { MonthNavigator } from './Topbar';
import { MonthProvider } from '../../hooks/useMonth';

const USER = { userId: 1, role: Role.DRIVER, fullName: 'Tài xế', username: 'driver1', email: null };

function SheetHarness() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(event) => { openerRef.current = event.currentTarget; setOpen(true); }}
      >
        Tài khoản
      </button>
      {open && (
        <MobileAccountSheet
          user={USER}
          roleLabel="Tài xế"
          onClose={() => setOpen(false)}
          openerRef={openerRef}
          onOpenProfile={() => {}}
          onOpenNotifications={() => {}}
          onOpenPassword={() => {}}
          onLogout={() => {}}
        />
      )}
    </>
  );
}

function renderPicker() {
  return render(
    <MonthProvider>
      <MonthNavigator />
    </MonthProvider>,
  );
}

// SIL-573: mobile overlays must hand focus back to their opener on close —
// Escape, the Đóng button and picker selections all restore; an outside press
// never steals focus back from what the user clicked.
describe('mobile overlay focus return (SIL-573)', () => {
  it('returns focus to the account trigger after Escape', () => {
    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Tài khoản' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the account trigger after the Đóng button', () => {
    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Tài khoản' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng tài khoản' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the month trigger after Escape (SIL-561: one frame — the inert release lands first)', async () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: /Chọn tháng/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Chọn tháng' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Chọn tháng' })).toBeNull();
    // The restore defers past the close commit: the background un-inerts
    // there, and a browser refuses to focus an inert trigger (the old
    // synchronous shape dropped the keyboard to <body> — QA-measured).
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('returns focus to the month trigger after choosing a month (SIL-561: one frame)', async () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: /Chọn tháng/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /T5\s*Tháng 5/ }));
    expect(screen.queryByRole('dialog', { name: 'Chọn tháng' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps focus away from the trigger when an outside press closes the picker', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: /Chọn tháng/ });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Chọn tháng' })).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });
});
