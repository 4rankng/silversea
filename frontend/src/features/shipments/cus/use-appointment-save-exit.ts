import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Wait for saved drafts and saving flags to settle before asking the host
 * to close. The host still guards any unrelated changes; use its current
 * callback so a dirty-state closure cannot raise a false discard dialog. */
export function useAppointmentSaveExit(dirty: boolean, saving: boolean, onExit?: () => void) {
  const current = useRef({ dirty, saving, onExit });
  useLayoutEffect(() => { current.current = { dirty, saving, onExit }; }, [dirty, saving, onExit]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  return useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    // Card 071026205310: no give-up. The old 60-attempt escape closed the
    // drawer anyway after ~3s and silently dropped unsaved inline drafts
    // (the port pick that vanished when the appointment autosaved). While
    // drafts are pending the exit stands down — the host's guarded close
    // (discard confirm) stays the only way out, so nothing is lost. The poll
    // continues so a save that settles moments later still exits.
    const poll = () => {
      const state = current.current;
      if (!state.dirty && !state.saving) {
        timer.current = null;
        state.onExit?.();
        return;
      }
      timer.current = setTimeout(poll, 50);
    };
    timer.current = setTimeout(poll, 0);
  }, []);
}
