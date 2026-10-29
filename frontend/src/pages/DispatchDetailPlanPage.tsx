import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/UI';
import { Pagination } from '../design-system';
import { DetailedPlanGrid } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
import { TripReassignDialog } from '../features/dispatch/detailed-plan/TripReassignDialog';
import { PairTripsDialog } from '../features/dispatch/detailed-plan/PairTripsDialog';
import { AssignTruckGroupDialog, lclGroupRowFromDetail } from '../features/dispatch/detailed-plan/AssignTruckGroupDialog';
import { LclGroupTruckEditDialog } from '../features/dispatch/detailed-plan/LclGroupTruckEditDialog';
import { selectPairCandidates } from '../features/dispatch/detailed-plan/pairCandidates';
import { useDispatchDetailPlan } from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import { unmergeLclGroup, unmergeLclLot, type DispatchDetailPlanRow } from '../api/dispatchPlanningClient';
import { deleteCusShipment } from '../api/shipmentClient';
import { ShipmentActionModal, type ShipmentActionController } from '../components/shipments/ShipmentActionModal';
import type { LclUnmergeLotRequest } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
import { useToast } from '../components/shared/Toast';
import { useAuth } from '../hooks/useAuth';
import { Role } from '@tingting/shared';
import { billBookingReference } from '../lib/business-reference';
import { formatVolumeCbm, formatWeight } from '../lib/format';
import './DispatchPlanPage.css';

/**
 * Kế hoạch Chi tiết (/dispatch-detail) — step 2 of dispatch planning: the
 * container-level grid auto-split from the carrier allocations made on
 * /dispatch (Kế hoạch Tổng quát). The dispatcher filters/sorts by run hour and
 * drop-off point to bundle trips, then assigns license plates per container.
 */
/** FB-095 — the SPEC §4 safety guard copy: a principal leaving hands Lô-1
 *  rights and 100% of the money to the next member; a non-principal leaving
 *  keeps the money where it is. */
function unmergeLotConfirmMessage(request: LclUnmergeLotRequest): string {
  const dissolve = request.memberCount === 2 ? ' Nhóm giải tán vì chỉ còn một lô.' : '';
  return request.order === 1
    ? `Hủy ghép nhóm ${request.memberCount ?? '?'} lô? Lô 2 sẽ thành Lô chính và nhận 100% tiền cước trả ĐV.${dissolve}`
    : `Hủy ghép lô này khỏi nhóm ${request.memberCount ?? '?'} lô? Lô 1 giữ nguyên 100% tiền cước trả ĐV; lô này trở về cước trả ĐV riêng.${dissolve}`;
}

/** Card 211026005623 (FB-095) — the delete confirm names the same promote law
 *  before the server moves the money: xóa Lô chính ⇒ quyền Lô chính + 100%
 *  cước trả ĐV sang lô kế tiếp (FB095-06 promote-on-delete); xóa thành viên
 *  ⇒ Lô 1 giữ cước, survivors renumber/dissolve (`promoteLclGroupsOnShipmentDelete`). */
function deleteLotLawNotice(row: DispatchDetailPlanRow): string | null {
  const group = row.cargoMode === 'LCL' ? row.lcl?.group : null;
  if (!group) return null;
  const dissolve = group.memberCount === 2 ? ' Nhóm giải tán vì chỉ còn một lô.' : '';
  return group.order === 1
    ? `Lô này là Lô chính của nhóm ${group.memberCount ?? '?'} lô ghép trả ĐV — xóa lô sẽ chuyển 100% cước trả ĐV cho lô kế tiếp.${dissolve}`
    : `Lô này là thành viên nhóm ${group.memberCount ?? '?'} lô ghép trả ĐV — Lô 1 giữ nguyên 100% cước; các thành viên còn lại được đánh số lại.${dissolve}`;
}

