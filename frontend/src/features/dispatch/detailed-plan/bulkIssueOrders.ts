/**
 * SIL-884 (5.1) — [Phát lệnh hàng loạt] on Kế hoạch Chi tiết (/dispatch-detail):
 * the dispatcher ticks the 'Đã điều xe' rows whose lệnh is not yet issued and
 * releases them in one shot.
 *
 * Laws the runner keeps (same contract the per-row quick-issue holds):
 *   • PARTIAL SUCCESS — one bad row never cancels the batch: every failure
 *     lands in the summary table with its reason, the rest still issue.
 *   • LAP KHÔNG TẠO TRÙNG CHUYẾN — rows are re-checked for eligibility at
 *     click time (a row that already carries a live trip refuses here) and
 *     released SEQUENTIALLY, so a just-issued sibling cannot slip a second
 *     trip past the grid's stale snapshot.
 *   • The per-row [Phát lệnh] stays untouched — this runner ADDS a batch
 *     path, it does not replace the row action.
 *
 * The per-row 409 soft warnings (rig overlap, plate-deferred, Kẹp weight)
 * are CONFIRM dialogs in the single-row flow. A batch never answers them
 * silently: without a confirm callback such rows fail with the server's
 * message and the hint to release that row individually; WITH the callback
 * (SIL-898, QA 24/11 12:37) the runner pauses once, the caller's dialog lists
 * the warn rows, and a confirmed choice re-releases only those rows with the
 * same flags the row flow rides.
 */
import { listDispatchFleetResources, type DispatchDetailPlanRow, type DispatchTruck } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { ApiError } from '../../../lib/api/errors';
import { deriveDispatchIssueStatus, type DispatchIssueStatus } from '../components/DispatchIssueStatus';
import { draftIssueTimesFor } from './useIssueOrder';

/** Why a row's checkbox is disabled in [Phát lệnh hàng loạt] mode. */
const BULK_ISSUE_BLOCK_REASONS: Record<DispatchIssueStatus, string> = {
  UNASSIGNED: 'Lô chưa được điều xe — gán xe trước khi phát lệnh.',
  AWAITING_PLATE: '', // eligible — deferred-plate external rows quick-issue too (card 20261004_359)
  PLATED_NOT_ISSUED: '', // eligible — the 'Đã điều xe' state this mode is for
  ISSUED: 'Đã phát lệnh rồi.',
  ACCEPTED: 'Lái xe đã nhận lệnh.',
  COMPLETED: 'Đã hoàn thành — lịch sử đóng băng.',
};

/** A row joins the batch only when its lệnh is not yet issued and its plate
 *  (or deferred external carrier) stands — the same derivation the row's
 *  quick-issue button uses, so batch and row can never disagree. */
export function bulkIssueEligibility(row: DispatchDetailPlanRow): { eligible: boolean; reason: string | null } {
  const issueStatus = deriveDispatchIssueStatus({
    vehicleAssigned: row.dispatch.assignedPlate != null,
    carrierAssigned: row.dispatch.externalCarrierId != null,
    issued: row.taskStatus === 'DISPATCHED' && row.dispatch.tripId != null,
    completed: row.taskStatus === 'COMPLETED',
  });
  const reason = BULK_ISSUE_BLOCK_REASONS[issueStatus];
  return { eligible: reason === '', reason: reason === '' ? null : reason };
}

/** BUG-03 retest (SIL-898) — the release set is the GLOBAL pick, never the
 *  current search window: an operator ticks rows across several searches, and
 *  a later search that no longer lists an earlier pick must not drop it from
 *  the batch. A selected row still visible in `items` releases from the
 *  fresher grid row; a row only the pick remembers rides its snapshot (the
 *  server's expectedVersion + issued-trip guard owns that staleness, and
 *  bulkIssueRows re-gates every row into the summary table). */
export function bulkIssueTargets(
  selectedRows: ReadonlyMap<number, DispatchDetailPlanRow>,
  items: ReadonlyArray<DispatchDetailPlanRow>,
): DispatchDetailPlanRow[] {
  return [...selectedRows.entries()].map(([fulfillmentId, picked]) => (
    items.find((row) => row.fulfillmentId === fulfillmentId) ?? picked
  ));
}

export interface BulkIssueFailure {
  fulfillmentId: number;
  /** Cont · Bill when the row has both — two lots can share one container
   *  number (QA 24/11: two rows both read 'RTAU4012043'), so the summary
   *  column needs the Bill to tell them apart; single-token rows keep the
   *  old shape. */
  identity: string;
  message: string;
}

