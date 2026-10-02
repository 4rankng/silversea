import { useBuildFreshness } from '../../hooks/useBuildFreshness';
import './stale-build-banner.css';

/**
 * Non-blocking corner notice when a new build is detected under the open tab.
 *
 * Pairs with lib/chunk-error.ts (reactive recovery after a lazy chunk 404s):
 * this flags the stale build BEFORE anything breaks, lets the user finish
 * what they are doing, and reloads only when they click. Never reloads on its
 * own — an in-progress form must survive a deploy (card T3).
 */
export function StaleBuildBanner() {
  const stale = useBuildFreshness();
  if (!stale) return null;
  return (
    <div className="stale-build-banner" role="status">
      <span>Phiên bản mới — tải lại?</span>
      <button type="button" onClick={() => window.location.reload()}>Tải lại</button>
    </div>
  );
}
