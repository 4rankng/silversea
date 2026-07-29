import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { highlightElement } from '../lib/agentHighlight';

export function clearFocusSearchParams(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete('focus');
  next.delete('fdur');
  return next;
}

/**
 * Scroll-to-and-highlight an element when the URL has `?focus=<id>`.
 * After the animation completes the `focus` param is removed from the URL.
 * An optional `?fdur=<ms>` overrides the default 2s ring duration (set by the
 * agent's `focus` directive when it carries `durationMs`).
 *
 * @param prefix — the id prefix, e.g. `"adv"` → looks for `#adv-<focusId>`
 */
export function useFocusDeepLink(prefix: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const durationMs = Number(searchParams.get('fdur')) || 2000;

  useEffect(() => {
    if (!focusId) return;
    const targetId = `${prefix}-${focusId}`;
    const finish = () => {
      if (!highlightElement(targetId, durationMs)) return false;
      setSearchParams(clearFocusSearchParams(searchParams), { replace: true });
      return true;
    };

    if (finish()) return;

    // List/detail data often arrives after the route mounts. Keep the deep link
    // until the target is actually present instead of silently consuming it.
    const observer = new MutationObserver(() => {
      if (finish()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 10_000);

    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [focusId, prefix, durationMs, searchParams, setSearchParams]);

  return focusId;
}
