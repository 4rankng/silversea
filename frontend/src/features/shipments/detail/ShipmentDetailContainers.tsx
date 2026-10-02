import { Container } from 'lucide-react';
import type { ShipmentDetail } from '../../../api/shipmentClient';
import { LedgerRecordList, type LedgerRecordFact } from '../../../components/shared/LedgerRecordList';
import { EmptyState } from '../../../design-system';
import { formatDateTimeShort } from '../../../lib/format';

type ContainerRow = ShipmentDetail['containers'][number];
type Assignment = ShipmentDetail['carrierAssignments'][number];

function containerFacts(container: ContainerRow, assignment?: Assignment): LedgerRecordFact[] {
  const carrier = !assignment?.carrierType ? '—' : assignment.carrierType === 'OWN'
    ? 'Đội xe nội bộ SilverSea' : assignment.externalCarrierName ?? 'Nhà xe chưa xác định';
  return [
    { key: 'type', label: 'Loại', value: container.containerTypeName ?? container.containerTypeCode ?? '—', primary: true },
    { key: 'number', label: 'Số container', value: <>{container.containerNumber ?? '—'}{container.pairKind && (
      <span className="shipment-detail__pair-tag">{container.pairKind === 'KEP' ? '[KẸP]' : '[KẾT HỢP]'}</span>
    )}</> },
    { key: 'carrier', label: 'Nhà xe', value: carrier, primary: true },
    { key: 'vehicle', label: 'Xe đã gán', value: container.plannedVehiclePlate ?? '—', primary: true },
    { key: 'seal', label: 'Số seal', value: container.sealNumber ?? '—' },
    { key: 'appointment', label: 'Lịch giao', value: formatDateTimeShort(container.customerAppointmentAt) },
    { key: 'weight', label: 'Trọng lượng (kg)', value: container.cargoWeightKg ?? '—' },
    { key: 'notes', label: 'Ghi chú', value: container.notes ?? '—' },
  ];
}

/** One value mapping for the phone records and the existing desktop matrix. */
export function ShipmentDetailContainers({ containers, assignments }: {
  containers: ShipmentDetail['containers']; assignments: ShipmentDetail['carrierAssignments'];
}) {
  const byContainer = new Map(assignments.filter((row) => row.shipmentContainerId != null)
    .map((row) => [row.shipmentContainerId, row]));
  const rows = containers.map((container) => ({
    key: container.id,
    title: container.containerNumber?.trim() || 'Chưa có số container',
    facts: containerFacts(container, byContainer.get(container.id)),
  }));
  return <section className="shipment-detail__card">
    <h3 className="shipment-detail__section-title"><Container size={16} /> Containers ({containers.length})</h3>
    {containers.length === 0 ? <EmptyState variant="compact" context="shipments" title="Chưa có container nào." /> : <>
      <LedgerRecordList rows={rows} />
      <div className="ds-table-scroll ledger-desktop"><table className="shipment-detail__table">
        <thead><tr>{rows[0].facts.map((fact) => <th key={fact.key}>{fact.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}>{row.facts.map((fact) => <td key={fact.key}>{fact.value}</td>)}</tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
