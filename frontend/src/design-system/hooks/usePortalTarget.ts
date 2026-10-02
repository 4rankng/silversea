import { useEffect, useState } from 'react';

/**
 * Resolves the portal target for body-level overlays. Returns null until the
 * browser document exists, so a server-rendered tree renders no overlay and
 * then portals into document.body once mounted.
 */
export function usePortalTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.body);
  }, []);
  return target;
}
