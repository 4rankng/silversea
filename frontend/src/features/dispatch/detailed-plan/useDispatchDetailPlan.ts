import { useCallback, useEffect, useRef, useState } from 'react';
import { useAutoRefresh } from '../../../hooks/useAutoRefresh';
import type { DispatchClassification } from '@tingting/shared';
import {
  assignDispatchDetailPlate,
  assignDispatchDetailCarrier,
  completeDispatchExternalTrip,
  decomposeDispatchDetailBranch,
  listDispatchDeliveryPointFacets,
  listDispatchDetailPlanRows,
  listDispatchDropoffPortFacets,
  listDispatchPickupPortFacets,
  listZoneTruckPresence,
  updateDispatchDetailEstimates,
  updateDispatchDetailPlan,
  type DispatchDetailPlanFilters,
  type DispatchDetailPlanRow,
  type ZoneTruckPresenceItem,
} from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';
import { dispatchShipment, type DispatchShipmentRequest } from '../../../api/shipmentClient';

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
  /** Zone code from the DB taxonomy; '' = no zone filter. */
  zone: string;
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
  zone: '',
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
    ...(filters.zone ? { zone: filters.zone } : {}),
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

  // Zone truck presence for the viewing date: advisory panel input, one
  // bounded query refetched only when the selected zone or date changes. The
  // active-zone list is the DB taxonomy; the panel follows the filter's zone
  // (or the first active zone when unfiltered).
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
  const presenceZone = filters.zone || zones[0]?.code || '';
  useEffect(() => {
    if (!presenceZone) {
      setPresence(null);
      return;
    }
    const requestId = ++presenceRequestIdRef.current;
    listZoneTruckPresence({ zone: presenceZone, date: filters.date || undefined })
      .then((response) => {
        if (presenceRequestIdRef.current !== requestId) return;
        setPresence(response);
      })
      .catch(() => {
        if (presenceRequestIdRef.current !== requestId) return;
        // Advisory only — a failed presence fetch never blocks the grid.
        setPresence(null);
      });
  }, [presenceZone, filters.date, refreshKey]);

  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  // View signature of the in-flight/last fetch (page + every enumerated
  // filter). Lets the effect tell a real view change from a background
  // refreshKey tick (the 30s auto-refresh / manual refresh button): only a
  // genuine view change may flip the grid to the skeleton.
  const viewSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const viewSignature = JSON.stringify([
      page,
      debouncedQ,
      filters.date,
      filters.direction,
      filters.assignmentStatus,
      filters.pickupIds,
      filters.dropoffIds,
      filters.deliveryPointIds,
      filters.hourFrom,
      filters.hourTo,
      filters.zone,
    ]);
    // Background refreshes must keep the table mounted: swapping it for the
    // skeleton unmounts the open row editor mid-edit and silently discards
    // the dispatcher's drafted carrier/vehicle/note changes (2026-09-09 bug:
    // the dialog self-closed on every 30s auto-refresh tick).
    const isBackgroundRefresh = viewSignatureRef.current === viewSignature;
    viewSignatureRef.current = viewSignature;
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
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
  }, [page, debouncedQ, filters.date, filters.direction, filters.assignmentStatus, filters.pickupIds, filters.dropoffIds, filters.deliveryPointIds, filters.hourFrom, filters.hourTo, filters.zone, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps -- filters fields (minus debounced q) enumerated: object identity churns per setFilters spread, depending on it would refetch on no-op patches

  const updateFilters = useCallback((patch: Partial<DetailedPlanFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const refetch = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  // 27.8 trial regression 2026-08-29: keep the dispatch detail plan in sync
  // with the driver app's "Hoàn thành chuyến" action. See the matching
  // useAutoRefresh comment in useDispatchMasterPlan for the full rationale.
  useAutoRefresh(refetch, 30_000);

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

  const assignCarrier = useCallback(async (
    row: DispatchDetailPlanRow,
    body: { carrierType: 'OWN' | 'EXTERNAL'; externalCarrierId?: number | null },
  ) => {
    setAssignmentError(null);
    try {
      const result = await assignDispatchDetailCarrier(row.fulfillmentId, {
        expectedVersion: row.version,
        ...body,
      });
      const invalidatedByFilter = filters.assignmentStatus === 'ASSIGNED';
      if (invalidatedByFilter) {
        setItems((previous) => previous
          .filter((item) => item.fulfillmentId !== row.fulfillmentId)
          .map((item) => item.shipmentId === row.shipmentId
            ? { ...item, lotFullyPlated: result.lotFullyPlated }
            : item));
      } else {
        setItems((previous) => previous.map((item) => {
          if (item.fulfillmentId === row.fulfillmentId) {
            return {
              ...item,
              version: result.version,
              dispatch: {
                ...item.dispatch,
                carrierType: result.carrierType,
                carrierName: result.carrierName,
                externalCarrierId: result.externalCarrierId,
                externalCarrierVehicleId: null,
                assignedPlate: null,
              },
            };
          }
          return item.shipmentId === row.shipmentId
            ? { ...item, lotFullyPlated: result.lotFullyPlated }
            : item;
        }));
      }
      return result;
    } catch (mutationError) {
      setAssignmentError((mutationError as { status?: number }).status === 409
        ? 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.'
        : 'Không thể đổi nhà xe. Vui lòng thử lại.');
      throw mutationError;
    }
  }, [filters.assignmentStatus]);

  const updateEstimates = useCallback(async (
    row: DispatchDetailPlanRow,
    body: { plannedRevenue: number | null; plannedCarrierCost: number | null },
  ) => {
    setAssignmentError(null);
    try {
      const result = await updateDispatchDetailEstimates(row.fulfillmentId, {
        expectedVersion: row.version,
        ...body,
      });
      setItems((previous) => previous.map((item) => item.fulfillmentId === row.fulfillmentId
        ? {
          ...item,
          version: result.version,
          estimates: {
            plannedRevenue: result.plannedRevenue,
            plannedCarrierCost: result.plannedCarrierCost,
          },
        }
        : item));
      return result;
    } catch (mutationError) {
      setAssignmentError((mutationError as { status?: number }).status === 409
        ? 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.'
        : 'Không thể lưu cước dự kiến. Vui lòng thử lại.');
      throw mutationError;
    }
  }, []);

  /** Atomic editor save — one request replaces the sequential carrier → plate
   *  → estimates writes. Replaces the returned row/version/shipmentVersion in
   *  place and propagates lot-plated state to sibling rows. */
  const savePlan = useCallback(async (
    row: DispatchDetailPlanRow,
    body: {
      carrierType: 'OWN' | 'EXTERNAL';
      externalCarrierId?: number | null;
      truckId?: number | null;
      externalCarrierVehicleId?: number | null;
      plateNumber?: string | null;
      clearVehicle?: boolean;
      plannedRevenue: number | null;
      plannedCarrierCost: number | null;
      /** Phân loại (Đơn/Kẹp/Kết hợp) — the dispatcher's call since 2026-09-08;
       *  optional so CUS-derived values stay valid when a caller omits it. */
      classification?: DispatchClassification;
      isCombined?: boolean;
      operationalNotes?: string | null;
    },
  ) => {
    setAssignmentError(null);
    try {
      const result = await updateDispatchDetailPlan(row.fulfillmentId, {
        expectedFulfillmentVersion: row.version,
        expectedShipmentVersion: row.shipmentVersion,
        ...body,
      });
      setItems((previous) => previous.map((item) => {
        if (item.fulfillmentId === row.fulfillmentId) {
          return {
            ...item,
            version: result.fulfillmentVersion,
            shipmentVersion: result.shipmentVersion,
            isCombined: result.isCombined,
            classification: result.classification,
            lotFullyPlated: result.lotFullyPlated,
            dispatch: { ...item.dispatch, ...result.dispatch },
            estimates: { ...result.estimates },
            notes: { ...item.notes, vehicleNote: result.operationalNotes },
          };
        }
        return item.shipmentId === row.shipmentId
          ? { ...item, shipmentVersion: result.shipmentVersion, lotFullyPlated: result.lotFullyPlated }
          : item;
      }));
      if (result.lotFullyPlated) {
        setLotBanner(`Lô ${row.shipmentCode ?? row.shipmentId} đã phân xe đủ.`);
      }
      return result;
    } catch (mutationError) {
      const status = (mutationError as { status?: number }).status;
      // Surface the backend's specific 409 message (version conflict vs lot
      // guard) instead of a blanket "reload" banner — reloading never fixed
      // the guard 409s and sent the dispatcher in circles.
      setAssignmentError(status === 409
        ? ((mutationError as { message?: string }).message || 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
        : 'Không thể lưu kế hoạch. Vui lòng thử lại.');
      throw mutationError;
    }
  }, []);

  /** "Phát lệnh" — issues the dispatch order for an already-planned row,
   *  creating the live trip and flipping the status chip to "Đã phát lệnh". */
  const issueOrder = useCallback(async (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => {
    setAssignmentError(null);
    try {
      const result = await dispatchShipment(row.shipmentId, {
        ...body,
        fulfillmentId: row.fulfillmentId,
        expectedVersion: row.version,
      });
      setItems((previous) => previous.map((item) => (item.fulfillmentId === row.fulfillmentId
        ? {
          ...item,
          version: result.version,
          taskStatus: 'DISPATCHED',
          dispatch: { ...item.dispatch, tripId: result.trip.id, tripStatus: result.trip.status },
        }
        : item)));
      return result;
    } catch (mutationError) {
      const status = (mutationError as { status?: number }).status;
      setAssignmentError(status === 409
        ? 'Dữ liệu đã thay đổi. Vui lòng tải lại.'
        : 'Không thể phát lệnh. Vui lòng thử lại.');
      throw mutationError;
    }
  }, []);

  /** Staff close for external-carrier trips — the external driver never uses
   *  the app, so dispatch/CUS flip the trip to COMPLETED from the grid row
   *  (trips complete-external). The row's own status chip keys on taskStatus
   *  too, so both flip together with the trip status. */
  const completeExternalTrip = useCallback(async (row: DispatchDetailPlanRow) => {
    if (row.dispatch.tripId == null) return null;
    setAssignmentError(null);
    try {
      const result = await completeDispatchExternalTrip(row.dispatch.tripId);
      setItems((previous) => previous.map((item) => (item.fulfillmentId === row.fulfillmentId
        ? {
          ...item,
          taskStatus: 'COMPLETED',
          dispatch: { ...item.dispatch, tripStatus: 'COMPLETED' },
        }
        : item)));
      return result;
    } catch (mutationError) {
      const status = (mutationError as { status?: number }).status;
      setAssignmentError(status === 409
        ? 'Dữ liệu đã thay đổi. Vui lòng tải lại.'
        : status === 403
          ? 'Bạn không có quyền hoàn thành chuyến xe ngoài.'
          : 'Không thể hoàn thành chuyến. Vui lòng thử lại.');
      throw mutationError;
    }
  }, []);

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

  /** Fulfillment-less branch rows (READY_FOR_DISPATCH containers without a
   *  fulfillment) have no editor identity — decompose the container first and
   *  hand back the fresh row so the editor targets the created fulfillment. */
  const ensureFulfillment = useCallback(async (row: DispatchDetailPlanRow): Promise<DispatchDetailPlanRow | null> => {
    setAssignmentError(null);
    if (row.shipmentContainerId == null) return null;
    try {
      const outcome = await decomposeDispatchDetailBranch({
        shipmentId: row.shipmentId,
        containerId: row.shipmentContainerId,
        expectedShipmentVersion: row.shipmentVersion,
      });
      const fresh: DispatchDetailPlanRow = {
        ...row,
        fulfillmentId: outcome.fulfillmentId,
        version: outcome.fulfillmentVersion,
        shipmentVersion: outcome.shipmentVersion,
      };
      setItems((previous) => previous.map((item) => (
        item.fulfillmentId == null && item.shipmentContainerId === row.shipmentContainerId ? fresh : item
      )));
      return fresh;
    } catch {
      setAssignmentError('Không thể tạo tác vụ điều xe cho container này. Vui lòng thử lại.');
      return null;
    }
  }, []);

  return {
    filters,
    ensureFulfillment,
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
    assignCarrier,
    updateEstimates,
    savePlan,
    issueOrder,
    completeExternalTrip,
    assignmentError,
    clearAssignmentError: () => setAssignmentError(null),
    lotBanner,
    clearLotBanner: () => setLotBanner(null),
    refresh,
    loadDeliveryPointFacets,
    loadPickupPortFacets,
    loadDropoffPortFacets,
    zones,
    presence,
  };
}
