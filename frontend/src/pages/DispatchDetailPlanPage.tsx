import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/UI';
import { Pagination } from '../design-system';
import { DetailedPlanGrid } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
import { TripReassignDialog } from '../features/dispatch/detailed-plan/TripReassignDialog';
import { PairTripsDialog } from '../features/dispatch/detailed-plan/PairTripsDialog';
import { AssignTruckGroupDialog, lclGroupRowFromDetail } from '../features/dispatch/detailed-plan/AssignTruckGroupDialog';
import { selectPairCandidates } from '../features/dispatch/detailed-plan/pairCandidates';
import { useDispatchDetailPlan } from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import { unmergeLclGroup, type DispatchDetailPlanRow } from '../api/dispatchPlanningClient';
import { useToast } from '../components/shared/Toast';
import { billBookingReference } from '../lib/business-reference';
import { formatVolumeCbm, formatWeight } from '../lib/format';
import './DispatchPlanPage.css';

/**
 * Kế hoạch Chi tiết (/dispatch-detail) — step 2 of dispatch planning: the
 * container-level grid auto-split from the carrier allocations made on
 * /dispatch (Kế hoạch Tổng quát). The dispatcher filters/sorts by run hour and
 * drop-off point to bundle trips, then assigns license plates per container.
 */
export default function DispatchDetailPlanPage() {
  const detailPlan = useDispatchDetailPlan();
  const { toast } = useToast();
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
  const [selectedLclRows, setSelectedLclRows] = useState<DispatchDetailPlanRow[]>([]);
  const [truckGroupOpen, setTruckGroupOpen] = useState(false);
  // SPEC 18/10/2026 §4 — Tách nhóm: the COST group id awaiting confirmation.
  const [unmergeGroupId, setUnmergeGroupId] = useState<string | null>(null);
  const [unmergingGroup, setUnmergingGroup] = useState(false);
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

  return (
    <div className="dispatch-plan-page dispatch-plan-page--wide page-anim">
      <section className="dispatch-plan-page__workspace">
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
          onToggleLclSelection={toggleLclSelection}
          onUnmergeLclGroup={setUnmergeGroupId}
        />
        {selectedLclRows.length > 0 && (
          <div className="lcl-selection-bar" role="status">
            <span className="lcl-selection-bar__totals">
              Đang chọn {selectedLclRows.length} lô: Tổng {formatWeight(String(selectionTotals.weight))}
              {' | '}
              {formatVolumeCbm(String(selectionTotals.volume))}
            </span>
            <span className="lcl-selection-bar__first" title="Lô 1 giữ 100% cước trả ĐV">
              Lô 1: {billBookingReference(selectedLclRows[0]!.docs.billNumber)}
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
              onClick={() => {
                if (selectedLclRows.length < 2) return;
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
          initialVehicleClassId={groupDraft.vehicleClassId}
          initialCarrierKey={groupDraft.carrierKey}
          onDraftChange={handleGroupDraftChange}
          onClose={() => setTruckGroupOpen(false)}
          onAssigned={() => {
            setSelectedLclRows([]);
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
