// SIL-717 (id 837) — the CUS Tổng quan drawer's add-container write.
//
// The hook owns THREE things the page must not duplicate:
//   1. the SOURCE ROW the new container copies (the sheet's LAST row) — one
//      resolution, so the caption the operator reads and the wire body the
//      page sends can never name different rows;
//   2. the wire body (the shared law + the CUS adapter);
//   3. the version/idempotency contract of the add command.

import { useCallback, useMemo } from 'react';
import type { ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { addCusShipmentContainerRow } from '../../../api/shipmentClient';
import { containerAddSource } from '../containerCopyLaw';
import { cusContainerAddCopy, cusContainerAddPayload } from './cusContainerAdd';
import type { ContainerAddEntry } from '../ContainerAddForm';
import { safeError } from './cusUtils';

/** The workspace operations the add write needs. */
export interface CusContainerAddDeps {
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
  setNotice: (message: string) => void;
  loadDetail: (shipmentId: number, force?: boolean) => Promise<void>;
  loadList: () => Promise<void>;
}

export interface CusDrawerContainerAdd {
  /** The row the new container copies — the sheet's LAST row. */
  source: ShipmentCusWorkspaceContainerLine | null;
  /** The write — resolves true once the row landed. */
  addContainer: (entry: ContainerAddEntry) => Promise<boolean>;
}

export function useCusDrawerContainerAdd(
  drawerId: number | null,
  detail: ShipmentCusWorkspaceDetail | undefined,
  deps: CusContainerAddDeps,
): CusDrawerContainerAdd {
  // ONE resolution of "the row directly above" — the caption in the drawer and
  // the wire body below read the same row. It follows the DETAIL (not a fresh
  // array literal), so the identity stays stable between renders.
  const source = useMemo(() => containerAddSource(detail?.containers), [detail]);

  const addContainer = useCallback(async (entry: ContainerAddEntry): Promise<boolean> => {
    if (drawerId == null || detail == null) {
      throw new Error('Không thêm được container. Vui lòng thử lại.');
    }
    const shipmentId = drawerId;
    const version = detail.summary.version;
    const payload = cusContainerAddPayload(cusContainerAddCopy(source), entry, version);
    const signature = `drawer-add-cont:${shipmentId}:${version}:${payload.containerNumber}`;
    const key = deps.getIdempotencyKey(signature);
    try {
      await addCusShipmentContainerRow(shipmentId, payload, key);
      deps.clearIdempotencyKey(signature);
      deps.setNotice(`Đã thêm container ${payload.containerNumber}.`);
      await deps.loadDetail(shipmentId, true);
      await deps.loadList();
      return true;
    } catch (error) {
      deps.clearIdempotencyKey(signature);
      // The version moved on (a poll landed meanwhile) — reload so the next
      // attempt rides the fresh one instead of 409-ing on a stale version.
      await deps.loadDetail(shipmentId, true).catch(() => undefined);
      throw new Error(safeError(error, 'Không thêm được container. Vui lòng thử lại.'));
    }
  }, [deps, detail, drawerId, source]);

  return { source, addContainer };
}
