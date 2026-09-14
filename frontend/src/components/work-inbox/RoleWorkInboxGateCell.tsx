import {
  type CustomerWorkInboxItem,
  type DriverWorkInboxItem,
  type OperationsWorkInboxItem,
} from '@tingting/shared';

type Role = 'operations' | 'driver' | 'customer';
type RoleItem = OperationsWorkInboxItem | DriverWorkInboxItem | CustomerWorkInboxItem;
type Gate = { label: string; satisfied: boolean; pending?: string };

function crossBranchGate(item: RoleItem, role: Role): Gate[] {
  if (role === 'driver') {
    const value = item as DriverWorkInboxItem;
    // The driver row only fires after the dispatcher assigned a plate, so
    // "Đã phân xe" is always satisfied here. The real gate for the driver
    // is the paper-order handoff from ops.
    return [
      { label: 'Đã phân xe', satisfied: true },
      {
        label: 'Đã đổi lệnh',
        satisfied: value.paperOrderReady,
        pending: value.paperOrderReady ? undefined : 'Vận hành chưa giao lệnh gốc',
      },
    ];
  }
  if (role === 'operations') {
    const value = item as OperationsWorkInboxItem;
    // Ops sees both branches because they hand off to the driver once both
    // branches are satisfied. Dispatch is the upstream branch; paper-order
    // is the branch they own.
    const dispatched = Boolean(value.driverName && value.truckPlate);
    const paperDone = value.paperOrderState === 'COMPLETED';
    return [
      {
        label: 'Đã phân xe',
        satisfied: dispatched,
        pending: dispatched ? undefined : 'Điều vận chưa gán biển số',
      },
      {
        label: 'Đã đổi lệnh',
        satisfied: paperDone,
        pending: paperDone ? undefined : 'Vận hành chưa bàn giao lệnh giấy',
      },
    ];
  }
  return [];
}

/** O2C milestone-gates cell for non-customer roles: the driver row only needs
 *  the branch that blocks *them*, ops sees both branches they hand off
 *  between, and customers get no cell at all — their gates never render, so
 *  the column would be permanently blank on the customer portal. */
export function RoleWorkInboxGateCell({ item, role }: { item: RoleItem; role: Role }) {
  if (role === 'customer') return null;
  return (
    <td data-label="Mốc nghiệp vụ">
      <ul className="role-work-inbox__gate" aria-label="Mốc nghiệp vụ O2C">
        {crossBranchGate(item, role).map((gate) => (
          <li key={gate.label} className={gate.satisfied ? 'is-ok' : 'is-pending'}>
            <span className="role-work-inbox__gate-label">{gate.label}</span>
            <span className="role-work-inbox__gate-mark" aria-hidden="true">{gate.satisfied ? '✓' : '…'}</span>
            {!gate.satisfied && gate.pending && <span className="role-work-inbox__gate-pending">{gate.pending}</span>}
          </li>
        ))}
      </ul>
    </td>
  );
}