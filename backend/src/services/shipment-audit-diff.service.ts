// Ticket 18/11 Task 1.2 — full audit entry for CUS-team writes on a lot
// (sửa/khóa hộ): before the mutation runs, load the affected shipment's
// pre-write values for the fields the request CAN change; after success,
// diff and record `changes: [{field, before, after}]` onto the request's
// audit metadata. A teammate acting on the owner's lot is logged with the
// SAME shape as an owner write — the actor columns/metadata prove WHO acted.
//
// Seam: the capture runs INSIDE the caller's write transaction (the same
// handle the mutation uses), so pre/post images are transaction-consistent
// with the write and cost no extra connection. The diff is stashed on
// `res.locals.auditFieldChanges`; both audit persistence paths (the durable
// in-transaction insert and the middleware finalize) read it from there.
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../db';
import * as s from '../db/schema';
import type { AuditFieldChange } from './audit-types';

/** Which field groups a request CAN change — the capture loads only these. */
export interface AuditSnapshotScope {
  shipmentFields?: boolean;
  costLock?: boolean;
  accountingLock?: boolean;
  documentCustody?: boolean;
  documentSet?: boolean;
  containers?: boolean;
  fulfillments?: boolean;
  declarations?: boolean;
}

/** Per-route scopes: only the columns each CUS-workspace/cost-lock write can touch. */
export const SHIPMENT_AUDIT_SCOPES = {
  /** Container-set/line writes: line columns + shipment schedule/status + fulfillment carrier plan. */
  containerSet: {
    shipmentFields: true,
    containers: true,
    fulfillments: true,
  },
  /** Lot-level field writes (finance confirm, delete request): status/schedule only. */
  shipmentFields: { shipmentFields: true },
  /** Tờ khai create/update (lot-level documents editor): the declaration rows. */
  declarations: { declarations: true },
  custody: { documentCustody: true },
  /** SIL-1073 — the original-document-set write: the latest set fact's fields. */
  documentSet: { documentSet: true },
  accountingLock: { accountingLock: true },
  costLock: { costLock: true },
} as const satisfies Record<string, AuditSnapshotScope>;

// Every shipments-table column a CUS-team write through PUT /api/shipments/:id
// can change — the inline lot-cell editors (notes, chứng từ, identity LCL,
// lịch trình) ride that route, so the snapshot must cover the whole whitelist,
// not just the schedule/status trio, or the teammate's old→new lands empty.
const SHIPMENT_TRACKED_COLUMNS = {
  status: s.shipments.status,
  customerId: s.shipments.customerId,
  routeId: s.shipments.routeId,
  cargoTypeId: s.shipments.cargoTypeId,
  responsibleUnitId: s.shipments.responsibleUnitId,
  cargoMode: s.shipments.cargoMode,
  bookingRef: s.shipments.bookingRef,
  blNumber: s.shipments.blNumber,
  tradeDirection: s.shipments.tradeDirection,
  operationalSiteId: s.shipments.operationalSiteId,
  pickupWarehouseSiteId: s.shipments.pickupWarehouseSiteId,
  factoryName: s.shipments.factoryName,
  isCombined: s.shipments.isCombined,
  shippingLineName: s.shipments.shippingLineName,
  expectedDeliveryDate: s.shipments.expectedDeliveryDate,
  customsCutoffAt: s.shipments.customsCutoffAt,
  closingAt: s.shipments.closingAt,
  plannedReturnAt: s.shipments.plannedReturnAt,
  cargoWeightKg: s.shipments.cargoWeightKg,
  cargoVolumeCbm: s.shipments.cargoVolumeCbm,
  packageCount: s.shipments.packageCount,
  packageType: s.shipments.packageType,
  revVehicleClassId: s.shipments.revVehicleClassId,
  contactName: s.shipments.contactName,
  contactPhone: s.shipments.contactPhone,
  customerNotes: s.shipments.customerNotes,
  operationalNotes: s.shipments.operationalNotes,
  pickupLocation: s.shipments.pickupLocation,
  deliveryLocation: s.shipments.deliveryLocation,
} as const;

