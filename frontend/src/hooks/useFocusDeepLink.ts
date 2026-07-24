import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { highlightElement } from '../lib/agentHighlight';

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
    highlightElement(`${prefix}-${focusId}`, durationMs);
    setSearchParams({}, { replace: true });
  }, [focusId, prefix, durationMs, setSearchParams]);

  return focusId;
}
