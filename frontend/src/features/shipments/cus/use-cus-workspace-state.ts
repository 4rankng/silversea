// Server-state hook for the CUS shipments workboard.
//
// List reads run on TanStack Query with an EQUIVALENCE config — the cache
// settings reproduce the hand-rolled behavior exactly (see each inline
// comment), because that behavior was tuned against live-trial regressions:
//
//   - 30s polling + visibility refetch (27.8 trial 2026-08-29: driver
//     "Hoàn thành chuyến" flipped a shipment server-side but the board kept
//     reading "Đang chạy" until manual reload).
//   - The previous list stays rendered while a filter/sort/page change is
//     in flight (no blank flash).
//   - `loading` toggles on every fetch, including background polls.
//
// Drawer-scoped per-shipment detail reads stay on the manual guarded path
// (detailRequestSequence): they are per-id, drawer-gated, and pinned by the
// page's characterization tests — migrating them buys no observable behavior.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  ShipmentCusBucket,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListResponse,
  ShipmentCusWorkspaceSortKey,
} from '@tingting/shared';
import { SHIPMENT_CUS_PAGE_SIZES } from '@tingting/shared';
import { qk } from '../../../api/keys';
import {
  getCusShipmentWorkspaceDetail,
  listCusShipmentWorkspace,
} from '../../../api/shipmentClient';
import { safeError } from './cusUtils';

/** Rows-per-page vocabulary for the CUS workboards: the offered sizes and the
 *  URL reader. A hand-edited `limit=37` falls back to the default rather than
 *  asking the API for an arbitrary page. Re-exported here so the pages import
 *  the selector options and the reader from the one module they already use. */
export { SHIPMENT_CUS_PAGE_SIZES } from '@tingting/shared';

