import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { getCusShipmentWorkspaceDetail } from '../../../api/shipmentClient';
import { ContainerLedger } from '../cus/CusContainerLedger';
import { safeError } from '../cus/cusUtils';

/**
 * Card 261022095235b — customer ruling 22/10 09:50 (supersedes TICKET-09 of
 * 17/10, card 171026182554): thêm/xóa container works FROM the lot-detail
 * screen again. The page hosts the SAME container-management ledger the
 * Tổng quan drawer hosts (one shared implementation, two hosts) — seeded add
 * row (CUS-09), confirmed remove (CUS-10), per-container tờ khai inline edit
 * (card 261022095235a), and the FB-086-round-19 stale-version recovery.
 *
 * The host owns its workspace-detail fetch + idempotency keys: the page's
 * own `getShipmentDetail` read cannot feed this ledger (it carries neither
 * `selectors` nor `summary.version`), and the drawer's list-scoped state
 * hook would drag the whole overview machinery onto this page.
 */
export function ShipmentDetailContainerManagement({
  shipmentId,
  onChanged,
}: {
  shipmentId: number;
  /** Page-level refresh after any structural write (add/remove/line save)
   *  — the header's container facts and the section counts stay honest. */
  onChanged: () => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeys = useRef<Record<string, string>>({});
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const fetched = await getCusShipmentWorkspaceDetail(shipmentId);
      if (requestId === requestRef.current) setDetail(fetched);
    } catch (loadError) {
      if (requestId === requestRef.current) setError(safeError(loadError, 'Không thể tải dữ liệu container.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => { void load(); }, [load]);

  const getIdempotencyKey = useCallback((signature: string) => (
    idempotencyKeys.current[signature] ??= crypto.randomUUID()
  ), []);
  const clearIdempotencyKey = useCallback((signature: string) => {
    delete idempotencyKeys.current[signature];
  }, []);

  const handleLineSaved = useCallback(async (_line: ShipmentCusWorkspaceContainerLine | null) => {
    // Structural changes (null) and line saves both re-read the workspace
    // detail — the same refresh contract the drawer's host implements — then
    // ripple the page-level read so the header/count stays in sync.
    await load();
    await onChanged();
  }, [load, onChanged]);

  if (loading && !detail) {
    return (
      <section className="shipment-detail__card" aria-busy="true">
        <h3 className="shipment-detail__section-title">Quản lý container</h3>
        <p role="status">Đang tải dữ liệu container…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="shipment-detail__card">
        <h3 className="shipment-detail__section-title">Quản lý container</h3>
        <div className="cus-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Thử lại</button>
        </div>
      </section>
    );
  }
  if (!detail) return null;
  return (
    <section className="shipment-detail__card shipment-detail__card--flush" aria-label="Quản lý container">
      <ContainerLedger
        detail={detail}
        onLineSaved={handleLineSaved}
        getIdempotencyKey={getIdempotencyKey}
        clearIdempotencyKey={clearIdempotencyKey}
        idPrefix="shipment-detail-containers"
        onDetailStale={() => void load()}
        canRemoveContainer
      />
    </section>
  );
}
