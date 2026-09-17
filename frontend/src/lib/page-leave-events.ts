/**
 * Installed by main before BrowserRouter: Window popstate listeners run in
 * registration order, so a page-mounted listener is too late to retain a draft.
 */
const listeners = new Set<(event: PopStateEvent) => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    for (const listener of listeners) {
      listener(event);
      if (event.cancelBubble) break;
    }
  }, true);
}

export function subscribePagePopState(listener: (event: PopStateEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
