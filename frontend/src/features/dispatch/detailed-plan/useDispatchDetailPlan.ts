import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assignDispatchDetailPlate,
  listDispatchDeliveryPointFacets,
  listDispatchDetailPlanRows,
  listDispatchDropoffPortFacets,
  listDispatchPickupPortFacets,
  type DispatchDetailPlanFilters,
  type DispatchDetailPlanRow,
} from '../../../api/dispatchPlanningClient';

const PAGE_SIZE = 50;

export interface DetailedPlanFilterState extends DispatchDetailPlanFilters {
  q: string;
  date: string;
  direction: 'IMPORT' | 'EXPORT' | '';
  assignmentStatus: 'UNASSIGNED' | 'ASSIGNED' | '';
  pickupIds: number[];
  dropoffIds: number[];
  deliveryPointIds: number[];
  hourFrom: string;
  hourTo: string;
}

export const EMPTY_DETAILED_PLAN_FILTERS: DetailedPlanFilterState = {
  q: '',
  date: '',
  direction: '',
  assignmentStatus: '',
  pickupIds: [],
  dropoffIds: [],
  deliveryPointIds: [],
  hourFrom: '',
  hourTo: '',
};

export function createDefaultDetailedPlanFilters(): DetailedPlanFilterState {
  // No default transport date — /dispatch parity: the grid lists all allocated
  // fulfillments until the dispatcher filters by an explicit day.
  return { ...EMPTY_DETAILED_PLAN_FILTERS };
}

export type DetailPlanSortKey = 'runHour' | 'deliveryPoint' | null;

/** Query params shared by the list, load-more, and refresh requests. */
function detailPlanQuery(filters: DetailedPlanFilterState, q: string) {
  return {
    ...(q ? { q } : {}),
    ...(filters.date ? { date: filters.date } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.assignmentStatus ? { assignmentStatus: filters.assignmentStatus } : {}),
    ...(filters.pickupIds.length > 0 ? { pickupIds: filters.pickupIds } : {}),
    ...(filters.dropoffIds.length > 0 ? { dropoffIds: filters.dropoffIds } : {}),
    ...(filters.deliveryPointIds.length > 0 ? { deliveryPointIds: filters.deliveryPointIds } : {}),
    ...(filters.hourFrom ? { hourFrom: filters.hourFrom } : {}),
    ...(filters.hourTo ? { hourTo: filters.hourTo } : {}),
  };
}

/**
 * Data hook for the dispatch detail plan grid ("Kế hoạch Chi tiết Xe"):
 * server-side filters + cursor pagination over one-row-per-fulfillment data,
 * with the in-row plate-assignment mutation (optimistic update + rollback on
 * failure). Same request-id race guard pattern as useDispatchMasterPlan.
 */
