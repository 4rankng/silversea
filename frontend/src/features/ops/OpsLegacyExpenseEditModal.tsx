import { useState } from 'react';
import { tripClient } from '../../api/tripClient';
import type { OpsExpenseRow } from '../../api/opsClient';
import { Btn } from '../../components/UI';
import { useToast } from '../../components/shared/Toast';
import { Modal, NumberField } from '../../design-system';
import { useInvalidateOps } from '../../hooks/useOpsQueries';
import { opsBillReference } from './opsStatus';

/**
 * Sửa a TRIP-sourced (khai chi hộ) row straight from the wallet — card
 * 071026141580. The writable surface matches the trip cost card exactly
 * (Số tiền trả = buyAmount, Số tiền thu = sellAmount) and routes through the
 * same API (PUT /trips/:id/expenses/:eid — the accounting entry API is
 * finance-gated and 403s for the Ops author of the row).
 */
export function OpsLegacyExpenseEditModal({ entry, onClose }: { entry: OpsExpenseRow; onClose: () => void }) {
  // NumberField emits `number | ''` — empty means "leave unchanged".
  const [tra, setTra] = useState<number | ''>(Number(entry.amount));
  const [thu, setThu] = useState<number | ''>(entry.customerChargeAmount ?? '');
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateOps();
  const { toast } = useToast();

  const dirty = tra !== Number(entry.amount) || thu !== (entry.customerChargeAmount ?? '');

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await tripClient.updateTripExpense(entry.tripId ?? 0, entry.sourceId ?? 0, {
        ...(typeof tra === 'number' && tra !== Number(entry.amount) ? { buyAmount: tra } : {}),
        ...(typeof thu === 'number' && thu !== entry.customerChargeAmount ? { sellAmount: thu } : {}),
      });
      invalidate();
      toast({ kind: 'success', message: 'Đã cập nhật khoản chi.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không lưu được thay đổi.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      title={`Sửa khoản chi hộ ${opsBillReference(entry.billRef)}`}
      ariaLabel="Sửa khoản chi hộ"
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Hủy</Btn>
          <Btn onClick={() => void save()} disabled={saving || !dirty}>Lưu</Btn>
        </>
      )}
    >
      <NumberField
        aria-label="Số tiền trả"
        suffix="₫"
        grouped
        value={tra}
        onChange={setTra}
      />
      <NumberField
        aria-label="Số tiền thu"
        suffix="₫"
        grouped
        value={thu}
        onChange={setThu}
      />
    </Modal>
  );
}
