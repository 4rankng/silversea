// SIL-699 (id 819) — the CUS Tổng quan drawer's action footer.
//
// ONE explicit route to the container ledger + the lot-expense entry (SIL-748).
// The list never navigates to /shipments-detail — the DRAWER is the lot's home
// (Spec I.4a) — so the ledger (scoped to this lot's customer + reference)
// stays reachable as a deliberate action from inside the drawer.
//
// SIL-1150 (KB §3.1.7): editing no longer leaves the drawer — the body IS the
// shared lot form (edit context), so the old "Sửa" route to
// /shipments/:id/edit is retired with its lock/disable cluster (the form's
// own lock law owns that feedback now).

import { Plus } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';

export interface CusLotDrawerFooterProps {
  onOpenLedger: () => void;
  /** Ops lot expense declaration entry (SIL-748). */
  onDeclareExpense?: () => void;
}

export function CusLotDrawerFooter({ onOpenLedger, onDeclareExpense }: CusLotDrawerFooterProps) {
  return (
    <div className="cus-drawer-editbar">
      <UUIButton
        size="sm"
        color="tertiary"
        className="cus-drawer-ledger"
        onPress={onOpenLedger}
      >
        Mở bảng chi tiết container
      </UUIButton>
      {onDeclareExpense && (
        <UUIButton
          size="sm"
          color="secondary"
          className="cus-drawer-declare-expense"
          iconLeading={<Plus size={16} aria-hidden="true" />}
          onPress={onDeclareExpense}
        >
          Khai chi phí
        </UUIButton>
      )}
    </div>
  );
}