const DECLARATION_TRACKED_COLUMNS = {
  declarationNumber: s.shipmentDeclarations.declarationNumber,
  issuedAt: s.shipmentDeclarations.issuedAt,
  scope: s.shipmentDeclarations.scope,
  note: s.shipmentDeclarations.note,
} as const;

const CONTAINER_TRACKED_COLUMNS = {
  containerNumber: s.shipmentContainers.containerNumber,
  declarationNumber: s.shipmentContainers.declarationNumber,
  sealNumber: s.shipmentContainers.sealNumber,
  containerTypeId: s.shipmentContainers.containerTypeId,
  cargoWeightKg: s.shipmentContainers.cargoWeightKg,
  cargoVolumeCbm: s.shipmentContainers.cargoVolumeCbm,
  shippingLineName: s.shipmentContainers.shippingLineName,
  routeId: s.shipmentContainers.routeId,
  operationalSiteId: s.shipmentContainers.operationalSiteId,
  pickupPortId: s.shipmentContainers.pickupPortId,
  dropoffPortId: s.shipmentContainers.dropoffPortId,
  customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
} as const;

const FULFILLMENT_TRACKED_COLUMNS = {
  plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
  plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
  plannedExternalCarrierVehicleId: s.shipmentFulfillments.plannedExternalCarrierVehicleId,
  plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
} as const;

/** One snapshot of one shipment's auditable state — only scoped groups are loaded. */
export interface ShipmentAuditSnapshot {
  shipment: Record<string, unknown> | null;
  costLockActive: boolean;
  accountingLockActive: boolean;
  documentCustodyStatus: string | null;
  documentCustodyNote: string | null;
  /** SIL-1073 — the latest original-document-set fact, the Lớp-2 fields. */
  documentSetState: Record<string, unknown> | null;
  containers: Record<string, Record<string, unknown>>;
  fulfillments: Record<string, Record<string, unknown>>;
  declarations: Record<string, Record<string, unknown>>;
}

/** Dates → ISO strings, everything else JSON-safe as the driver returned it. */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]));
}