/** CR-010.1 BUG-03 — the summary table lists EVERY released row, so a
 *  success keeps its identity too (the row's cont/Bill). */
export interface BulkIssueSuccess {
  fulfillmentId: number;
  identity: string;
}

export interface BulkIssueOutcome {
  issued: number;
  successes: BulkIssueSuccess[];
  failures: BulkIssueFailure[];
}

/** The release body mirrors useIssueOrder's `attempt()`: planned times ride
 *  the row's CUS-locked schedule, OWN rows carry the resolved truck+driver,
 *  external rows carry the carrier ids and omit the plate only when a carrier
 *  vehicle is already bound. */
function issueBodyFor(
  row: DispatchDetailPlanRow,
  truck: DispatchTruck,
  startAt: Date,
  endAt: Date,
): Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'> {
  const isOwn = row.dispatch.carrierType === 'OWN';
  return {
    plannedStartAt: startAt.toISOString(),
    plannedEndAt: endAt.toISOString(),
    endTimeConfirmed: true,
    carrierType: row.dispatch.carrierType as 'OWN' | 'EXTERNAL',
    truckId: isOwn ? truck.id : undefined,
    driverId: isOwn ? truck.assignedDriverId ?? undefined : undefined,
    externalCarrierId: isOwn ? undefined : row.dispatch.externalCarrierId,
    externalCarrierVehicleId: isOwn ? undefined : row.dispatch.externalCarrierVehicleId,
    externalPlateNumber: isOwn || row.dispatch.externalCarrierVehicleId != null
      ? undefined
      : row.dispatch.assignedPlate,
  };
}

/** 409 soft warns need an explicit confirm in the single-row flow; in a
 *  batch they surface with the hint to release that row on its own — unless
 *  the caller answers the batch confirm dialog (SIL-898, QA 24/11 12:37). */
function bulkFailureMessage(cause: unknown): string {
  // Rejections ride ApiError (status + translated message); a numeric status
  // on a plain rejection object keeps the legacy read. Everything else is a
  // local failure — the fallback line.
  const status = cause instanceof ApiError
    ? cause.status
    : typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number'
      ? cause.status
      : null;
  const rawCode = rawPayloadCode(cause);
  const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined;
  const message = cause instanceof Error && cause.message ? cause.message : 'Không thể phát lệnh.';
  const softWarn = status === 409 && (
    rawCode === 'RIG_OVERLAP_COMPLETED'
    || rawCode === 'PLATE_DEFERRED_CONFIRM'
    || rawCode === 'KEP_WEIGHT_WARNING'
    || code === 'KEP_WEIGHT_WARNING'
    || (message.includes('vượt tải trọng cho phép'))
  );
  return softWarn
    ? `${message} — dùng nút Phát lệnh trên dòng để xác nhận và phát lô này.`
    : message;
}

/** `code` off the raw 409 payload body ({ code: 'KEP_WEIGHT_WARNING' }) —
 *  narrowed field-by-field, never asserted; undefined on anything else. The
 *  payload rides ApiError.raw in production and a plain `raw` field in the
 *  test doubles; four call sites across the warn checks keep this lockstep. */
function rawPayloadCode(cause: unknown): string | undefined {
  const raw = cause instanceof ApiError
    ? cause.raw
    : typeof cause === 'object' && cause !== null && 'raw' in cause
      ? cause.raw
      : undefined;
  if (typeof raw === 'object' && raw !== null && 'code' in raw && typeof raw.code === 'string') {
    return raw.code;
  }
  return undefined;
}

/** The warn-once 409 family the row's quick-issue answers with 'Vẫn lưu?'
 *  (useIssueOrder / DispatchPlanEditorCell), and the dispatch-body flag each
 *  confirmed retry rides. */
type BulkIssueConfirmCode = 'RIG_OVERLAP_COMPLETED' | 'PLATE_DEFERRED_CONFIRM' | 'KEP_WEIGHT_WARNING';

const BULK_ISSUE_CONFIRM_FLAGS: Record<BulkIssueConfirmCode,
  'rigOverlapCompletedConfirmed' | 'plateDeferredConfirmed' | 'kepWeightWarningConfirmed'> = {
  RIG_OVERLAP_COMPLETED: 'rigOverlapCompletedConfirmed',
  PLATE_DEFERRED_CONFIRM: 'plateDeferredConfirmed',
  KEP_WEIGHT_WARNING: 'kepWeightWarningConfirmed',
};

