// SIL-699 (id 819) — the CUS Tổng quan drawer's action footer.
//
// ONE primary action ("Sửa") + ONE explicit route to the container ledger.
// The list never navigates to /shipments-detail — the DRAWER is the lot's home
// (Spec I.4a) — so the ledger (scoped to this lot's customer + reference)
// stays reachable as a deliberate action from inside the drawer.

import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';

export interface CusLotDrawerFooterProps {
  /** The role may edit the lot (the /shipments/:id/edit guard). */
  canEdit: boolean;
  /** The lot is locked by accounting — the edit stays disabled, with the
   *  reason beside it (the card 20260923_1 law). */
  locked: boolean;
  onEdit: () => void;
  onOpenLedger: () => void;
}

export function CusLotDrawerFooter({ canEdit, locked, onEdit, onOpenLedger }: CusLotDrawerFooterProps) {
  return (
    <div className="cus-drawer-editbar">
      {locked && canEdit && <span className="cus-drawer-editbar__reason">Lô đã khóa kế toán — dữ liệu chỉ đọc.</span>}
      <UUIButton
        size="sm"
        color="tertiary"
        className="cus-drawer-ledger"
        onPress={onOpenLedger}
      >
        Mở bảng chi tiết container
      </UUIButton>
      {canEdit && (
        <UUIButton
          size="sm"
          color="primary"
          className="cus-drawer-edit"
          isDisabled={locked}
          onPress={onEdit}
        >
          Sửa
        </UUIButton>
      )}
    </div>
  );
}