export async function captureShipmentWriteAuditSnapshot(
  executor: Executor,
  shipmentId: number,
  scope: AuditSnapshotScope,
): Promise<ShipmentAuditSnapshot> {
  let shipment: Record<string, unknown> | null = null;
  if (scope.shipmentFields) {
    const [row] = await executor.select(SHIPMENT_TRACKED_COLUMNS)
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    shipment = row ? normalizeRow(row) : null;
  }

  let costLockActive = false;
  if (scope.costLock) {
    const [row] = await executor.select({ id: s.shipmentCostLocks.id })
      .from(s.shipmentCostLocks)
      .where(and(eq(s.shipmentCostLocks.shipmentId, shipmentId), isNull(s.shipmentCostLocks.unlockedAt)))
      .limit(1);
    costLockActive = row != null;
  }

  let accountingLockActive = false;
  if (scope.accountingLock) {
    const [row] = await executor.select({ id: s.shipmentAccountingLocks.id })
      .from(s.shipmentAccountingLocks)
      .where(and(eq(s.shipmentAccountingLocks.shipmentId, shipmentId), isNull(s.shipmentAccountingLocks.releasedAt)))
      .limit(1);
    accountingLockActive = row != null;
  }

  let documentCustodyStatus: string | null = null;
  let documentCustodyNote: string | null = null;
  if (scope.documentCustody) {
    const [row] = await executor.select({
      status: s.shipmentDocumentCustodyFacts.status,
      note: s.shipmentDocumentCustodyFacts.note,
    })
      .from(s.shipmentDocumentCustodyFacts)
      .where(eq(s.shipmentDocumentCustodyFacts.shipmentId, shipmentId))
      .orderBy(desc(s.shipmentDocumentCustodyFacts.changedAt), desc(s.shipmentDocumentCustodyFacts.id))
      .limit(1);
    documentCustodyStatus = row?.status ?? null;
    documentCustodyNote = row?.note ?? null;
  }

  let documentSetState: Record<string, unknown> | null = null;
  if (scope.documentSet) {
    const [row] = await executor.select({
      status: s.shipmentDocumentSetFacts.status,
      missingDocuments: s.shipmentDocumentSetFacts.missingDocuments,
      receiverName: s.shipmentDocumentSetFacts.receiverName,
      receivedOn: s.shipmentDocumentSetFacts.receivedOn,
    })
      .from(s.shipmentDocumentSetFacts)
      .where(eq(s.shipmentDocumentSetFacts.shipmentId, shipmentId))
      .orderBy(desc(s.shipmentDocumentSetFacts.changedAt), desc(s.shipmentDocumentSetFacts.id))
      .limit(1);
    documentSetState = row ? normalizeRow({
      status: row.status,
      missingDocuments: row.missingDocuments,
      receiverName: row.receiverName,
      receivedOn: row.receivedOn,
    }) : null;
  }

  const containers: Record<string, Record<string, unknown>> = {};
  if (scope.containers) {
    const rows = await executor.select({ id: s.shipmentContainers.id, ...CONTAINER_TRACKED_COLUMNS })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipmentId))
      .orderBy(asc(s.shipmentContainers.id));
    for (const row of rows) {
      const { id, ...fields } = row;
      containers[String(id)] = normalizeRow(fields);
    }
  }

  const fulfillments: Record<string, Record<string, unknown>> = {};
  if (scope.fulfillments) {
    const rows = await executor.select({ id: s.shipmentFulfillments.id, ...FULFILLMENT_TRACKED_COLUMNS })
      .from(s.shipmentFulfillments)
      .where(and(eq(s.shipmentFulfillments.shipmentId, shipmentId), isNull(s.shipmentFulfillments.canceledAt)))
      .orderBy(asc(s.shipmentFulfillments.id));
    for (const row of rows) {
      const { id, ...fields } = row;
      fulfillments[String(id)] = normalizeRow(fields);
    }
  }

  const declarations: Record<string, Record<string, unknown>> = {};
  if (scope.declarations) {
    const rows = await executor.select({ id: s.shipmentDeclarations.id, ...DECLARATION_TRACKED_COLUMNS })
      .from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId))
      .orderBy(asc(s.shipmentDeclarations.id));
    for (const row of rows) {
      const { id, ...fields } = row;
      declarations[String(id)] = normalizeRow(fields);
    }
  }

  return {
    shipment,
    costLockActive,
    accountingLockActive,
    documentCustodyStatus,
    documentCustodyNote,
    documentSetState,
    containers,
    fulfillments,
    declarations,
  };
}

/** Scalar old→new entries for one tracked row; `fieldPrefix` names the row (`container.12.` …). */
function collectScalarChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldPrefix = '',
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes.push({ field: `${fieldPrefix}${key}`, before: before[key], after: after[key] });
    }
  }
  return changes;
}

