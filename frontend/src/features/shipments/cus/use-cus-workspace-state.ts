// Server-state hook for the CUS shipments workboard.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01 structural
// split: list + per-shipment detail fetching with manual race guards, the
// container-line optimistic patch, dirty/saving tracking for the mobile
// drawer, and the signature-keyed idempotency store shared by every mutation.
// (The race guards retire in the react-query migration — until then they are
// the behavior contract.)

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ShipmentCusBucket,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListResponse,
  ShipmentCusWorkspaceSortKey,
} from '@tingting/shared';
import { useAutoRefresh } from '../../../hooks/useAutoRefresh';
import {
  getCusShipmentWorkspaceDetail,
  listCusShipmentWorkspace,
} from '../../../api/shipmentClient';
import { safeError } from './cusUtils';

export const CUS_PAGE_SIZE = 20;

export interface CusWorkspaceListParams {
  page: number;
  searchSuffix: string;
  transportDateFrom: string;
  transportDateTo: string;
  direction: '' | 'IMPORT' | 'EXPORT';
  bucket: '' | ShipmentCusBucket;
  sortKey: ShipmentCusWorkspaceSortKey | null;
  sortDir: 'asc' | 'desc';
}

export function useCusWorkspaceState(params: CusWorkspaceListParams) {
  const { page, searchSuffix, transportDateFrom, transportDateTo, direction, bucket, sortKey, sortDir } = params;
  const [data, setData] = useState<ShipmentCusWorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<number, ShipmentCusWorkspaceDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<number>>(() => new Set());
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const [dirtyDetailIds, setDirtyDetailIds] = useState<Set<number>>(() => new Set());
  const [savingDetailIds, setSavingDetailIds] = useState<Set<number>>(() => new Set());
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef<Record<number, number>>({});
  const idempotencyKeysRef = useRef<Record<string, string>>({});

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

  const loadList = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await listCusShipmentWorkspace({
        page,
        limit: CUS_PAGE_SIZE,
        searchSuffix: searchSuffix || undefined,
        transportDateFrom: transportDateFrom || undefined,
        transportDateTo: transportDateTo || undefined,
        direction: direction || undefined,
        bucket: bucket || undefined,
        sortBy: sortKey ?? undefined,
        sortDir: sortKey ? sortDir : undefined,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(safeError(loadError, 'Không thể tải danh sách lô hàng.'));
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [bucket, direction, page, sortDir, sortKey, transportDateFrom, transportDateTo, searchSuffix]);

  // 27.8 trial regression 2026-08-29: driver "Hoàn thành chuyến" flipped the
  // shipment server-side but this list kept reading "Đang chạy" until manual
  // reload. Polling + visibility-refetch keeps the CUS workboard honest when
  // a remote role (driver, OPS, accountant) mutates the underlying state
  // while the user is parked here. Pause when the tab is hidden so we don't
  // burn the office workspace on a backgrounded tab.
  useAutoRefresh(loadList, 30_000);
  useEffect(() => { void loadList(); }, [loadList]);

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

  const applySavedContainerLine = useCallback(async (shipmentId: number, line: ShipmentCusWorkspaceContainerLine) => {
    setDetails((current) => {
      const detail = current[shipmentId];
      if (!detail) return current;
      const externalCarriers = line.externalCarrierId && line.carrierName && !detail.selectors.externalCarriers.some((carrier) => carrier.id === line.externalCarrierId)
        ? [...detail.selectors.externalCarriers, { id: line.externalCarrierId, name: line.carrierName, shortName: null, label: line.carrierName }]
        : detail.selectors.externalCarriers;
      const carrierVehicles = line.externalCarrierId && line.externalCarrierVehicleId && line.plateNumber && !detail.selectors.carrierVehicles.some((vehicle) => vehicle.id === line.externalCarrierVehicleId)
        ? [...detail.selectors.carrierVehicles, { id: line.externalCarrierVehicleId, carrierId: line.externalCarrierId, licensePlate: line.plateNumber, label: line.plateNumber }]
        : detail.selectors.carrierVehicles;
      return {
        ...current,
        [shipmentId]: {
          ...detail,
          summary: { ...detail.summary, version: line.shipmentVersion },
          selectors: { ...detail.selectors, externalCarriers, carrierVehicles },
          containers: detail.containers.map((currentLine) => (
            currentLine.id === line.id
              ? line
              : { ...currentLine, shipmentVersion: line.shipmentVersion }
          )),
        },
      };
    });
    setNotice('Đã lưu dữ liệu container. Xác nhận Kế toán cũ (nếu có) sẽ được kiểm tra lại theo nguồn mới.');
    await loadList();
  }, [loadList]);

  const setDetailDirty = useCallback((shipmentId: number, dirty: boolean) => {
    setDirtyDetailIds((current) => {
      const next = new Set(current);
      if (dirty) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
  }, []);

  const setDetailSaving = useCallback((shipmentId: number, saving: boolean) => {
    setSavingDetailIds((current) => {
      const next = new Set(current);
      if (saving) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
  }, []);

  /** Drop the cached detail so the next open refetches from the server. */
  const invalidateDetail = useCallback((shipmentId: number) => {
    setDetails((current) => {
      const next = { ...current };
      delete next[shipmentId];
      return next;
    });
  }, []);

  return {
    data, loading, error, notice, setError, setNotice, loadList,
    details, detailLoadingIds, detailErrors, loadDetail,
    applySavedContainerLine, dirtyDetailIds, savingDetailIds, setDetailDirty, setDetailSaving,
    invalidateDetail, getIdempotencyKey, clearIdempotencyKey,
  };
}