/** Same detection the row's quick-issue applies: the 409 payload code, plus
 *  the KEP weight message fallback the row flow already honors. Null = a
 *  hard error, never confirmable. */
function bulkIssueConfirmCode(cause: unknown): BulkIssueConfirmCode | null {
  const status = cause instanceof ApiError
    ? cause.status
    : typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number'
      ? cause.status
      : null;
  if (status !== 409) return null;
  const rawCode = rawPayloadCode(cause);
  if (rawCode === 'RIG_OVERLAP_COMPLETED') return 'RIG_OVERLAP_COMPLETED';
  if (rawCode === 'PLATE_DEFERRED_CONFIRM') return 'PLATE_DEFERRED_CONFIRM';
  const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined;
  const message = cause instanceof Error ? cause.message : '';
  if (
    rawCode === 'KEP_WEIGHT_WARNING'
    || code === 'KEP_WEIGHT_WARNING'
    || (message.includes('vượt tải trọng cho phép'))
  ) return 'KEP_WEIGHT_WARNING';
  return null;
}

/** One warn-tier row the batch confirm dialog lists (identity + the server's
 *  'Vẫn lưu?' copy verbatim). SIL-898 — QA 24/11 12:37: both repro rows were
 *  warn-tier (completed-trip overlap; Kẹp weight), not hard blocks. */
export interface BulkIssueWarning {
  fulfillmentId: number;
  identity: string;
  message: string;
  code: BulkIssueConfirmCode;
}

/** Release the selected rows one by one; every failure is captured, nothing
 *  cancels the batch. Own-truck lookups share one plate→truck cache so a
 *  30-row batch never fires 30 identical catalog queries.
 *
 *  SIL-898 (QA 24/11 12:37) — warn-tier rows (completed-trip overlap, Kẹp
 *  weight, plate-deferred) no longer dead-end in the summary: when the caller
 *  provides `confirmWarnings`, the batch pauses once, lists the warn rows,
 *  and a confirmed choice re-releases ONLY those rows with the same flag the
 *  per-row 'Vẫn lưu?' retry rides. Declining (or no callback) keeps the
 *  legacy summary-failure behavior. One confirm round — a retry that still
 *  fails lands as a terminal failure, never a loop. */
