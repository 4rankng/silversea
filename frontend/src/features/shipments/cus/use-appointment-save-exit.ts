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
    let attempt = 0;
    const tryExit = () => {
      const state = current.current;
      if ((!state.dirty && !state.saving) || attempt >= 60) {
        timer.current = null;
        state.onExit?.();
        return;
      }
      attempt += 1;
      timer.current = setTimeout(tryExit, 50);
    };
    timer.current = setTimeout(tryExit, 0);
  }, []);
}
