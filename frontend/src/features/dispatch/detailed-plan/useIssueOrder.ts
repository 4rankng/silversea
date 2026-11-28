import { useEffect, useRef, useState } from 'react';
import {
  listDispatchFleetResources,
  type DispatchDetailPlanRow,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';
import { useConfirm } from '../../../components/UI';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { detectIssueSoftConfirm, type SoftIssueConfirmFlag } from './dispatchSoftConfirm';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Internal local draft representation; API payloads retain absolute instants. */
function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function defaultIssueTimes(): { plannedStartAt: string; plannedEndAt: string } {
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (start.getMinutes() === 0) start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  return { plannedStartAt: toDatetimeLocalValue(start), plannedEndAt: toDatetimeLocalValue(end) };
}

/** Quick-issue draft times: prefer the row's CUS-locked schedule so "Giờ chạy"
 *  starts from the appointment instead of the wall clock. When `runAt` is
 *  available, use the full instant (preserving minutes — KP-037). Fall back to
 *  `deliveryDate` + `runHour` for older rows, then wall clock as last resort.
 *  Exported for the SIL-884 bulk runner — same derivation, one source of
 *  truth, so a batch release cannot diverge from the row release. */
export function draftIssueTimesFor(row: DispatchDetailPlanRow): { plannedStartAt: string; plannedEndAt: string } {
  const resolveEndAt = (fallbackEnd: Date): Date => {
    if (row.plannedEndAt) {
      const stored = new Date(row.plannedEndAt);
      if (!Number.isNaN(stored.getTime())) return stored;
    }
    return fallbackEnd;
  };

  // Prefer the full appointment instant when available — preserves minutes
  // that the integer runHour approach loses (20:45 vs 20:00).
  const runAt = row.time?.runAt;
  if (runAt) {
    const instant = new Date(runAt);
    if (!Number.isNaN(instant.getTime())) {
      const endAt = resolveEndAt(new Date(instant.getTime() + 2 * 60 * 60_000));
      return { plannedStartAt: toDatetimeLocalValue(instant), plannedEndAt: toDatetimeLocalValue(endAt) };
    }
  }
  const date = row.time?.deliveryDate;
  const hour = row.time?.runHour;
  if (!date || hour == null || hour < 0 || hour > 23) {
    const def = defaultIssueTimes();
    if (row.plannedEndAt) {
      const stored = new Date(row.plannedEndAt);
      if (!Number.isNaN(stored.getTime())) {
        def.plannedEndAt = toDatetimeLocalValue(stored);
      }
    }
    return def;
  }
  const startAt = new Date(`${date}T${pad2(hour)}:00+07:00`);
  if (Number.isNaN(startAt.getTime())) {
    const def = defaultIssueTimes();
    if (row.plannedEndAt) {
      const stored = new Date(row.plannedEndAt);
      if (!Number.isNaN(stored.getTime())) {
        def.plannedEndAt = toDatetimeLocalValue(stored);
      }
    }
    return def;
  }
  const endAt = resolveEndAt(new Date(startAt.getTime() + 2 * 60 * 60_000));
  return { plannedStartAt: toDatetimeLocalValue(startAt), plannedEndAt: toDatetimeLocalValue(endAt) };
}

export interface IssueOrderDraft {
  externalDriverName: string;
  externalDriverPhone: string;
  /** Per-trip trailer override (card 20261005_387): null = ride the tractor's
   *  current coupling — the body then omits trailerId exactly as before. */
  trailerId: number | null;
}

export interface OwnTruckDriver {
  id: number;
  driverId: number | null;
  driverName: string | null;
  /** The tractor's current coupling (card 20261005_387) — the default trailer
   *  an issue rides when no per-trip override is picked, shown beside the
   *  override select so the comparison is auditable on sight. */
  currentTrailerId: number | null;
  currentTrailerPlate: string | null;
  trailerType: string | null;
}

interface UseIssueOrderArgs {
  row: DispatchDetailPlanRow;
  /** The section/dialog holding these fields is visible — resets the draft
   *  and clears stale errors so a previous row's input never leaks in. */
  open: boolean;
  /** Row is eligible to issue right now — gates the own-truck driver lookup. */
  canIssue: boolean;
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => Promise<DispatchShipmentResponse>;
  onIssued: () => void;
}

/**
 * Shared "phát lệnh" logic — own-truck driver lookup, issue-time draft, and
 * the validation/submit flow — reused by both the full plan editor's inline
 * issue section and the grid's standalone quick-issue dialog, so the two
 * entry points can never diverge on what a valid order requires.
 */
export function useIssueOrder({ row, open, canIssue, onIssueOrder, onIssued }: UseIssueOrderArgs) {
  const [ownTruck, setOwnTruck] = useState<OwnTruckDriver | null>(null);
  const [loadingOwnTruck, setLoadingOwnTruck] = useState(false);
  const [issueDraft, setIssueDraft] = useState<IssueOrderDraft>({
    externalDriverName: '',
    externalDriverPhone: '',
    trailerId: null,
  });
  const [issuing, setIssuing] = useState(false);
  const issueInFlight = useRef(false);
  // The confirmed warn-retry reuses the truck resolved for the first attempt.
  const resolvedTruckRef = useRef<OwnTruckDriver | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const { confirm, dialog: issueConfirmDialog } = useConfirm();

  useEffect(() => {
    if (!open || !canIssue || row.dispatch.carrierType !== 'OWN' || !row.dispatch.assignedPlate) {
      setOwnTruck(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingOwnTruck(true);
    listDispatchFleetResources('TRUCK', { limit: 5, q: row.dispatch.assignedPlate })
      .then((response) => {
        if (cancelled) return;
        const match = (response.items as DispatchTruck[])
          .find((truck) => truck.licensePlate === row.dispatch.assignedPlate);
        setOwnTruck(match ? {
          id: match.id,
          driverId: match.assignedDriverId,
          driverName: match.assignedDriverName,
          currentTrailerId: match.currentTrailerId,
          currentTrailerPlate: match.currentTrailerPlate,
          trailerType: match.trailerType,
        } : null);
      })
      .catch(() => { if (!cancelled) setOwnTruck(null); })
      .finally(() => { if (!cancelled) setLoadingOwnTruck(false); });
    return () => { cancelled = true; };
  }, [open, canIssue, row.dispatch.carrierType, row.dispatch.assignedPlate]);

  useEffect(() => {
    if (open) {
      // SIL-1138 — reopen keeps the stored contact: the plan save persists
      // 'Tên/SĐT tài xế (nhà xe ngoài)', so the draft seeds from the row's
      // readback instead of blanking (the QA round-trip: lưu → mở lại còn
      // nguyên).
      setIssueDraft({
        externalDriverName: row.dispatch.assignedDriverName ?? '',
        externalDriverPhone: row.dispatch.assignedDriverPhone ?? '',
        // SIL-1241 — 'Moóc cho chuyến (ghi đè)' survives 'Lưu thay đổi', so
        // reopen seeds the pick from the row's readback instead of blanking
        // (the same round-trip law as the driver contact above).
        trailerId: row.dispatch.plannedTrailerId ?? null,
      });
      setIssueError(null);
    }
  }, [open, row.fulfillmentId, row.version]);

  // Card 20261005_387 — ACTIVE trailer options for the per-trip override.
  // Own-fleet issues only (external carriers bring their own equipment and the
  // backend ignores trailerId for them). Same plain-fetch idiom as the
  // ownTruck lookup; a failed catalog load leaves the coupling default usable.
  const [trailerOptions, setTrailerOptions] = useState<Array<{ id: number; licensePlate: string; type: string | null }>>([]);
  useEffect(() => {
    if (!open || !canIssue || row.dispatch.carrierType !== 'OWN') return undefined;
    let cancelled = false;
    configClient.getTrailers().then((trailers) => {
      if (cancelled) return;
      // A malformed payload must never crash the issue section — degrade to
      // "no override options" (the coupling default still issues).
      const list = Array.isArray(trailers) ? trailers : [];
      setTrailerOptions(list
        .filter((trailer) => trailer.status === 'ACTIVE' && !trailer.deletedAt)
        .map((trailer) => ({ id: trailer.id, licensePlate: trailer.licensePlate, type: trailer.type })));
    }).catch(() => { if (!cancelled) setTrailerOptions([]); });
    return () => { cancelled = true; };
  }, [open, canIssue, row.dispatch.carrierType]);

  async function issue() {
    if (issueInFlight.current || !canIssue) return;
    // Planned times ride the row's CUS-locked schedule (deliveryDate + runHour)
    // with a wall-clock fallback — dispatchers never pick times.
    const { plannedStartAt, plannedEndAt } = draftIssueTimesFor(row);
    const startAt = new Date(plannedStartAt);
    const endAt = new Date(plannedEndAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      setIssueError('Giờ chạy / giờ kết thúc không hợp lệ.');
      return;
    }
    if (endAt.getTime() <= startAt.getTime()) {
      setIssueError('Giờ trả hàng phải sau giờ chạy.');
      return;
    }
    const isOwn = row.dispatch.carrierType === 'OWN';
    // Driver name/phone for external carriers are optional since 2026-09-08 —
    // external drivers never use the app, so the order can't depend on them;
    // the trip is completed by dispatch/CUS instead (trips complete-external).
    const externalDriverName = issueDraft.externalDriverName.trim();
    const externalDriverPhone = issueDraft.externalDriverPhone.trim();

    issueInFlight.current = true;
    setIssuing(true);
    setIssueError(null);
    const attempt = (extra: { rigOverlapCompletedConfirmed?: boolean; plateDeferredConfirmed?: boolean; kepWeightWarningConfirmed?: boolean } = {}) => onIssueOrder(row, {
      plannedStartAt: startAt.toISOString(),
      plannedEndAt: endAt.toISOString(),
      endTimeConfirmed: true,
      carrierType: row.dispatch.carrierType as 'OWN' | 'EXTERNAL',
      truckId: isOwn ? resolvedTruckRef.current!.id : undefined,
      driverId: isOwn ? resolvedTruckRef.current!.driverId : undefined,
      // SIL-1241 — three-state trailer wire: an override pick rides as-is;
      // when a STORED override exists, an explicit 'Dùng moóc đang ghép'
      // (draft null) must still declare the coupling (or null) so the saved
      // override never shadows the dispatcher's fresh choice. Nothing stored
      // + nothing picked keeps the key omitted — the backend resolves the
      // coupling exactly as before card 20261005_387.
      trailerId: isOwn && (issueDraft.trailerId != null || row.dispatch.plannedTrailerId != null)
        ? issueDraft.trailerId ?? resolvedTruckRef.current?.currentTrailerId ?? null
        : undefined,
      externalCarrierId: isOwn ? undefined : row.dispatch.externalCarrierId,
      externalCarrierVehicleId: isOwn ? undefined : row.dispatch.externalCarrierVehicleId,
      externalPlateNumber: isOwn || row.dispatch.externalCarrierVehicleId != null
        ? undefined
        : row.dispatch.assignedPlate,
      externalDriverName: isOwn ? undefined : externalDriverName,
      externalDriverPhone: isOwn ? undefined : (externalDriverPhone || undefined),
      ...extra,
    });
    try {
      // A row action issues directly without mounting the assignment dialog.
      // Resolve its driver only on demand; never fetch once per visible row.
      let resolvedTruck = ownTruck;
      if (isOwn && resolvedTruck == null) {
        const response = await listDispatchFleetResources('TRUCK', { limit: 5, q: row.dispatch.assignedPlate ?? '' });
        const truck = (response.items as DispatchTruck[])
          .find((item) => item.licensePlate === row.dispatch.assignedPlate);
        resolvedTruck = truck ? {
          id: truck.id,
          driverId: truck.assignedDriverId,
          driverName: truck.assignedDriverName,
          currentTrailerId: truck.currentTrailerId,
          currentTrailerPlate: truck.currentTrailerPlate,
          trailerType: truck.trailerType,
        } : null;
      }
      if (isOwn && resolvedTruck?.driverId == null) {
        throw new Error('Xe chưa gán tài xế. Vào Danh mục Xe nội bộ để gán tài xế cho xe trước khi phát lệnh.');
      }
      resolvedTruckRef.current = resolvedTruck;
      // Bounded chained soft-409 confirmation loop: multiple independent soft
      // checks (e.g. KEP_WEIGHT_WARNING then RIG_OVERLAP_COMPLETED, or
      // PLATE_DEFERRED_CONFIRM then RIG_OVERLAP_COMPLETED) can fire on the
      // same truck + timeslot. Accumulate every confirmed flag across retries
      // and stop immediately if the same flag comes back a second time.
      let confirmedFlags: Partial<Record<SoftIssueConfirmFlag, boolean>> = {};
      while (true) {
        try {
          await attempt(confirmedFlags);
          onIssued();
          break;
        } catch (issueOrderError) {
          const soft = detectIssueSoftConfirm(issueOrderError);
          if (soft != null && confirmedFlags[soft.flag] !== true) {
            const proceed = await confirm(soft.message);
            if (!proceed) {
              setIssueError(soft.message || 'Đã huỷ phát lệnh.');
              break;
            }
            confirmedFlags = { ...confirmedFlags, [soft.flag]: true };
            continue;
          }
          setIssueError(
            issueOrderError instanceof Error && issueOrderError.message
              ? issueOrderError.message
              : 'Không thể phát lệnh. Kiểm tra thông báo của bảng và thử lại.',
          );
          break;
        }
      }
    } catch (issueOrderError) {
      setIssueError(
        issueOrderError instanceof Error && issueOrderError.message
          ? issueOrderError.message
          : 'Không thể phát lệnh. Kiểm tra thông báo của bảng và thử lại.',
      );
    } finally {
      issueInFlight.current = false;
      setIssuing(false);
    }
  }

  return { ownTruck, loadingOwnTruck, trailerOptions, issueDraft, setIssueDraft, issuing, issueError, setIssueError, issue, issueConfirmDialog };
}
