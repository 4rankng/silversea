import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import {
  getCusShipmentWorkspaceDetail,
  updateCusShipmentContainerLine,
  type ShipmentListItem,
} from '../../../api/shipmentClient';
import { dispatchStatusLabel } from '../../shipments/cus/cusUtils';
import { formatDateTime24 } from '../../../lib/format';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { Drawer } from '../../../components/UI';
import { billBookingReference } from '../../../lib/business-reference';
import { SearchableSelect } from '../../../design-system';
import './DispatchContainerDetailDrawer.css';

/** Port columns are backfillable once the backend fieldAccess grants DIRECT —
 *  the same grant the Chi tiết workboard ledger already renders (the writer
 *  validates the ids against the active port catalog server-side). */
function portCellEditable(line: ShipmentCusWorkspaceContainerLine, field: 'liftSiteId' | 'dropoffSiteId') {
  return line.fieldAccess?.[field]?.mode === 'DIRECT';
}

function ContainerDetailTable({ detail, savingLineId, onPortChange }: {
  detail: ShipmentCusWorkspaceDetail;
  savingLineId: number | null;
  onPortChange: (line: ShipmentCusWorkspaceContainerLine, field: 'liftSiteId' | 'dropoffSiteId', value: string) => void;
}) {
  if (detail.containers.length === 0) {
    return <p className="dispatch-container-detail__empty">Lô hàng chưa có dữ liệu container.</p>;
  }

  const portOptions = (detail.selectors?.ports ?? []).map((port) => ({
    value: String(port.id),
    label: port.label,
    searchText: `${port.code ?? ''} ${port.name}`,
  }));

  return (
    <div className="dispatch-container-detail__table-scroll">
      <table className="dispatch-container-detail__table">
        <caption className="sr-only">Danh sách container và điều vận</caption>
        <thead>
          <tr>
            <th scope="col" className="dispatch-container-detail__ordinal-column">STT</th>
            <th scope="col">Container</th>
            <th scope="col">Loại cont</th>
            <th scope="col">Điều vận</th>
            <th scope="col">Nhà xe</th>
            <th scope="col">Biển số</th>
            <th scope="col">Nâng</th>
            <th scope="col">Hạ</th>
            <th scope="col">Giờ hẹn đóng/trả</th>
          </tr>
        </thead>
        <tbody>
          {detail.containers.map((line) => (
            <tr key={line.id} className="dispatch-container-detail__row">
              <td data-label="STT" className="dispatch-container-detail__ordinal-column">{line.ordinal}</td>
              <th scope="row" data-label="Container">
                <span className="dispatch-container-detail__inline-ordinal">#{line.ordinal}</span>
                <strong>{line.containerNumber || 'Chưa có số container'}</strong>
              </th>
              <td data-label="Loại cont">{line.containerTypeLabel || '—'}</td>
              <td data-label="Điều vận">
                <span className={`dispatch-container-detail__status dispatch-container-detail__status--${line.dispatchStatus.toLowerCase()}`}>
                  {dispatchStatusLabel(line.dispatchStatus)}
                </span>
              </td>
              <td data-label="Nhà xe">{line.carrierName || '—'}</td>
              <td data-label="Biển số">{line.plateNumber || '—'}</td>
              <td data-label="Nâng">
                {portCellEditable(line, 'liftSiteId') ? (
                  <>
                    <label className="sr-only" htmlFor={`dispatch-detail-lift-${line.id}`}>Cảng nâng của container {line.containerNumber || line.ordinal}</label>
                    <SearchableSelect
                      id={`dispatch-detail-lift-${line.id}`}
                      size="sm"
                      className="dispatch-container-detail__port-select"
                      value={line.liftSiteId ? String(line.liftSiteId) : ''}
                      onChange={(value) => onPortChange(line, 'liftSiteId', value)}
                      options={portOptions}
                      placeholder="Chọn cảng nâng"
                      searchPlaceholder="Tìm cảng nâng"
                      disabled={savingLineId != null}
                    />
                  </>
                ) : line.liftSite || '—'}
              </td>
              <td data-label="Hạ">
                {portCellEditable(line, 'dropoffSiteId') ? (
                  <>
                    <label className="sr-only" htmlFor={`dispatch-detail-drop-${line.id}`}>Cảng hạ của container {line.containerNumber || line.ordinal}</label>
                    <SearchableSelect
                      id={`dispatch-detail-drop-${line.id}`}
                      size="sm"
                      className="dispatch-container-detail__port-select"
                      value={line.dropoffSiteId ? String(line.dropoffSiteId) : ''}
                      onChange={(value) => onPortChange(line, 'dropoffSiteId', value)}
                      options={portOptions}
                      placeholder="Chọn cảng hạ"
                      searchPlaceholder="Tìm cảng hạ"
                      disabled={savingLineId != null}
                    />
                  </>
                ) : line.dropoffSite || '—'}
              </td>
              <td data-label="Giờ hẹn đóng/trả">{formatDateTime24(formatVietnamDateTimeInput(line.customerAppointmentAt)) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DispatchContainerDetailDrawer({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: ShipmentListItem | null;
  onClose: () => void;
  /** Fired after a port backfill save so the owning page refetches its board —
   *  the CẢNG NÂNG/HẠ columns read the same container port columns. */
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingPortLineId, setSavingPortLineId] = useState<number | null>(null);
  const [portSaveError, setPortSaveError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!shipment) return;
    const requestId = ++requestIdRef.current;
    setDetail(null);
    setLoading(true);
    setError(null);
    void getCusShipmentWorkspaceDetail(shipment.id)
      .then((response) => {
        if (requestId === requestIdRef.current) setDetail(response);
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Không thể tải chi tiết container. Vui lòng thử lại.');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [shipment]);

  /** Post-save/post-error resync: refetch without the full loading skeleton so
   *  the table (and the saved select) re-reads persisted values in place. */
  const refreshDetail = useCallback(async (shipmentId: number) => {
    const requestId = ++requestIdRef.current;
    try {
      const refreshed = await getCusShipmentWorkspaceDetail(shipmentId);
      if (requestId === requestIdRef.current) setDetail(refreshed);
    } catch {
      // The table keeps its last good data; the save error already surfaced.
    }
  }, []);

  const close = () => {
    // Focus return on close is Drawer-owned (useAnimatedOverlay captures the
    // opener when the sheet opens) — the bespoke returnFocusTarget plumbing
    // was a second implementation of the same contract (card 20261001_251).
    onClose();
  };

  /** Single-field port commit: the writer is value-aware and accepts only the
   *  changed port, so a pick sends exactly one nullable field. On failure the
   *  persisted detail refetches so the select snaps back to the stored value. */
  const savePort = useCallback(async (
    line: ShipmentCusWorkspaceContainerLine,
    field: 'liftSiteId' | 'dropoffSiteId',
    rawValue: string,
  ) => {
    if (!shipment || savingPortLineId != null) return;
    const portId = rawValue ? Number(rawValue) : null;
    const current = field === 'liftSiteId' ? line.liftSiteId : line.dropoffSiteId;
    if (portId === current) return;
    const shipmentId = shipment.id;
    setSavingPortLineId(line.id);
    setPortSaveError(null);
    try {
      await updateCusShipmentContainerLine(shipmentId, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
        ...(field === 'liftSiteId' ? { liftSiteId: portId } : { dropoffSiteId: portId }),
      });
      await refreshDetail(shipmentId);
      onSaved?.();
    } catch (saveError) {
      setPortSaveError(saveError instanceof Error && saveError.message
        ? saveError.message
        : 'Không thể lưu cảng nâng/hạ. Vui lòng thử lại.');
      await refreshDetail(shipmentId);
    } finally {
      setSavingPortLineId(null);
    }
  }, [shipment, savingPortLineId, refreshDetail, onSaved]);

  const retry = () => {
    if (!shipment) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    void getCusShipmentWorkspaceDetail(shipment.id)
      .then((response) => {
        if (requestId === requestIdRef.current) setDetail(response);
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Không thể tải chi tiết container. Vui lòng thử lại.');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  };

  const label = billBookingReference(shipment?.blNumber, shipment?.bookingRef);
  const portEditorsAvailable = (detail?.containers ?? []).some(
    (line) => portCellEditable(line, 'liftSiteId') || portCellEditable(line, 'dropoffSiteId'),
  );
  return (
    <Drawer
      isOpen={shipment != null}
      onClose={close}
      title="Chi tiết container"
      subtitle={shipment ? `${label}${shipment.customerName ? ` · ${shipment.customerName}` : ''}` : undefined}
      className="dispatch-container-detail-drawer"
    >
      <section className="dispatch-container-detail" aria-label="Chi tiết container">
        <header className="dispatch-container-detail__head">
          <div>
            <strong>Chi tiết container</strong>
            {detail && <span>{detail.containers.length} cont</span>}
          </div>
          <p>
            {portEditorsAvailable
              ? 'Cảng nâng/hạ bổ sung trực tiếp trong bảng; lịch giao và điều xe thuộc từng container.'
              : 'Chỉ xem tại đây; lịch giao và điều xe thuộc từng container.'}
          </p>
        </header>
        {portSaveError && <p className="dispatch-container-detail__save-error" role="alert">{portSaveError}</p>}
        {loading && !detail ? (
          <div className="dispatch-container-detail__loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải dữ liệu container…</div>
        ) : error ? (
          <div className="dispatch-container-detail__error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>Thử lại</button>
          </div>
        ) : detail ? <ContainerDetailTable detail={detail} savingLineId={savingPortLineId} onPortChange={savePort} /> : null}
      </section>
    </Drawer>
  );
}