/** Field-level old→new diff of two snapshots. Only scoped groups can differ. */
export function diffShipmentAuditSnapshots(
  before: ShipmentAuditSnapshot,
  after: ShipmentAuditSnapshot,
  scope: AuditSnapshotScope,
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  if (before.shipment && after.shipment) {
    changes.push(...collectScalarChanges(before.shipment, after.shipment));
  }
  if (scope.costLock && before.costLockActive !== after.costLockActive) {
    changes.push({ field: 'costLock', before: before.costLockActive, after: after.costLockActive });
  }
  if (scope.accountingLock && before.accountingLockActive !== after.accountingLockActive) {
    changes.push({ field: 'accountingLock', before: before.accountingLockActive, after: after.accountingLockActive });
  }
  if (scope.documentCustody) {
    if (before.documentCustodyStatus !== after.documentCustodyStatus) {
      changes.push({
        field: 'documentCustodyStatus',
        before: before.documentCustodyStatus,
        after: after.documentCustodyStatus,
      });
    }
    if (before.documentCustodyNote !== after.documentCustodyNote) {
      changes.push({
        field: 'documentCustodyNote',
        before: before.documentCustodyNote,
        after: after.documentCustodyNote,
      });
    }
  }
  if (scope.documentSet) {
    const beforeRow = before.documentSetState;
    const afterRow = after.documentSetState;
    if (afterRow == null) {
      // Nothing tracked after the write (scope without capture) — nothing to diff.
    } else {
      // The fact-less lot's baseline is the KB default state (Còn thiếu, no
      // names, no receiver) so the FIRST write diffs against it instead of
      // reporting an empty change set.
      const baseline = beforeRow ?? {
        status: 'MISSING',
        missingDocuments: [],
        receiverName: null,
        receivedOn: null,
      };
      changes.push(...collectScalarChanges(baseline, afterRow, 'documentSet.'));
    }
  }
  if (scope.containers) {
    const ids = [...new Set([...Object.keys(before.containers), ...Object.keys(after.containers)])]
      .sort((a, b) => Number(a) - Number(b));
    for (const id of ids) {
      const beforeRow = before.containers[id];
      const afterRow = after.containers[id];
      if (!afterRow) {
        changes.push({
          field: `container.${id}`,
          before: beforeRow.containerNumber ?? `#${id}`,
          after: null,
        });
        continue;
      }
      if (!beforeRow) {
        changes.push({
          field: `container.${id}`,
          before: null,
          after: afterRow.containerNumber ?? `#${id}`,
        });
        continue;
      }
      changes.push(...collectScalarChanges(beforeRow, afterRow, `container.${id}.`));
    }
  }
  if (scope.fulfillments) {
    const ids = [...new Set([...Object.keys(before.fulfillments), ...Object.keys(after.fulfillments)])]
      .sort((a, b) => Number(a) - Number(b));
    for (const id of ids) {
      const beforeRow = before.fulfillments[id];
      const afterRow = after.fulfillments[id];
      if (!beforeRow || !afterRow) continue; // fulfillment lifecycle rows are audited by their own commands
      changes.push(...collectScalarChanges(beforeRow, afterRow, `fulfillment.${id}.`));
    }
  }
  if (scope.declarations) {
    const ids = [...new Set([...Object.keys(before.declarations), ...Object.keys(after.declarations)])]
      .sort((a, b) => Number(a) - Number(b));
    for (const id of ids) {
      const beforeRow = before.declarations[id];
      const afterRow = after.declarations[id];
      if (!afterRow) {
        changes.push({
          field: `declaration.${id}`,
          before: beforeRow.declarationNumber ?? `#${id}`,
          after: null,
        });
        continue;
      }
      if (!beforeRow) {
        changes.push({
          field: `declaration.${id}`,
          before: null,
          after: afterRow.declarationNumber ?? `#${id}`,
        });
        continue;
      }
      changes.push(...collectScalarChanges(beforeRow, afterRow, `declaration.${id}.`));
    }
  }
  return changes;
}

/** Per-request stash target — Express `res.locals` satisfies it structurally. */
export interface ShipmentAuditChangeStash {
  auditFieldChanges?: AuditFieldChange[];
}

export function stashShipmentAuditFieldChanges(
  stash: ShipmentAuditChangeStash,
  changes: AuditFieldChange[],
): void {
  if (changes.length > 0) {
    stash.auditFieldChanges = changes;
  }
}

/**
 * Read the diff stashed on the request (res.locals). Structural validation so
 * a stale/garbage local can never corrupt an audit payload.
 */
export function readShipmentAuditFieldChanges(stash: unknown): AuditFieldChange[] | undefined {
  if (!stash || typeof stash !== 'object') return undefined;
  const value = (stash as Record<string, unknown>).auditFieldChanges;
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => entry != null && typeof entry === 'object' && typeof (entry as AuditFieldChange).field === 'string')
    ? value as AuditFieldChange[]
    : undefined;
}

/**
 * Capture → run the mutation → capture → diff, all on the caller's transaction
 * handle, then stash the changes for the request's audit row. On a failed
 * mutation the run() throw propagates before any diff is recorded.
 */
export async function withShipmentAuditDiff<R>(
  stash: ShipmentAuditChangeStash,
  args: { executor: Executor; shipmentId: number; scope: AuditSnapshotScope },
  run: () => Promise<R>,
): Promise<R> {
  const before = await captureShipmentWriteAuditSnapshot(args.executor, args.shipmentId, args.scope);
  const result = await run();
  const after = await captureShipmentWriteAuditSnapshot(args.executor, args.shipmentId, args.scope);
  stashShipmentAuditFieldChanges(stash, diffShipmentAuditSnapshots(before, after, args.scope));
  return result;
}
