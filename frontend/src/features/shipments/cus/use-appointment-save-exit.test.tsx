import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppointmentSaveExit } from './use-appointment-save-exit';

/** Card 071026205310: after an appointment autosave, the scheduled exit must
 *  never force its way out while drafts are still pending — the old 60-attempt
 *  give-up closed the drawer anyway and silently dropped inline selections
 *  (port/route/site) the user had not saved yet. */
describe('useAppointmentSaveExit', () => {
  it('exits as soon as the drawer is clean (appointment-only save)', async () => {
    const onExit = vi.fn();
    const { result } = renderHook(
      ({ d }: { d: boolean }) => useAppointmentSaveExit(d, false, onExit),
      { initialProps: { d: false } },
    );
    act(() => { result.current(); });
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(onExit).toHaveBeenCalled();
  });

  it('stands down while drafts stay dirty — never force-closes the drawer', () => {
    vi.useFakeTimers();
    try {
      const onExit = vi.fn();
      const { result } = renderHook(
        ({ d }: { d: boolean }) => useAppointmentSaveExit(d, false, onExit),
        { initialProps: { d: true } },
      );
      act(() => { result.current(); });
      // Far past the old give-up window (~3s / 60 attempts): no exit may fire
      // while the user still has unsaved drafts.
      act(() => { vi.advanceTimersByTime(3500); });
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
