import { useEffect, useRef, useState } from 'react';
import {
  listDispatchFleetResources,
  type DispatchDetailPlanRow,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';

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
 *  `deliveryDate` + `runHour` for older rows, then wall clock as last resort. */
function draftIssueTimesFor(row: DispatchDetailPlanRow): { plannedStartAt: string; plannedEndAt: string } {
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
  const [issueError, setIssueError] = useState<string | null>(null);

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
      setIssueDraft({ externalDriverName: '', externalDriverPhone: '', trailerId: null });
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
      await onIssueOrder(row, {
        plannedStartAt: startAt.toISOString(),
        plannedEndAt: endAt.toISOString(),
        endTimeConfirmed: true,
        carrierType: row.dispatch.carrierType as 'OWN' | 'EXTERNAL',
        truckId: isOwn ? resolvedTruck!.id : undefined,
        driverId: isOwn ? resolvedTruck!.driverId : undefined,
        // Card 20261005_387 — the per-trip override rides only when picked;
        // omitted otherwise, so the backend resolves the tractor's current
        // coupling exactly as before this card.
        trailerId: isOwn && issueDraft.trailerId != null ? issueDraft.trailerId : undefined,
        externalCarrierId: isOwn ? undefined : row.dispatch.externalCarrierId,
        externalCarrierVehicleId: isOwn ? undefined : row.dispatch.externalCarrierVehicleId,
        externalPlateNumber: isOwn || row.dispatch.externalCarrierVehicleId != null
          ? undefined
          : row.dispatch.assignedPlate,
        externalDriverName: isOwn ? undefined : externalDriverName,
        externalDriverPhone: isOwn ? undefined : (externalDriverPhone || undefined),
      });
      onIssued();
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

  return { ownTruck, loadingOwnTruck, trailerOptions, issueDraft, setIssueDraft, issuing, issueError, setIssueError, issue };
}
