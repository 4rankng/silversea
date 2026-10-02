import { useEffect, useState } from 'react';

/**
 * Card 20260930_246: the dispatch date range rides the filter line on fine
 * pointers (the band wave's ruled placement) but moves behind the Bộ lọc
 * fold on coarse-pointer devices, where the §5 44px touch floor makes a
 * three-row inline band taller than the chrome budget the plan grids keep.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => (
    typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(hover: none) and (pointer: coarse)');
    const onChange = () => setCoarse(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return coarse;
}
