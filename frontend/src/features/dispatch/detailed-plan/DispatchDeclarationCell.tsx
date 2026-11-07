import { useAuth } from '../../../hooks/useAuth';
import { Role } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DeclarationInlineCell } from '../../shipments/detail/DeclarationInlineCell';

/**
 * SIL-591/593 — the SỐ TỜ KHAI cell of the detailed-plan grid, on the
 * SIL-521 per-container model:
 *
 * - FCL row: the container's OWN number (`shipment_containers.declaration_
 *   number` — the value the per-cont command writes, so the cell shows what
 *   the edit persists, never a stale lot-level projection). Click-to-edit
 *   inline (owner ruling: the cell click IS the edit affordance — no extra
 *   Sửa button, card 20261006_537) for CUS/Quản trị/Quản lý/Điều vận — the
 *   SIL-551 (id 624) writer law for the container-line command (supersedes
 *   the role sentence of card 261013200312 per-cont; the LOT-level
 *   declarationNumber law is untouched); ACCOUNTANT and the rest get static
 *   text with no edit affordance (the server would 403).
 * - LCL row: no container — the lot's declaration list reads out as text.
 *   Lot-level editing keeps its existing homes (CusLotView / ledger /
 *   quick-edit modal); this surface stays read-only there.
 *
 * SIL-720 (id 840): the inline cell itself is the SHARED
 * `DeclarationInlineCell` — the CUS lot page `/shipments/:id` edits the same
 * per-container declaration inline (one pattern, one shared implementation).
 * This module keeps the grid's own skin (its CSS classes) and the row-shape
 * rules (FCL container row vs. LCL lot row).
 */
export function DispatchDeclarationCell({ row, onSaved }: {
  row: DispatchDetailPlanRow;
  /** Called after a successful save — the page refetches the rows. */
  onSaved?: () => void;
}) {
  const user = useAuth()?.user;
  // SIL-551 (id 624) — per-cont tờ khai writes: CUS/Quản trị/Quản lý/Điều
  // vận (the container-line writer law; lot-level stays FB-005).
  const canEdit = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER)
    && row.shipmentContainerId != null;

  // LCL rows (and any row without a container line) read the lot's list.
  if (row.cargoMode !== 'FCL') {
    const lotNumbers = (row.docs.declarationNumbers ?? []).filter((value) => value.trim());
    return (
      <div className="detailed-plan-grid__cell-body">
        <div
          className={lotNumbers.length === 0 ? 'detailed-plan-grid__line detailed-plan-grid__line--missing' : 'detailed-plan-grid__line'}
          title={lotNumbers.join(', ') || undefined}
        >
          {lotNumbers.length > 0 ? lotNumbers.join(', ') : 'Chưa có tờ khai'}
        </div>
      </div>
    );
  }

  return (
    <DeclarationInlineCell
      shipmentId={row.shipmentId}
      containerId={row.shipmentContainerId as number}
      expectedShipmentVersion={row.shipmentVersion}
      value={row.container.declarationNumber ?? ''}
      canEdit={canEdit}
      onSaved={onSaved}
      ariaLabel={`Sửa số tờ khai · ${row.container.containerNumber?.trim() || 'lô hàng lẻ'}`}
      classNames={{
        body: 'detailed-plan-grid__cell-body',
        value: 'detailed-plan-grid__line detailed-plan-grid__decl-value',
        missing: 'detailed-plan-grid__line detailed-plan-grid__line--missing',
        trigger: 'detailed-plan-grid__decl-value--action',
        editor: 'detailed-plan-grid__cell-body detailed-plan-grid__decl-editor',
        input: 'detailed-plan-grid__decl-input',
        hint: 'detailed-plan-grid__decl-hint',
      }}
    />
  );
}
