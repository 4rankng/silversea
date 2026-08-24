import { useCallback, useEffect, useRef, useState } from 'react';
import { ShipmentStatus } from '@tingting/shared';
import {
  listShipments,
  type ShipmentAllocationStatus,
  type ShipmentListItem,
  type ShipmentListResponse,
} from '../../../api/shipmentClient';
import {
  listZoneTruckPresence,
  type ZoneTruckPresenceItem,
} from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';

const PAGE_SIZE = 20;

export interface MasterPlanFilters {
  q: string;
  tradeDirection: 'IMPORT' | 'EXPORT' | '';
  allocationStatus: ShipmentAllocationStatus | '';
  deliveryDateFrom: string;
  deliveryDateTo: string;
  portIds: number[];
  carrierKeys: string[];
}

export const EMPTY_MASTER_PLAN_FILTERS: MasterPlanFilters = {
  q: '',
  tradeDirection: '',
  allocationStatus: '',
  deliveryDateFrom: '',
  deliveryDateTo: '',
  portIds: [],
  carrierKeys: [],
};

/**
 * Data hook for the dispatch master-plan screen ("Kế hoạch Tổng quát"):
 * READY_FOR_DISPATCH shipments only, server-side filters + pagination, with a
 * request-id race guard so a slow earlier response can never overwrite a newer
 * one (request-id race guard).
 */
export function useDispatchMasterPlan() {
  const [filters, setFilters] = useState<MasterPlanFilters>(EMPTY_MASTER_PLAN_FILTERS);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ShipmentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dispatchSummary, setDispatchSummary] = useState<ShipmentListResponse['dispatchSummary']>(undefined);
  const requestIdRef = useRef(0);

  // Zone truck presence for today: advisory panel showing OWN trucks.
  const [zones, setZones] = useState<Array<{ code: string; label: string }>>([]);
  const [presence, setPresence] = useState<{ zone: string; zoneLabel: string; date: string; items: ZoneTruckPresenceItem[] } | null>(null);
  const presenceRequestIdRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    configClient.getDispatchZones()
      .then((res) => { if (!cancelled) setZones(res.items); })
      .catch(() => { /* no taxonomy → no presence panel */ });
    return () => { cancelled = true; };
  }, []);
  // Pin the presence advisory (zone hint + panel) to Lạch Huyện when the
  // taxonomy carries it; fall back to the first active zone otherwise.
  const presenceZone = zones.find((zone) => zone.code === 'LACH_HUYEN')?.code || zones[0]?.code || '';
  useEffect(() => {
    if (!presenceZone) { setPresence(null); return; }
    const requestId = ++presenceRequestIdRef.current;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    listZoneTruckPresence({ zone: presenceZone, date: todayStr })
      .then((response) => {
        if (presenceRequestIdRef.current !== requestId) return;
        setPresence(response);
      })
      .catch(() => {
        if (presenceRequestIdRef.current !== requestId) return;
        setPresence(null);
      });
  }, [presenceZone, refreshKey]);

  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    listShipments({
      status: ShipmentStatus.READY_FOR_DISPATCH,
      page,
      limit: PAGE_SIZE,
      ...(debouncedQ ? { q: debouncedQ } : {}),
      ...(filters.tradeDirection ? { tradeDirection: filters.tradeDirection } : {}),
      ...(filters.allocationStatus ? { allocationStatus: filters.allocationStatus } : {}),
      ...(filters.deliveryDateFrom ? { deliveryDateFrom: filters.deliveryDateFrom } : {}),
      ...(filters.deliveryDateTo ? { deliveryDateTo: filters.deliveryDateTo } : {}),
      ...(filters.portIds.length > 0 ? { portIds: filters.portIds } : {}),
      ...(filters.carrierKeys.length > 0 ? { carrierKeys: filters.carrierKeys } : {}),
      includeDispatchSummary: true,
    })
      .then((response) => {
        if (requestIdRef.current !== requestId) return;
        setItems(response.items);
        setTotal(response.total);
        setDispatchSummary(response.dispatchSummary);
        setLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setError('Không thể tải danh sách lô hàng. Vui lòng thử lại.');
        setLoading(false);
      });
  }, [page, debouncedQ, filters.tradeDirection, filters.allocationStatus, filters.deliveryDateFrom, filters.deliveryDateTo, filters.portIds, filters.carrierKeys, refreshKey]);

  const updateFilters = useCallback((patch: Partial<MasterPlanFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  /** Replace one row in-place after a save (allocation popover) — no refetch. */
  const replaceItem = useCallback((updated: ShipmentListItem) => {
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }, []);

  const refetch = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    filters,
    updateFilters,
    page,
    setPage,
    items,
    total,
    totalPages,
    loading,
    error,
    refetch,
    replaceItem,
    pageSize: PAGE_SIZE,
    dispatchSummary,
    presence,
  };
}
