import { useCallback, useEffect, useRef, useState } from 'react';
import { ShipmentStatus } from '@tingting/shared';
import {
  listShipments,
  type ShipmentAllocationStatus,
  type ShipmentListItem,
} from '../../../api/shipmentClient';

const PAGE_SIZE = 20;

export interface MasterPlanFilters {
  q: string;
  tradeDirection: 'IMPORT' | 'EXPORT' | '';
  allocationStatus: ShipmentAllocationStatus | '';
  deliveryDateFrom: string;
  deliveryDateTo: string;
}

export const EMPTY_MASTER_PLAN_FILTERS: MasterPlanFilters = {
  q: '',
  tradeDirection: '',
  allocationStatus: '',
  deliveryDateFrom: '',
  deliveryDateTo: '',
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
  const requestIdRef = useRef(0);

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
    })
      .then((response) => {
        if (requestIdRef.current !== requestId) return;
        setItems(response.items);
        setTotal(response.total);
        setLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setError('Không thể tải danh sách lô hàng. Vui lòng thử lại.');
        setLoading(false);
      });
  }, [page, debouncedQ, filters.tradeDirection, filters.allocationStatus, filters.deliveryDateFrom, filters.deliveryDateTo]);

  const updateFilters = useCallback((patch: Partial<MasterPlanFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  /** Replace one row in-place after a save (allocation popover) — no refetch. */
  const replaceItem = useCallback((updated: ShipmentListItem) => {
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
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
    replaceItem,
    pageSize: PAGE_SIZE,
  };
}
