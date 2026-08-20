import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { getCusShipmentWorkspaceDetail, type ShipmentListItem } from '../../../api/shipmentClient';
import { Drawer } from '../../../components/UI';
import './DispatchContainerDetailDrawer.css';

const DISPATCH_STATUS_LABELS: Record<ShipmentCusWorkspaceContainerLine['dispatchStatus'], string> = {
  UNASSIGNED: 'Chờ phân xe',
  PLANNED: 'Đã phân xe',
  CREATED: 'Đã tạo chuyến',
  IN_TRANSIT: 'Đang vận chuyển',
  COMPLETED: 'Hoàn tất',
};

function formatContainerAppointment(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

function ContainerDetailTable({ detail }: { detail: ShipmentCusWorkspaceDetail }) {
  if (detail.containers.length === 0) {
    return <p className="dispatch-container-detail__empty">Lô hàng chưa có dữ liệu container.</p>;
  }

  return (
    <div className="dispatch-container-detail__table-scroll">
      <table className="dispatch-container-detail__table">
        <caption className="sr-only">Danh sách container và điều vận</caption>
        <thead>
          <tr>
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
              <th scope="row" data-label="Container">
                <span className="dispatch-container-detail__ordinal">{line.ordinal}</span>
                <strong>{line.containerNumber || 'Chưa có số container'}</strong>
              </th>
              <td data-label="Loại cont">{line.containerTypeLabel || '—'}</td>
              <td data-label="Điều vận">
                <span className={`dispatch-container-detail__status dispatch-container-detail__status--${line.dispatchStatus.toLowerCase()}`}>
                  {DISPATCH_STATUS_LABELS[line.dispatchStatus]}
                </span>
              </td>
              <td data-label="Nhà xe">{line.carrierName || '—'}</td>
              <td data-label="Biển số">{line.plateNumber || '—'}</td>
              <td data-label="Nâng">{line.liftSite || '—'}</td>
              <td data-label="Hạ">{line.dropoffSite || '—'}</td>
              <td data-label="Giờ hẹn đóng/trả">{formatContainerAppointment(line.customerAppointmentAt)}</td>
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
  returnFocusTarget,
}: {
  shipment: ShipmentListItem | null;
  onClose: () => void;
  returnFocusTarget?: HTMLElement | null;
}) {
  const [detail, setDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const close = () => {
    onClose();
    window.requestAnimationFrame(() => returnFocusTarget?.focus());
  };

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

  const label = shipment?.shipmentCode?.trim() || shipment?.blNumber?.trim() || shipment?.bookingRef?.trim() || 'Lô hàng';
  return (
    <Drawer
      isOpen={shipment != null}
      onClose={close}
      title="Chi tiết cont"
      subtitle={shipment ? `${label}${shipment.customerName ? ` · ${shipment.customerName}` : ''}` : undefined}
      className="dispatch-container-detail-drawer"
    >
      <section className="dispatch-container-detail" aria-label="Chi tiết container">
        <header className="dispatch-container-detail__head">
          <div>
            <strong>Chi tiết container</strong>
            {detail && <span>{detail.containers.length} cont</span>}
          </div>
          <p>Chỉ xem tại đây; lịch giao và điều xe thuộc từng container.</p>
        </header>
        {loading && !detail ? (
          <div className="dispatch-container-detail__loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải dữ liệu container…</div>
        ) : error ? (
          <div className="dispatch-container-detail__error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>Thử lại</button>
          </div>
        ) : detail ? <ContainerDetailTable detail={detail} /> : null}
      </section>
    </Drawer>
  );
}
