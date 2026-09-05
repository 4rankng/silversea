import { useCallback, useEffect, useState } from 'react';
import { tripClient } from '../../../api/tripClient';
import { carrierOptionKey, type CarrierAllocationOption } from '../../../components/shipment/CarrierAllocationSummary';

const OWN_CARRIER_OPTION: CarrierAllocationOption = {
  key: 'OWN',
  label: 'Đội xe nội bộ SilverSea',
  carrierType: 'OWN',
  externalCarrierId: null,
  isActive: true,
};

export interface CarrierAllocationOptionsState {
  options: CarrierAllocationOption[];
  loading: boolean;
  error: boolean;
  /** True when bootstrap resolved successfully but no external carriers
   *  exist yet (no customer flagged `isCarrier` = true). Distinct from
   *  `error` (fetch rejected) so the dialog can render an actionable
   *  "ask admin to add carriers" notice instead of a generic retry banner. */
  empty: boolean;
  reload: () => void;
}

/**
 * Loads the carrier options (OWN + every active EXTERNAL) from
 * `/catalogs/bootstrap`. Re-fetches when `reload()` is called so a user
 * who just asked an admin to add a carrier can refresh without reloading
 * the whole page.
 */
export function useCarrierAllocationOptions(): CarrierAllocationOptionsState {
  const [options, setOptions] = useState<CarrierAllocationOption[]>([OWN_CARRIER_OPTION]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setEmpty(false);
    tripClient.getBootstrap().then((bootstrap) => {
      if (cancelled) return;
      const external = (bootstrap.externalCarriers ?? []).map((carrier) => ({
        key: carrierOptionKey('EXTERNAL', carrier.id),
        label: carrier.name,
        carrierType: 'EXTERNAL' as const,
        externalCarrierId: carrier.id,
        isActive: carrier.isActive,
      }));
      setOptions([OWN_CARRIER_OPTION, ...external]);
      setEmpty(external.length === 0);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { options, loading, error, empty, reload };
}