export default function DispatchDetailPlanPage() {
  const detailPlan = useDispatchDetailPlan();
  const { toast } = useToast();
  // Card 211026005623 (FB-095) — the Điều vận surface's "Xóa lô": same delete
  // flow as the /shipments drawer + lot detail (confirm + lý do →
  // deleteCusShipment). Role law stays CUS/ADMIN (`requestShipmentDelete`
  // 403s everyone else — cards 351/352 + 20261007_396), so DISPATCHER /
  // MANAGER get no delete execution here either; the guard is not loosened.
  // Per card 20260923_1 the affordance stays reachable and answers with the
  // guard's own reason instead of vanishing (same law as the drawer's Xóa lô).
  const { user } = useAuth();
  const canDeleteLot = user?.role === Role.CUS || user?.role === Role.ADMIN;
  const [deleteRow, setDeleteRow] = useState<DispatchDetailPlanRow | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [lotDeleteBlock, setLotDeleteBlock] = useState<string | null>(null);
  const [reassignTripId, setReassignTripId] = useState<number | null>(null);
  // Ghép chuyến (LoHangKepKetHop §3.1): the row whose trip anchors the pair;
  // null keeps the dialog closed. Candidates are the loaded unpaired OWN
  // rows with trips — the same set the grid offers the button for.
  const [pairRow, setPairRow] = useState<DispatchDetailPlanRow | null>(null);
  const pairCandidates = useMemo(
    () => selectPairCandidates(detailPlan.items, pairRow),
    [detailPlan.items, pairRow],
  );
  // Staff close for external-carrier trips: external drivers don't use the
  // app, so dispatch/CUS confirm the completion from the grid row.
  const [completingRow, setCompletingRow] = useState<DispatchDetailPlanRow | null>(null);
  const [completing, setCompleting] = useState(false);

  // FB-092 LCL grouping: the dispatcher's selected lots in click order —
  // index 0 becomes Lô 1 (100% cước trả ĐV). Only ungrouped LCL rows join a
  // new group; rows already in one are refused until un-merged (FB-095).
  // Spec 23/10 (261023110000 §2): the selection is ON-DEMAND — `lclMergeMode`
  // gates the grid's CHỌN column; exiting the mode (or finishing a group)
  // drops the selection and hides the column again.
  const [selectedLclRows, setSelectedLclRows] = useState<DispatchDetailPlanRow[]>([]);
  const [lclMergeMode, setLclMergeMode] = useState(false);
  const [truckGroupOpen, setTruckGroupOpen] = useState(false);
  const truckGroupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exitLclMergeMode = () => {
    setLclMergeMode(false);
    setSelectedLclRows([]);
  };
  // SIL-590 (id 690) — the row ⋯ menu's "Gộp hàng": the customer looks for
  // the merge verb ON THE ROW. It enters the on-demand merge mode with that
  // lot pre-picked (index 0 — the Lô 1 candidate), so the whole flow — CHỌN
  // checkboxes → chọn thêm lô → Gán xe nhóm — runs right here on Kế hoạch
  // Chi tiết. Nothing navigates to Kế hoạch Tổng quát (the old build's
  // defect); the page passes the handler only while the mode is OFF.
  const startLclMergeFromRow = (row: DispatchDetailPlanRow) => {
    setSelectedLclRows([row]);
    setLclMergeMode(true);
  };
  // SPEC 18/10/2026 §4 — Tách nhóm: the COST group id awaiting confirmation.
  const [unmergeGroupId, setUnmergeGroupId] = useState<string | null>(null);
  const [unmergingGroup, setUnmergingGroup] = useState(false);
  // FB-095 (card 181026145610) — Hủy ghép for ONE lot leaving its group; the
  // guard copy names the SPEC §4 promotion before the server moves the money.
  const [unmergeLot, setUnmergeLot] = useState<LclUnmergeLotRequest | null>(null);
  const [unmergingLot, setUnmergingLot] = useState(false);
  // Card 191026100010 (DV-B1-03/04) — "Đổi BKS nhóm": page sở hữu dialog +
  // refetch (cùng luật wiring của Hủy ghép / Gán xe nhóm); hai affordance
  // (menu nhóm trên grid + dòng nhóm trong popup điều phối) cùng raise dòng.
  const [groupTruckRow, setGroupTruckRow] = useState<DispatchDetailPlanRow | null>(null);
  // Card _171026133000: the group popup unmounts on close, so its loại xe /
  // nhà xe picks are held here and survive a "Hủy" + reopen inside one
  // selection session. Cleared with the selection itself, below.
  const [groupDraft, setGroupDraft] = useState<{ vehicleClassId: string; carrierKey: string }>({
    vehicleClassId: '',
    carrierKey: '',
  });

  useEffect(() => {
    if (selectedLclRows.length > 0) return;
    setGroupDraft((current) => (
      current.vehicleClassId || current.carrierKey
        ? { vehicleClassId: '', carrierKey: '' }
        : current
    ));
  }, [selectedLclRows.length]);

  function handleGroupDraftChange(draft: { vehicleClassId: string; carrierKey: string }) {
    setGroupDraft((current) => (
      current.vehicleClassId === draft.vehicleClassId && current.carrierKey === draft.carrierKey
        ? current
        : draft
    ));
  }
  const selectedIds = useMemo(
    () => new Set(selectedLclRows.map((row) => row.shipmentId)),
    [selectedLclRows],
  );
  const selectionTotals = useMemo(() => {
    let weight = 0;
    let volume = 0;
    for (const row of selectedLclRows) {
      const kg = Number(row.container.cargoWeightKg);
      if (Number.isFinite(kg)) weight += kg;
      const cbm = Number(row.lcl?.cargoVolumeCbm);
      if (Number.isFinite(cbm)) volume += cbm;
    }
    return { weight, volume };
  }, [selectedLclRows]);

  function toggleLclSelection(shipmentId: number, next: boolean) {
    setSelectedLclRows((current) => {
      if (!next) return current.filter((row) => row.shipmentId !== shipmentId);
      const row = detailPlan.items.find((item) => item.shipmentId === shipmentId);
      return row ? [...current, row] : current;
    });
  }

  async function confirmCompleteExternalTrip() {
    if (!completingRow) return;
    setCompleting(true);
    try {
      await detailPlan.completeExternalTrip(completingRow);
      setCompletingRow(null);
    } catch {
      // assignmentError banner already surfaced the failure; keep the dialog
      // open only until the next render — the row flips or the error shows.
      setCompletingRow(null);
    } finally {
      setCompleting(false);
    }
  }

  async function confirmUnmergeGroup() {
    if (unmergeGroupId == null) return;
    setUnmergingGroup(true);
    try {
      const result = await unmergeLclGroup({ groupId: unmergeGroupId, dimension: 'COST' });
      toast({
        kind: 'success',
        message: `Đã tách nhóm ${result.memberCount} lô — mỗi lô trở về cước trả ĐV độc lập`,
      });
      setUnmergeGroupId(null);
      void detailPlan.refresh();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Tách nhóm thất bại' });
    } finally {
      setUnmergingGroup(false);
    }
  }

  async function confirmUnmergeLot() {
    if (!unmergeLot) return;
    setUnmergingLot(true);
    try {
      const result = await unmergeLclLot({ shipmentId: unmergeLot.shipmentId, dimension: 'COST' });
      toast({
        kind: 'success',
        message: result.promoted
          ? `Đã hủy ghép — Bill ${result.promoted.reference} nhận 100% cước trả ĐV${result.dissolved ? ' — nhóm giải tán' : ''}`
          : result.dissolved
            ? 'Đã hủy ghép — nhóm giải tán'
            : `Đã hủy ghép — lô rời nhóm, còn ${result.remaining.length} lô trong nhóm`,
      });
      setUnmergeLot(null);
      void detailPlan.refresh();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Hủy ghép thất bại' });
    } finally {
      setUnmergingLot(false);
    }
  }

  // Card 211026005623 — the row action routes: authorized roles open the
  // delete confirm; everyone else gets the guard's own law text inline
  // (verbatim the `requestShipmentDelete` refusal) — the button never
  // vanishes, it answers (card 20260923_1).
  function requestDeleteLot(row: DispatchDetailPlanRow) {
    if (!canDeleteLot) {
      setLotDeleteBlock('Chỉ CUS hoặc Quản trị viên mới được yêu cầu xóa lô hàng.');
      return;
    }
    setLotDeleteBlock(null);
    setDeleteRow(row);
  }

  // Card 211026005623 — delete flow: version-gated soft-delete (the same
  // DELETE /api/shipments/cus-workspace/:id the CUS surfaces call). The
  // FB-095 group guards (settled-group 409, promote-on-delete) run
  // server-side; a refusal surfaces its verbatim reason and keeps the dialog
  // open (card 20260923_1 law — answer with a reason, never vanish).
  async function submitDeleteLot() {
    if (!deleteRow || !deleteReason.trim()) return;
    setDeleteSubmitting(true);
    try {
      await deleteCusShipment(deleteRow.shipmentId, deleteRow.shipmentVersion, deleteReason.trim());
      toast({ kind: 'success', message: `Đã xóa lô ${billBookingReference(deleteRow.docs.billNumber)}` });
      setDeleteRow(null);
      setDeleteReason('');
      void detailPlan.refresh();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Xóa lô thất bại' });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const deleteActions: ShipmentActionController = {
    actionItem: deleteRow ? { id: deleteRow.shipmentId } : null,
    actionMode: 'delete',
    reason: deleteReason,
    setReason: setDeleteReason,
    submitting: deleteSubmitting,
    closeAction: () => {
      if (deleteSubmitting) return;
      setDeleteRow(null);
      setDeleteReason('');
    },
    submitAction: submitDeleteLot,
  };

  return (
    <div className="dispatch-plan-page dispatch-plan-page--wide page-anim">
      <section className="dispatch-plan-page__workspace">
        {lotDeleteBlock && (
          <div className="dispatch-plan-page__error" role="alert">{lotDeleteBlock}</div>
        )}
        <DetailedPlanGrid
          filters={detailPlan.filters}
          onFilterChange={detailPlan.updateFilters}
          loadDeliveryPointFacets={detailPlan.loadDeliveryPointFacets}
          loadPickupPortFacets={detailPlan.loadPickupPortFacets}
          loadDropoffPortFacets={detailPlan.loadDropoffPortFacets}
          items={detailPlan.items}
          loading={detailPlan.loading}
          error={detailPlan.error}
          onRetry={detailPlan.refresh}
          assignmentError={detailPlan.assignmentError}
          lotBanner={detailPlan.lotBanner}
          onClearLotBanner={detailPlan.clearLotBanner}
          presence={detailPlan.presence}
          zones={detailPlan.zones}
          assignmentCounts={detailPlan.assignmentStatusCounts}
          sortKey={detailPlan.sortKey}
          sortDirection={detailPlan.sortDirection}
          onToggleSort={detailPlan.toggleSort}
          onAtomicSave={detailPlan.savePlan}
          onOpenTripReassign={setReassignTripId}
          onCompleteExternalTrip={setCompletingRow}
          onIssueOrder={detailPlan.issueOrder}
          onOpenPair={(row) => {
            setPairRow(row);
            // Card 353: a stale grid window (rows fetched before a just-issued
            // sibling got its tripId) left "Lệnh ghép cùng" empty. Refresh on
            // open so the candidates always reflect the issued pairs.
            void detailPlan.refresh();
          }}
          onEnsureFulfillment={detailPlan.ensureFulfillment}
          autoOpenFulfillmentId={detailPlan.autoOpenFulfillmentId}
          onAutoOpenConsumed={detailPlan.consumeAutoOpen}
          selectedLclShipmentIds={selectedIds}
          onToggleLclSelection={lclMergeMode ? toggleLclSelection : undefined}
          lclMergeMode={lclMergeMode}
          onToggleLclMergeMode={() => {
            // Spec 23/10 §2 — the toggle both exits and enters: leaving the
            // mode clears every pick so a reopened mode never shows a stale
            // floating bar.
            if (lclMergeMode) exitLclMergeMode();
            else setLclMergeMode(true);
          }}
          // SIL-590 (id 690) — the row menu's "Gộp hàng" owns the OFF state:
          // it turns the mode on with the row pre-picked; while ON, the CHỌN
          // checkboxes own the flow and the menu entry disappears.
          onStartLclMerge={lclMergeMode ? undefined : startLclMergeFromRow}
          onUnmergeLclGroup={setUnmergeGroupId}
          onUnmergeLclLot={setUnmergeLot}
          onLclTruckUpdated={() => { void detailPlan.refresh(); }}
          onChangeGroupTruck={setGroupTruckRow}
          onDeleteLot={requestDeleteLot}
          onRowsChanged={() => { void detailPlan.refresh(); }}
        />
        {selectedLclRows.length > 0 && (
          <div className="lcl-selection-bar" role="status">
            <span className="lcl-selection-bar__totals">
              Đang chọn {selectedLclRows.length} lô: Tổng {formatWeight(String(selectionTotals.weight))}
              {' | '}
              {formatVolumeCbm(String(selectionTotals.volume))}
            </span>
            <span className="lcl-selection-bar__first" title="Lô 1 giữ 100% cước trả ĐV">
              — Lô 1 giữ 100% cước trả ĐV: {billBookingReference(selectedLclRows[0]!.docs.billNumber)}
            </span>
            <button
              type="button"
              className="lcl-selection-bar__clear"
              onClick={() => setSelectedLclRows([])}
            >
              Bỏ chọn
            </button>
            {/* Card 171026154000 (C): the reason rides the aria-described +
                aria-disabled pattern (DisabledActionTip's contract) with the
                description as REAL text beside the action — the owner asked
                for chữ, not another tooltip bubble. The handler guards the
                same condition the text names; the button never goes natively
                `disabled` (unfocusable = unreachable explanation). */}
            <button
              type="button"
              className="lcl-selection-bar__assign"
              aria-disabled={selectedLclRows.length < 2 || undefined}
              aria-describedby={selectedLclRows.length < 2 ? 'lcl-group-assign-reason' : undefined}
              title="Gán xe nhóm trả ĐV"
              onClick={(event) => {
                if (selectedLclRows.length < 2) return;
                truckGroupTriggerRef.current = event.currentTarget;
                setTruckGroupOpen(true);
              }}
            >
              Gán xe nhóm
            </button>
            {selectedLclRows.length < 2 && (
              <span id="lcl-group-assign-reason" className="lcl-selection-bar__hint">
                Nhóm ghép cần ít nhất 2 lô — chọn thêm lô hàng lẻ.
              </span>
            )}
          </div>
        )}
        {detailPlan.total > detailPlan.pageSize && (
          <Pagination
            page={detailPlan.page}
            totalPages={detailPlan.totalPages}
            totalItems={detailPlan.total}
            pageSize={detailPlan.pageSize}
            onChange={detailPlan.setPage}
          />
        )}
      </section>

      <TripReassignDialog
        tripId={reassignTripId}
        onClose={() => setReassignTripId(null)}
        onReassigned={detailPlan.refresh}
      />

      <PairTripsDialog
        row={pairRow}
        candidates={pairCandidates}
        onClose={() => setPairRow(null)}
        onPaired={detailPlan.refresh}
      />

      {truckGroupOpen && selectedLclRows.length > 0 && (
        <AssignTruckGroupDialog
          rows={selectedLclRows.map(lclGroupRowFromDetail)}
          openerRef={truckGroupTriggerRef}
          initialVehicleClassId={groupDraft.vehicleClassId}
          initialCarrierKey={groupDraft.carrierKey}
          onDraftChange={handleGroupDraftChange}
          onClose={() => setTruckGroupOpen(false)}
          onAssigned={() => {
            // Spec 23/10 §2 — completing the group exits the mode: the CHỌN
            // column hides itself and the floating bar closes with it.
            exitLclMergeMode();
            void detailPlan.refresh();
          }}
        />
      )}

      {/* Card 191026100010 (DV-B1-03/04) — "Đổi BKS nhóm": updateLclTruck
          (FB-093) lan BKS thực cả nhóm + BKS ảo lô nêu tên; refetch mang về
          grid BKS mới trên mọi thành viên. */}
      {groupTruckRow && (
        <LclGroupTruckEditDialog
          row={groupTruckRow}
          onClose={() => setGroupTruckRow(null)}
          onSaved={() => {
            void detailPlan.refresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={unmergeGroupId != null}
        message="Tách nhóm ghép trả ĐV? Mỗi lô trở về cước trả ĐV độc lập — tiền cước 100% của Lô 1 vẫn giữ nguyên trên Lô 1, các lô còn lại chờ định giá lại khi ghép nhóm mới."
        confirmLabel={unmergingGroup ? 'Đang tách…' : 'Tách nhóm'}
        onConfirm={() => void confirmUnmergeGroup()}
        onCancel={() => { if (!unmergingGroup) setUnmergeGroupId(null); }}
      />

      {/* FB-095 — one lot leaves its group; the guard names the promotion
          before the server transfers the money (SPEC §4). */}
      <ConfirmDialog
        isOpen={unmergeLot != null}
        message={unmergeLot ? unmergeLotConfirmMessage(unmergeLot) : ''}
        confirmLabel={unmergingLot ? 'Đang hủy…' : 'Hủy ghép'}
        onConfirm={() => void confirmUnmergeLot()}
        onCancel={() => { if (!unmergingLot) setUnmergeLot(null); }}
      />

      {/* Card 211026005623 — the lot-delete confirm (shared CUS/Điều vận
          dialog): required lý do + the FB-095 promote-law notice when the row
          belongs to a COST group. */}
      <ShipmentActionModal
        actions={deleteActions}
        notice={deleteRow ? deleteLotLawNotice(deleteRow) : null}
      />

      <ConfirmDialog
        isOpen={completingRow != null}
        message={`Hoàn thành chuyến với xe ngoài ${
          completingRow?.container.containerNumber?.trim()
            || billBookingReference(completingRow?.docs.billNumber)
        }? Xe ngoài không dùng app nên điều vận/CUS chốt chuyến thay tài xế.`}
        confirmLabel={completing ? 'Đang hoàn thành…' : 'Hoàn thành chuyến'}
        onConfirm={() => void confirmCompleteExternalTrip()}
        onCancel={() => { if (!completing) setCompletingRow(null); }}
      />
    </div>
  );
}
