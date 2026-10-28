import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Shell-level Escape for overlay roots (role=dialog).
 *
 * The window-level `useConfirmShortcuts` path yields to anything above the
 * overlay in the token stack — a mounted page layer can silently own the top
 * token and leave the shell with no Escape path at all (SIL-577 live class).
 * The root handler runs during bubble-through-the-dialog, before any window
 * listener, so the shell closes deterministically while the same guard
 * contracts are honoured: an inner control that already consumed Escape
 * (`defaultPrevented` — the inline-edit revert) and open nested pickers /
 * `[data-escape-boundary]` subtrees own their key first.
 */
export function useShellEscape(onClose: () => void): (event: ReactKeyboardEvent) => void {
  return useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('[aria-expanded="true"][aria-haspopup], [role="combobox"][aria-expanded="true"], [data-escape-boundary]')) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }, [onClose]);
}
