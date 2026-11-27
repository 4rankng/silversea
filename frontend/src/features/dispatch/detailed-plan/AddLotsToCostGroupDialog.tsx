// CR-011.2 Q8 — "Thêm lô vào nhóm": joins eligible LCL lots into an EXISTING
// cost group (POST /shipments/lcl/cost-group/update { addShipmentIds }). The
// BE re-runs the THÊM gates per newcomer (live LCL lot, not already grouped
// in COST) over the full new member set and lands the
// Lô-chính-100%/members-0₫ law on them: each joined lot's cước trả goes 0₫
// while Lô 1 keeps the group price. Removal still rides Tách nhóm
// (unmerge) — this dialog only ever ADDS.
import { useState } from 'react';
import { Modal, Btn } from '../../../components/UI';
import { updateLclCostGroup, type DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { useToast } from '../../../components/shared/Toast';
import { billBookingReference } from '../../../lib/business-reference';

export function AddLotsToCostGroupDialog({ groupRow, candidates, onClose, onAdded }: {
  /** A row of the group receiving members (the menu raises it). */
  groupRow: DispatchDetailPlanRow;
  /** The plan board's rows — the dialog filters the eligible ones itself. */
  candidates: DispatchDetailPlanRow[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const groupId = groupRow.lcl?.group?.groupId ?? null;
  const eligible = candidates.filter((candidate) => (
    candidate.cargoMode === 'LCL'
    && candidate.lcl?.group == null
    && candidate.shipmentId !== groupRow.shipmentId
  ));
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  if (groupId == null) return null;

  const toggle = (shipmentId: number, next: boolean) => {
    setPicked((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(shipmentId);
      else copy.delete(shipmentId);
      return copy;
    });
  };

  const submit = async () => {
    if (picked.size === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateLclCostGroup({ groupId, addShipmentIds: [...picked] });
      toast({ kind: 'success', message: `Đã thêm ${picked.size} lô vào nhóm — cước trả của lô mới về 0₫, Lô 1 giữ 100%.` });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm lô vào nhóm thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Thêm lô vào nhóm ghép trả ĐV">
      <div style={{ display: 'grid', gap: 12 }}>
        {eligible.length === 0 ? (
          <p style={{ margin: 0 }}>Không có lô hàng lẻ nào chưa ghép nhóm trên kế hoạch này.</p>
        ) : (
          <div role="group" aria-label="Chọn lô cần thêm" style={{ display: 'grid', gap: 6 }}>
            {eligible.map((candidate) => (
              <label key={candidate.shipmentId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={picked.has(candidate.shipmentId)}
                  onChange={(event) => toggle(candidate.shipmentId, event.target.checked)}
                  disabled={saving}
                  aria-label={`Thêm lô ${billBookingReference(candidate.docs.billNumber)}`}
                />
                <span>{billBookingReference(candidate.docs.billNumber)} · {candidate.customerRoute.customerName ?? ''}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>Hủy</Btn>
          <Btn variant="primary" size="sm" onClick={() => void submit()} disabled={saving || picked.size === 0}>
            {saving ? 'Đang thêm…' : `Thêm ${picked.size} lô`}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