export function readCusPageSize(value: string | null): number {
  const parsed = Number(value);
  return (SHIPMENT_CUS_PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : CUS_PAGE_SIZE;
}

export const CUS_PAGE_SIZE = 20;
const CUS_LIST_POLL_MS = 30_000;

export interface CusWorkspaceListParams {
  page: number;
  /** Rows per page — one of SHIPMENT_CUS_PAGE_SIZES (20 by default). */
  pageSize: number;
  searchSuffix: string;
  transportDateFrom: string;
  transportDateTo: string;
  direction: '' | 'IMPORT' | 'EXPORT';
  bucket: '' | ShipmentCusBucket;
  /** 20260917_12: 'true' = chỉ lệnh chạy ngoài, 'false' = chỉ luồng danh mục. */
  adHoc: '' | 'true' | 'false';
  sortKey: ShipmentCusWorkspaceSortKey | null;
  sortDir: 'asc' | 'desc';
}

export function useCusWorkspaceState(params: CusWorkspaceListParams, activeDetailId: number | null = null) {
  const { page, pageSize, searchSuffix, transportDateFrom, transportDateTo, direction, bucket, adHoc = '', sortKey, sortDir } = params;
  const [notice, setNotice] = useState<string | null>(null);
  // Non-list errors (mutations, guards) still write imperatively; list-load
  // errors come from the query. Old code cleared the shared error state at
  // fetch START, so hide the list error while a fetch is in flight.
  const [actionError, setActionError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<number, ShipmentCusWorkspaceDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<number>>(() => new Set());
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const detailRequestSequence = useRef<Record<number, number>>({});
  const idempotencyKeysRef = useRef<Record<string, string>>({});

  const listQuery = useQuery({
    queryKey: qk.shipmentsCus.list({
      page,
      pageSize,
      searchSuffix,
      transportDateFrom,
      transportDateTo,
      direction,
      bucket,
      isAdHoc: adHoc === '' ? undefined : adHoc === 'true',
      sortBy: sortKey ?? undefined,
      sortDir: sortKey ? sortDir : undefined,
    }),
    queryFn: () => listCusShipmentWorkspace({
      page,
      limit: pageSize,
      searchSuffix: searchSuffix || undefined,
      transportDateFrom: transportDateFrom || undefined,
      transportDateTo: transportDateTo || undefined,
      direction: direction || undefined,
      bucket: bucket || undefined,
      isAdHoc: adHoc === '' ? undefined : adHoc === 'true',
      sortBy: sortKey ?? undefined,
      sortDir: sortKey ? sortDir : undefined,
    }),
    // Equivalence config — see file header. These override the app-wide
    // defaults in main.tsx (refetchOnWindowFocus: false, staleTime: 5min);
    // the refresh-cadence test locks the override in.
    placeholderData: keepPreviousData,
    refetchInterval: CUS_LIST_POLL_MS,
    refetchIntervalInBackground: false,
    // The old hand-rolled hook fetched on EVERY mount (uncached useState +
    // effect). staleTime: Infinity would suppress that on route-return, so
    // force it — the dispatcher's /shipments ↔ /shipments-detail round-trip
    // must never render a cached snapshot without refetching.
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: Infinity,
    retry: false,
  });

  const data: ShipmentCusWorkspaceListResponse | null = listQuery.data ?? null;
  // Old code set loading=true on every loadList call — including each 30s
  // poll — so isFetching (not isLoading) is the faithful mapping.
  const loading = listQuery.isFetching;
  const error = actionError
    ?? (listQuery.isError && !listQuery.isFetching
      ? safeError(listQuery.error, 'Không thể tải danh sách lô hàng.')
      : null);

  const { refetch } = listQuery;
  const loadList = useCallback(async () => {
    // Old loadList cleared the error notice synchronously at call time —
    // polls, post-save refetches, and the retry button all relied on it.
    setActionError(null);
    await refetch();
  }, [refetch]);

  // Old loadList cleared the shared error notice at every fetch start —
  // polls included — so a "Đang lưu…" block retires on the post-save
  // refetch (and on the next poll) exactly as before. Reproduce that on the
  // rising edge of isFetching, which covers refetch(), invalidations, and
  // the interval alike.
  // Query-internal fetches (interval, focus) cleared the notice in the old
  // useAutoRefresh path too — catch their rising edge for parity.
  const wasFetching = useRef(false);
  useEffect(() => {
    if (listQuery.isFetching && !wasFetching.current) setActionError(null);
    wasFetching.current = listQuery.isFetching;
  }, [listQuery.isFetching]);

  const getIdempotencyKey = useCallback((signature: string) => {
    const existing = idempotencyKeysRef.current[signature];
    if (existing) return existing;
    const next = crypto.randomUUID();
    idempotencyKeysRef.current[signature] = next;
    return next;
  }, []);

  const clearIdempotencyKey = useCallback((signature: string) => {
    delete idempotencyKeysRef.current[signature];
  }, []);

  const loadDetail = useCallback(async (shipmentId: number, force = false) => {
    if (!force && details[shipmentId]) return;
    const requestId = (detailRequestSequence.current[shipmentId] ?? 0) + 1;
    detailRequestSequence.current[shipmentId] = requestId;
    setDetailLoadingIds((current) => new Set(current).add(shipmentId));
    setDetailErrors((current) => ({ ...current, [shipmentId]: '' }));
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipmentId);
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetails((current) => ({ ...current, [shipmentId]: detail }));
      }
    } catch (detailError) {
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetailErrors((current) => ({
          ...current,
          [shipmentId]: safeError(detailError, 'Không thể tải chi tiết container.'),
        }));
      }
    } finally {
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetailLoadingIds((current) => {
          const next = new Set(current);
          next.delete(shipmentId);
          return next;
        });
      }
    }
  }, [details]);

  // SIL-485: applySavedContainerLine and the dirty/saving container-draft
  // sets retired with the editable ledger — the drawer view is read-only, so
  // nothing patches lines optimistically and nothing blocks a close on drafts.

  /** Drop the cached detail so the next open refetches from the server. */
  const invalidateDetail = useCallback((shipmentId: number) => {
    setDetails((current) => {
      const next = { ...current };
      delete next[shipmentId];
      return next;
    });
  }, []);

  // The open drawer's cached detail carries the selectors the REVIEW reads —
  // the Nhận diện/Thông tin cells resolve labels (site names) from them, so
  // a rename landing elsewhere (admin config, another tab) must surface here
  // without a full reload. Revalidate on window-focus/visibility regain, same
  // trigger already used for shipment-create catalogs
  // (ShipmentCreateWorkspace.tsx). Containers/summary stay untouched.
  useEffect(() => {
    if (activeDetailId == null) return;
    const shipmentId = activeDetailId;
    let revalidateInFlight = false;
    let revalidatePending = false;
    function revalidateSelectors() {
      if (revalidateInFlight) { revalidatePending = true; return; }
      if (document.visibilityState === 'hidden') return;
      revalidateInFlight = true;
      getCusShipmentWorkspaceDetail(shipmentId).then((fresh) => {
        setDetails((current) => {
          const existing = current[shipmentId];
          if (!existing) return current;
          return { ...current, [shipmentId]: { ...existing, selectors: fresh.selectors } };
        });
      }).catch(() => {}).finally(() => {
        revalidateInFlight = false;
        if (revalidatePending) {
          revalidatePending = false;
          revalidateSelectors();
        }
      });
    }
    window.addEventListener('focus', revalidateSelectors);
    document.addEventListener('visibilitychange', revalidateSelectors);
    return () => {
      window.removeEventListener('focus', revalidateSelectors);
      document.removeEventListener('visibilitychange', revalidateSelectors);
    };
  }, [activeDetailId]);

  return {
    data, loading, error, notice, setError: setActionError as Dispatch<SetStateAction<string | null>>, setNotice, loadList,
    details, detailLoadingIds, detailErrors, loadDetail,
    invalidateDetail, getIdempotencyKey, clearIdempotencyKey,
  };
}
