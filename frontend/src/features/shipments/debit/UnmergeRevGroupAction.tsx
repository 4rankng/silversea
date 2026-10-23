// Card 211026024348 (FB-093 follow-up) — the settlement boards' "Tách nhóm"
// affordance for a lot inside a merged rev group (Ghép cước thu khách). QA:
// after the merge (per boss 21/10 — mỗi lô tự tính đơn giá Tuyến×KH × loại xe
// của chính nó, độc lập) there was NO path to split the group again.
//
// ONE action for every surface that shows a merged group (CUS Chi phí -
// Quyết toán + Kế toán /accounting/chot-debit): a real <button> named after
// its lot, gated by DisabledActionTip (aria-disabled, NEVER the `disabled`
// attribute — the FB-093b pattern), confirming on the SHARED ConfirmDialog
// and calling the EXISTING `POST /shipments/lcl/unmerge-group`
// (`unmergeLclGroup`) — never a second unmerge path.
//
// FB-145 (card 231026163927, QA R39 + design direction 24/10 owner-approved):
// the unmerge reverts every lot to its pre-merge price (a never-priced lot
// reads "Chưa xác định" again — BE read rule) and clears the group's loại xe.
// The success toast carries a [Hoàn tác] action for ~6.5s: it re-merges the
// SAME members in the SAME order with the SAME class (the response hands
// back vehicleClassId + ordered members), then the caller refreshes again.
// No toolbar undo button (owner ruling 24/10) — the toast IS the undo
// surface, and it dies with the toast.
//
// UI provenance: house primitive — the same native <button> + shared
// ConfirmDialog + DisabledActionTip trio the dispatch board's "Tách nhóm"
// (DetailedPlanGrid__lcl-unmerge) and the strip's "Hủy ghép" already run;
// no catalog layout is involved.
import { useState } from 'react';
import { ConfirmDialog } from '../../../components/UI';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { useToast } from '../../../components/shared/Toast';
import { mergeLclRevGroup, unmergeLclGroup } from '../../../api/dispatchPlanningClient';
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
  /** Called after a successful tách (and after a successful Hoàn tác) — the
   *  caller invalidates its money queries and refetches the board. */
  onUnmerged: () => void;
}

/** The [Hoàn tác] window (design direction: 5–8s) — long enough to read the
 *  toast and click, short enough that a stale undo cannot resurrect a group
 *  the operator has since re-arranged. */
const UNDO_TOAST_MS = 6500;

export function UnmergeRevGroupAction({ id, groupId, lotRef, disabledReason, onUnmerged }: UnmergeRevGroupActionProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doUnmerge() {
    setBusy(true);
    try {
      const result = await unmergeLclGroup({ groupId, dimension: 'REV' });
      setConfirmOpen(false);
      // Refresh FIRST (the board must never keep painting the stale group /
      // stale 0₫), then offer the undo on top of the refreshed state.
      onUnmerged();
      // A legacy class-less group cannot be auto-re-merged (the merge command
      // requires its loại xe) — its toast stays informational.
      toast(result.vehicleClassId != null
        ? {
            kind: 'success',
            message: 'Đã tách nhóm cước thành công',
            duration: UNDO_TOAST_MS,
            action: {
              label: 'Hoàn tác',
              onPress: () => {
                void (async () => {
                  try {
                    await mergeLclRevGroup({
                      // Members come back in their stored order — Lô 1 first —
                      // with the group's own loại xe (FB-145 response contract).
                      shipmentIds: [...result.members].sort((a, b) => a.order - b.order).map((m) => m.shipmentId),
                      vehicleSizeClassId: result.vehicleClassId!,
                    });
                    toast({ kind: 'success', message: 'Đã gộp lại nhóm cước thu khách' });
                    onUnmerged();
                  } catch (err) {
                    toast({ kind: 'error', message: err instanceof Error ? err.message : 'Hoàn tác thất bại' });
                  }
                })();
              },
            },
          }
        : { kind: 'success', message: 'Đã tách nhóm cước thành công' });
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
        message={'Tách nhóm ghép cước thu khách? Cả nhóm giải tán: cước thu của từng lô trở về giá trước khi ghép'
          + ' (lô chưa từng có giá hiện "Chưa xác định"), loại xe nhóm được gỡ khỏi các lô.'}
        confirmLabel={busy ? 'Đang tách…' : 'Tách nhóm'}
        onConfirm={() => void doUnmerge()}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}
