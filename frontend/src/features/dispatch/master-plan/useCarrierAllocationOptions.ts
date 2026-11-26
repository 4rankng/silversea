import { useCallback, useEffect, useState } from 'react';
import {
  listDispatchFleetResources,
  type DispatchExternalCarrier,
} from '../../../api/dispatchPlanningClient';
import { carrierOptionKey, type CarrierAllocationOption } from '../../../components/shipment/CarrierAllocationSummary';

const OWN_CARRIER_OPTION: CarrierAllocationOption = {
  key: 'OWN',
  label: 'Đội xe nội bộ SilverSea',
  carrierType: 'OWN',
  externalCarrierId: null,
  isActive: true,
};

/** The catalog is a small curated set (28 nhà xe today); one page is the
 *  whole population. A catalog beyond this size needs server-side search,
 *  not a bigger page. */
const CARRIER_PAGE_LIMIT = 100;

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
 * Loads the carrier options (OWN + every active EXTERNAL) from the ONE nhà-xe
 * catalog endpoint (SIL-1057): `GET /shipments/dispatch-fleet?resource=EXTERNAL_CARRIER`
 * — customers flagged `isCarrier`, Hoạt động, not deleted. Every điểm chọn
 * nhà xe reads the same source through this hook or that endpoint directly
 * (the dispatch-detail editor), never the cached `/catalogs/bootstrap` blob:
 * a nhà thầu flagged on /suppliers must be selectable everywhere at the same
 * moment, with both the operational label and the full legal name searchable.
 * Re-fetches when `reload()` is called so a user who just asked an admin to
 * add a carrier can refresh without reloading the whole page.
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
    listDispatchFleetResources('EXTERNAL_CARRIER', { limit: CARRIER_PAGE_LIMIT }).then((response) => {
      if (cancelled) return;
      const external = (response.items as DispatchExternalCarrier[]).map((carrier) => ({
        key: carrierOptionKey('EXTERNAL', carrier.id),
        label: carrier.name,
        // The searchable chain rides label + searchText, so carrying the
        // full legal name here lets typing either projection match.
        ...(carrier.fullName && carrier.fullName !== carrier.name
          ? { searchText: carrier.fullName }
          : {}),
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
