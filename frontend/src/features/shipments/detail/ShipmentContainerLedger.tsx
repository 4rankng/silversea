import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

type DispatchStatus = ShipmentCusContainerFlatRow['dispatchStatus'];

const DISPATCH_STATUS: Record<DispatchStatus, { label: string; color: 'warning' | 'brand' | 'blue' | 'success' }> = {
  UNASSIGNED: { label: 'Chưa điều xe', color: 'warning' },
  PLANNED: { label: 'Đã phân xe', color: 'brand' },
  CREATED: { label: 'Đã tạo chuyến', color: 'blue' },
  IN_TRANSIT: { label: 'Đang vận chuyển', color: 'blue' },
  COMPLETED: { label: 'Hoàn thành', color: 'success' },
};

function directionLabel(direction: ShipmentCusContainerFlatRow['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return 'Chưa xác định';
}

function formatAppointment(value: string | null): { date: string; time: string } | null {
  if (!value) return null;
  const vietnamDateTime = formatVietnamDateTimeInput(value);
  if (!vietnamDateTime) return { date: value, time: '' };
  const [datePart, time] = vietnamDateTime.split('T');
  const [year, month, day] = datePart.split('-');
  return {
    date: `${day}/${month}/${year}`,
    time,
  };
}

function Fallback({ children }: { children: string }) {
  return <span className="shipment-container-ledger__missing">{children}</span>;
}

interface ShipmentContainerLedgerProps {
  rows: ShipmentCusContainerFlatRow[];
  totalShipments: number;
}

export function ShipmentContainerLedger({ rows, totalShipments }: ShipmentContainerLedgerProps) {
  const unassignedCount = rows.filter((row) => row.dispatchStatus === 'UNASSIGNED').length;
  const assignedCount = rows.length - unassignedCount;

  return (
    <>
      <dl className="shipment-container-summary" aria-label="Tổng quan trang hiện tại">
        <div>
          <dt>Container trên trang</dt>
          <dd>{rows.length.toLocaleString('vi-VN')}</dd>
        </div>
        <div className={unassignedCount > 0 ? 'shipment-container-summary__attention' : undefined}>
          <dt>Chưa điều xe</dt>
          <dd>{unassignedCount.toLocaleString('vi-VN')}</dd>
        </div>
        <div>
          <dt>Đã có kế hoạch</dt>
          <dd>{assignedCount.toLocaleString('vi-VN')}</dd>
        </div>
        <div>
          <dt>Lô hàng phù hợp</dt>
          <dd>{totalShipments.toLocaleString('vi-VN')}</dd>
        </div>
      </dl>

      <p id="shipment-container-ledger-instructions" className="sr-only">
        Bảng container của các lô hàng. Mỗi dòng là một container với lô hàng, hành trình, lịch hẹn, phương tiện và trạng thái điều vận.
      </p>
      <div
        className="shipment-container-ledger"
        role="region"
        aria-label="Danh sách chi tiết container"
        aria-describedby="shipment-container-ledger-instructions"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">Chi tiết container theo lô hàng</caption>
          <colgroup>
            <col className="shipment-container-ledger__col--container" />
            <col className="shipment-container-ledger__col--shipment" />
            <col className="shipment-container-ledger__col--route" />
            <col className="shipment-container-ledger__col--appointment" />
            <col className="shipment-container-ledger__col--vehicle" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Container và điều vận</th>
              <th scope="col">Lô hàng</th>
              <th scope="col">Hành trình nâng/hạ</th>
              <th scope="col">Lịch hẹn đóng/trả</th>
              <th scope="col">Xe vận chuyển</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const appointment = formatAppointment(row.customerAppointmentAt);
              const dispatch = DISPATCH_STATUS[row.dispatchStatus];
              return (
                <tr key={row.id}>
                  <th scope="row" data-label="Container và điều vận">
                    <div className="shipment-container-ledger__identity">
                      <strong className="shipment-container-ledger__code">{row.containerNumber || 'Chưa có số container'}</strong>
                      <span>{row.containerTypeLabel || 'Chưa rõ loại container'}</span>
                      <BadgeWithDot type="color" size="sm" color={dispatch.color}>
                        {dispatch.label}
                      </BadgeWithDot>
                    </div>
                  </th>
                  <td data-label="Lô hàng">
                    <div className="shipment-container-ledger__shipment">
                      <div className="shipment-container-ledger__bill">
                        <strong>{row.billOrBookNumber || 'Chưa có Bill/Booking'}</strong>
                        <span>{directionLabel(row.direction)}</span>
                      </div>
                      <span>{row.customerName || 'Chưa cập nhật khách hàng'}</span>
                      <small>{row.factoryName || 'Chưa cập nhật nhà máy'}</small>
                    </div>
                  </td>
                  <td data-label="Hành trình nâng/hạ">
                    <div className="shipment-container-ledger__route">
                      <span><small>Điểm nâng</small>{row.liftSite || <Fallback>Chưa cập nhật</Fallback>}</span>
                      <i aria-hidden="true">→</i>
                      <span><small>Điểm hạ</small>{row.dropoffSite || <Fallback>Chưa cập nhật</Fallback>}</span>
                    </div>
                  </td>
                  <td data-label="Lịch hẹn đóng/trả">
                    {appointment ? (
                      <time className="shipment-container-ledger__appointment" dateTime={row.customerAppointmentAt ?? undefined}>
                        <strong>{appointment.time}</strong>
                        <span>{appointment.date}</span>
                      </time>
                    ) : <Fallback>Chưa có lịch hẹn</Fallback>}
                  </td>
                  <td data-label="Xe vận chuyển">
                    <div className="shipment-container-ledger__vehicle">
                      <strong>{row.carrierName || 'Chưa có nhà xe'}</strong>
                      {row.plateNumber
                        ? <span className="shipment-container-ledger__plate">{row.plateNumber}</span>
                        : <Fallback>Chưa có biển số</Fallback>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
