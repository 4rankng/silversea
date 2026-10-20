// Card 211026024348 (FB-093 follow-up) — the settlement boards' "Tách nhóm"
// affordance for a lot inside a merged rev group (Ghép cước thu khách). QA:
// after the merge (Lô 1 = 100% CƯỚC VẬN TẢI AUTO, Lô 2..N = 0₫ + "Ghép xe
// cùng Bill [Lô 1]") there was NO path to split the group again.
//
// ONE action for every surface that shows a merged group (CUS Chi phí -
// Quyết toán + Kế toán /accounting/chot-debit): a real <button> named after
// its lot, gated by DisabledActionTip (aria-disabled, NEVER the `disabled`
// attribute — the FB-093b pattern), confirming on the SHARED ConfirmDialog
// and calling the EXISTING `POST /shipments/lcl/unmerge-group`
// (`unmergeLclGroup`) — never a second unmerge path. The server puts every
// lot's cước thu back to its pre-merge state and sheds the merge note
// (restoreRevPreMergeMoney); the audit ride is SHIPMENT_LCL_GROUP_UNMERGED.
//
// UI provenance: house primitive — the same native <button> + shared
// ConfirmDialog + DisabledActionTip trio the dispatch board's "Tách nhóm"
// (DetailedPlanGrid__lcl-unmerge) and the strip's "Hủy ghép" already run;
// no catalog layout is involved.
import { useState } from 'react';
import { ConfirmDialog } from '../../../components/UI';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { useToast } from '../../../components/shared/Toast';
import { unmergeLclGroup } from '../../../api/dispatchPlanningClient';
import './UnmergeRevGroupAction.css';

export interface UnmergeRevGroupActionProps {
  /** Stable id prefix for the DisabledActionTip description (page-scoped). */
  id: string;
  /** The merged rev group the lot belongs to. */
  groupId: string;
  /** Số Bill / Số Booking of the lot row the action sits on (aria copy). */
  lotRef: string;
  /** Why the action is unavailable (a settled/locked group) — null = armed. */
  disabledReason: string | null;
  /** Called after a successful tách — the caller refetches its board. */
  onUnmerged: () => void;
}

export function UnmergeRevGroupAction({ id, groupId, lotRef, disabledReason, onUnmerged }: UnmergeRevGroupActionProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doUnmerge() {
    setBusy(true);
    try {
      await unmergeLclGroup({ groupId, dimension: 'REV' });
      toast({
        kind: 'success',
        message: 'Đã tách nhóm — tiền cước của mỗi lô trở về đúng trạng thái trước ghép, ghi chú ghép đã được gỡ.',
      });
      setConfirmOpen(false);
      onUnmerged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Tách nhóm thất bại' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DisabledActionTip id={id} reason={disabledReason}>
        <button
          type="button"
          className="tach-nhom-action"
          aria-label={`Tách nhóm ghép cước thu khách — lô ${lotRef}`}
          aria-disabled={disabledReason != null || undefined}
          onClick={() => {
            // aria-disabled does not block clicks the way `disabled` did —
            // the handler guards (DisabledActionTip contract).
            if (disabledReason != null) return;
            setConfirmOpen(true);
          }}
        >
          Tách nhóm
        </button>
      </DisabledActionTip>
      <ConfirmDialog
        isOpen={confirmOpen}
        message={'Tách nhóm ghép cước thu khách? Tiền cước của mỗi lô trở về đúng trạng thái trước ghép,'
          + ' ghi chú "Ghép cước cùng Bill" được gỡ.'}
        confirmLabel={busy ? 'Đang tách…' : 'Tách nhóm'}
        onConfirm={() => void doUnmerge()}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}