export function useDispatchDetailPlan() {
  const [filters, setFilters] = useState<DetailedPlanFilterState>(createDefaultDetailedPlanFilters);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DispatchDetailPlanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<DetailPlanSortKey>(null);
  const [lotBanner, setLotBanner] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestIdRef = useRef(0);

  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    listDispatchDetailPlanRows({
      page,
      limit: PAGE_SIZE,
      ...detailPlanQuery(filters, debouncedQ),
    })
      .then((response) => {
        if (requestIdRef.current !== requestId) return;
        setItems(response.items);
        setTotal(response.total);
        setLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setError('Không thể tải kế hoạch chi tiết. Vui lòng thử lại.');
        setLoading(false);
      });
  }, [page, debouncedQ, filters.date, filters.direction, filters.assignmentStatus, filters.pickupIds, filters.dropoffIds, filters.deliveryPointIds, filters.hourFrom, filters.hourTo, refreshKey]);

  const updateFilters = useCallback((patch: Partial<DetailedPlanFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleSort = useCallback((key: Exclude<DetailPlanSortKey, null>) => {
    setSortKey((current) => (current === key ? null : key));
  }, []);

  // Client-side sort over the loaded page (spec: bundle trips by run hour or
  // dropoff point).
  const sortedItems = sortKey == null
    ? items
    : [...items].sort((a, b) => {
      if (sortKey === 'runHour') {
        const av = a.time.runHour ?? 99;
        const bv = b.time.runHour ?? 99;
        return av - bv;
      }
      const av = a.customerRoute.deliveryPoint ?? '';
      const bv = b.customerRoute.deliveryPoint ?? '';
      return av.localeCompare(bv, 'vi');
    });

  const assignPlate = useCallback(async (
    row: DispatchDetailPlanRow,
    body: { truckId?: number | null; externalCarrierVehicleId?: number | null; plateNumber?: string | null; clear?: boolean },
  ) => {
    setAssignmentError(null);
    try {
      const result = await assignDispatchDetailPlate(row.fulfillmentId, {
        expectedVersion: row.version,
        ...body,
      });
      // When an assignment-status filter is active, an assignment flip can
      // invalidate the filtered view (e.g. a row just plated still listed under
      // "Chưa gán Biển số"). Drop the row from the current list so the filter
      // stays truthful; a refetch happens whenever filters change.
      const nowAssigned = body.clear ? false : !!result.assignedPlate;
      const invalidatedByFilter = filters.assignmentStatus === 'UNASSIGNED' && nowAssigned
        || filters.assignmentStatus === 'ASSIGNED' && !nowAssigned;
      if (invalidatedByFilter) {
        setItems((prev) => prev.filter((item) => item.fulfillmentId !== row.fulfillmentId));
      } else {
        setItems((prev) => prev.map((item) => item.fulfillmentId === row.fulfillmentId
          ? { ...item, version: result.version, dispatch: { ...item.dispatch, assignedPlate: result.assignedPlate, externalCarrierVehicleId: body.externalCarrierVehicleId ?? (body.clear ? null : item.dispatch.externalCarrierVehicleId) } }
          : item));
      }
      // A lot flip surfaces for every row of that shipment.
      if (result.lotFullyPlated) {
        setItems((prev) => prev.map((item) => item.shipmentId === row.shipmentId
          ? { ...item, lotFullyPlated: true }
          : item));
        setLotBanner(`Lô ${row.shipmentCode ?? row.shipmentId} đã phân xe đủ.`);
      } else {
        setItems((prev) => prev.map((item) => item.shipmentId === row.shipmentId
          ? { ...item, lotFullyPlated: false }
          : item));
      }
      return result;
    } catch (mutationError) {
      const status = (mutationError as { status?: number }).status;
      if (status === 409) {
        setAssignmentError('Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      } else {
        setAssignmentError('Không thể lưu biển số xe. Vui lòng thử lại.');
      }
      throw mutationError;
    }
  }, [filters.assignmentStatus]);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const loadDeliveryPointFacets = useCallback(async (q?: string) => {
    const response = await listDispatchDeliveryPointFacets(q ? { q } : {});
    return response.items;
  }, []);

  const loadPickupPortFacets = useCallback(async (q?: string) => {
    const response = await listDispatchPickupPortFacets(q ? { q } : {});
    return response.items;
  }, []);

  const loadDropoffPortFacets = useCallback(async (q?: string) => {
    const response = await listDispatchDropoffPortFacets(q ? { q } : {});
    return response.items;
  }, []);

  return {
    filters,
    updateFilters,
    items: sortedItems,
    loading,
    error,
    page,
    totalPages,
    total,
    pageSize: PAGE_SIZE,
    setPage,
    sortKey,
    toggleSort,
    assignPlate,
    assignmentError,
    clearAssignmentError: () => setAssignmentError(null),
    lotBanner,
    clearLotBanner: () => setLotBanner(null),
    refresh,
    loadDeliveryPointFacets,
    loadPickupPortFacets,
    loadDropoffPortFacets,
  };
}