export async function bulkIssueRows(
  rows: ReadonlyArray<DispatchDetailPlanRow>,
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
    options?: { fromBulk?: boolean },
  ) => Promise<DispatchShipmentResponse>,
  options?: {
    confirmWarnings?: (warnings: ReadonlyArray<BulkIssueWarning>) => Promise<boolean>;
  },
): Promise<BulkIssueOutcome> {
  const failures: BulkIssueFailure[] = [];
  const successes: BulkIssueSuccess[] = [];
  const warns: Array<{
    row: DispatchDetailPlanRow;
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>;
    warning: BulkIssueWarning;
    confirmedFlags: Partial<Pick<DispatchShipmentRequest, 'rigOverlapCompletedConfirmed' | 'plateDeferredConfirmed' | 'kepWeightWarningConfirmed'>>;
  }> = [];
  let issued = 0;
  const truckByPlate = new Map<string, DispatchTruck | null>();
  const resolveTruck = async (plate: string): Promise<DispatchTruck | null> => {
    const cached = truckByPlate.get(plate);
    if (cached !== undefined) return cached;
    const response = await listDispatchFleetResources('TRUCK', { limit: 5, q: plate });
    const match = (response.items as DispatchTruck[])
      .find((truck) => truck.licensePlate === plate) ?? null;
    truckByPlate.set(plate, match);
    return match;
  };
  const prepareRelease = async (row: DispatchDetailPlanRow) => {
    const { eligible, reason } = bulkIssueEligibility(row);
    if (!eligible) throw new Error(reason ?? 'Dòng không đủ điều kiện phát lệnh.');
    // Re-read at release time: a sibling issued moments ago must not ride a
    // stale snapshot into a second trip on the same fulfillment.
    if (row.dispatch.tripId != null) throw new Error('Đã phát lệnh rồi.');
    const isOwn = row.dispatch.carrierType === 'OWN';
    let truck: DispatchTruck | null = null;
    if (isOwn) {
      truck = row.dispatch.assignedPlate ? await resolveTruck(row.dispatch.assignedPlate) : null;
      if (truck?.assignedDriverId == null) {
        throw new Error('Xe chưa gán tài xế. Gán tài xế trong Danh mục Xe nội bộ rồi phát lệnh dòng này.');
      }
    }
    const { plannedStartAt, plannedEndAt } = draftIssueTimesFor(row);
    const startAt = new Date(plannedStartAt);
    const endAt = new Date(plannedEndAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new Error('Giờ chạy / giờ kết thúc không hợp lệ.');
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new Error('Giờ trả hàng phải sau giờ chạy.');
    }
    return issueBodyFor(row, truck!, startAt, endAt);
  };
  const release = (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
    flags: Partial<Pick<DispatchShipmentRequest, 'rigOverlapCompletedConfirmed' | 'plateDeferredConfirmed' | 'kepWeightWarningConfirmed'>> = {},
  ) => onIssueOrder(row, { ...body, ...flags }, { fromBulk: true });
  for (const row of rows) {
    // CR-010.1 (SIL-898 b) — the summary's CONT / BILL cell carries BOTH
    // tokens when the row has them: two lots routinely share one container
    // number across bookings, and a cont-only identity made the two summary
    // rows indistinguishable (QA 24/11 'RTAU4012043' twice).
    const cont = row.container.containerNumber?.trim() || null;
    const bill = row.docs.billNumber?.trim() || null;
    const identity = cont && bill ? `${cont} · ${bill}` : cont ?? bill ?? 'Chưa có số Bill/Booking';
    let body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'> | null = null;
    try {
      body = await prepareRelease(row);
      await release(row, body);
      issued += 1;
      successes.push({ fulfillmentId: row.fulfillmentId, identity });
    } catch (cause) {
      const code = bulkIssueConfirmCode(cause);
      if (code != null && body != null) {
        const warnMessage = cause instanceof Error && cause.message
          ? cause.message
          : 'Cảnh báo cần xác nhận.';
        warns.push({
          row,
          body,
          warning: {
            fulfillmentId: row.fulfillmentId,
            identity,
            message: warnMessage,
            code,
          },
          confirmedFlags: {},
        });
      } else {
        failures.push({ fulfillmentId: row.fulfillmentId, identity, message: bulkFailureMessage(cause) });
      }
    }
  }
  let pendingWarns = warns;
  while (pendingWarns.length > 0 && options?.confirmWarnings != null) {
    const proceed = await options.confirmWarnings(pendingWarns.map((pending) => pending.warning));
    if (!proceed) {
      for (const pending of pendingWarns) {
        failures.push({
          fulfillmentId: pending.row.fulfillmentId,
          identity: pending.warning.identity,
          message: `${pending.warning.message} — đã hủy xác nhận, dùng nút Phát lệnh trên dòng để phát lô này.`,
        });
      }
      return { issued, successes, failures };
    }
    const nextWarns: typeof pendingWarns = [];
    for (const pending of pendingWarns) {
      const nextFlags = {
        ...pending.confirmedFlags,
        [BULK_ISSUE_CONFIRM_FLAGS[pending.warning.code]]: true,
      };
      try {
        await release(pending.row, pending.body, nextFlags);
        issued += 1;
        successes.push({ fulfillmentId: pending.row.fulfillmentId, identity: pending.warning.identity });
      } catch (cause) {
        const nextCode = bulkIssueConfirmCode(cause);
        const nextFlag = nextCode != null ? BULK_ISSUE_CONFIRM_FLAGS[nextCode] : null;
        if (nextCode != null && nextFlag != null && nextFlags[nextFlag] !== true) {
          const warnMessage = cause instanceof Error && cause.message
            ? cause.message
            : 'Cảnh báo cần xác nhận.';
          nextWarns.push({
            row: pending.row,
            body: pending.body,
            warning: {
              fulfillmentId: pending.row.fulfillmentId,
              identity: pending.warning.identity,
              message: warnMessage,
              code: nextCode,
            },
            confirmedFlags: nextFlags,
          });
        } else {
          failures.push({
            fulfillmentId: pending.row.fulfillmentId,
            identity: pending.warning.identity,
            message: bulkFailureMessage(cause),
          });
        }
      }
    }
    pendingWarns = nextWarns;
  }
  for (const pending of pendingWarns) {
    failures.push({
      fulfillmentId: pending.row.fulfillmentId,
      identity: pending.warning.identity,
      message: `${pending.warning.message} — dùng nút Phát lệnh trên dòng để xác nhận và phát lô này.`,
    });
  }
  return { issued, successes, failures };
}
