import { Container } from 'lucide-react';
import { EmptyState } from '../../../design-system';
import { formatDateTimeShort as formatDateTime } from '../../../lib/format';
import type { ShipmentContainer } from '../../../api/shipmentClient';

/** One carrier allocation projected onto the container table. Shape mirrors
 *  `ShipmentDetail['carrierAssignments']` — declared locally because the page
 *  test mocks the client module with only the detail fetch. */
export interface ShipmentCarrierAssignment {
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentContainerId: number | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
  carrierType: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId: number | null;
  externalCarrierName: string | null;
}

/**
 * The Containers card of the shipment detail grid (moved out of
 * `ShipmentDetailPage` for the 400-line ceiling). Each container row reads its
 * carrier through the live assignment for that container; the carrier column
 * heading is state-aware and shares the carrier section's label — "Nhà xe đã
 * gán" the moment any allocation carries a carrier, plain "Nhà xe" otherwise.
 */
export function ShipmentDetailContainers({ containers, assignments }: {
  containers: ShipmentContainer[];
  assignments: ShipmentCarrierAssignment[];
}) {
  const carrierLabelByContainerId = new Map(assignments
    .filter((assignment) => assignment.shipmentContainerId != null)
    .map((assignment) => [assignment.shipmentContainerId as number, assignment]));
  const hasAssignedCarrier = assignments.some((assignment) => assignment.carrierType != null);

  return (
    <section className="shipment-detail__card">
      <h3 className="shipment-detail__section-title">
        <Container size={16} /> Containers ({containers.length})
      </h3>
      {containers.length === 0 ? (
        <EmptyState variant="compact" context="shipments" title="Chưa có container nào." />
      ) : (
        <table className="shipment-detail__table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Số container</th>
              <th>{hasAssignedCarrier ? 'Nhà xe đã gán' : 'Nhà xe'}</th>
              <th>Xe đã gán</th>
              <th>Số seal</th>
              <th>Lịch giao</th>
              <th>Trọng lượng (kg)</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => {
              const assignment = carrierLabelByContainerId.get(c.id);
              const carrierLabel = !assignment?.carrierType
                ? '—'
                : assignment.carrierType === 'OWN'
                  ? 'Đội xe nội bộ SilverSea'
                  : assignment.externalCarrierName ?? 'Nhà xe chưa xác định';
              return (
                <tr key={c.id}>
                  <td>{c.containerTypeName ?? c.containerTypeCode ?? '—'}</td>
                  <td>
                    {c.containerNumber ?? '—'}
                    {c.pairKind && (
                      <span className="shipment-detail__pair-tag">
                        {c.pairKind === 'KEP' ? '[KẸP]' : '[KẾT HỢP]'}
                      </span>
                    )}
                  </td>
                  <td>{carrierLabel}</td>
                  <td>{c.plannedVehiclePlate ?? '—'}</td>
                  <td>{c.sealNumber ?? '—'}</td>
                  <td>{formatDateTime(c.customerAppointmentAt)}</td>
                  <td>{c.cargoWeightKg ?? '—'}</td>
                  <td>{c.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
