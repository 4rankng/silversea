import { useEffect, useRef } from 'react';

interface TrailerOption {
  id: number;
  currentTrailerId: number | null;
}

interface TrailerTypeOption {
  id: number;
  type: string;
}

interface UseTrailerAutoPinParams {
  truckId: string;
  setTrailerType: (v: string) => void;
  trucks?: TrailerOption[];
  trailers?: TrailerTypeOption[];
}

/**
 * Card _41: auto-suggest the trailer type from the selected truck's current
 * trailer — at most ONCE per selected truck. The previous inline effect
 * re-fired on every options identity churn (route re-pricing refetches) and
 * clobbered the user's explicit trailer choice back to the pinned tier.
 */
export function useTrailerAutoPin({ truckId, setTrailerType, trucks, trailers }: UseTrailerAutoPinParams) {
  const autoPinnedTruckRef = useRef<string | null>(null);
  useEffect(() => {
    if (!truckId || !trucks || !trailers) return;
    if (autoPinnedTruckRef.current === truckId) return;
    const selectedTruck = trucks.find((t) => t.id === Number(truckId));
    if (selectedTruck?.currentTrailerId) {
      const trailer = trailers.find((t) => t.id === selectedTruck.currentTrailerId);
      if (trailer) {
        autoPinnedTruckRef.current = truckId;
        setTrailerType(trailer.type === '20FT' ? '20FT' : '40FT');
      }
    }
  }, [truckId, trucks, trailers, setTrailerType]);
}
