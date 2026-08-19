import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { canonicalShipmentStatus } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

export interface ShipmentFulfillmentDto {
  id: number;
  shipmentId: number;
  fulfillmentType: 'FCL_CONTAINER' | 'LCL_SHIPMENT';
  cargoMode: 'FCL' | 'LCL';
  shipmentContainerId: number | null;
  sourceShipmentVersion: number;
  siteSnapshot: Record<string, unknown>;
  plannedCarrierType: 'OWN' | 'EXTERNAL' | null;
  plannedExternalCarrierId: number | null;
  version: number;
  canceledAt: string | null;
  cancellationDisposition: 'REPLACED' | 'NOT_REQUIRED' | null;
  replacementFulfillmentId: number | null;
  createdAt: string;
}

export interface CreateShipmentFulfillmentsInput {
  shipmentId: number;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: number;
}

export interface EnsureShipmentFulfillmentsInTxInput {
  shipmentId: number;
  actorId: number;
  expectedVersion?: number;
  allowClerkIntake?: boolean;
}

function publicSiteSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const projectSite = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const site = value as Record<string, unknown>;
    return {
      id: site.id,
      code: site.code,
      name: site.shortName || site.name,
      fullName: site.name,
      siteType: site.siteType,
      address: site.address,
      googleMapsUrl: site.googleMapsUrl,
      strictRules: site.strictRules,
      sourceVersion: site.sourceVersion,
    };
  };
  return {
    deliverySite: projectSite(snapshot.deliverySite),
    pickupWarehouse: projectSite(snapshot.pickupWarehouse),
  };
}

function toDto(row: FulfillmentRow): ShipmentFulfillmentDto {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    fulfillmentType: row.fulfillmentType,
    cargoMode: row.cargoMode,
    shipmentContainerId: row.shipmentContainerId,
    sourceShipmentVersion: row.sourceShipmentVersion,
    // Safe by default: contacts and billing identity remain in the immutable
    // row and require a later role-specific order/accounting projection.
    siteSnapshot: publicSiteSnapshot(row.siteSnapshot),
    plannedCarrierType: row.plannedCarrierType as 'OWN' | 'EXTERNAL' | null,
    plannedExternalCarrierId: row.plannedExternalCarrierId,
    version: row.version,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    cancellationDisposition: row.cancellationDisposition,
    replacementFulfillmentId: row.replacementFulfillmentId,
    createdAt: row.createdAt.toISOString(),
  };
}

function validateCommand(input: CreateShipmentFulfillmentsInput): void {
  if (!Number.isInteger(input.shipmentId) || input.shipmentId < 1) {
    throw new ApiError(400, 'Lô hàng không hợp lệ.');
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ApiError(400, 'expectedVersion không hợp lệ.');
  }
  if (!Number.isInteger(input.actorId) || input.actorId < 1) {
    throw new ApiError(400, 'Người thực hiện không hợp lệ.');
  }
}

async function assertDecompositionActor(actorId: number, executor: Tx | typeof db): Promise<void> {
  const [actor] = await executor.select({
    role: s.users.role,
    status: s.users.status,
    deletedAt: s.users.deletedAt,
  }).from(s.users).where(eq(s.users.id, actorId)).limit(1);
  if (!actor || actor.deletedAt || actor.status !== 'ACTIVE') {
    throw new ApiError(403, 'Tài khoản điều vận không còn hiệu lực.');
  }
  if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER' && actor.role !== 'DISPATCHER') {
    throw new ApiError(403, 'Chỉ Điều vận, Quản lý hoặc Quản trị viên được tạo tác vụ thực hiện.');
  }
}

async function loadSiteSnapshot(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
): Promise<Record<string, unknown>> {
  const requestedIds = [shipment.operationalSiteId, shipment.pickupWarehouseSiteId]
    .filter((id): id is number => id != null);
  if (requestedIds.length === 0) return {};

  const sites = await tx.select().from(s.operationalSites)
    .where(and(
      inArray(s.operationalSites.id, requestedIds),
      eq(s.operationalSites.customerId, shipment.customerId),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    ));
  if (sites.length !== new Set(requestedIds).size) {
    throw new ApiError(409, 'Điểm vận hành không còn hiệu lực hoặc không thuộc khách hàng của lô hàng.');
  }

  const allowlist = (site: typeof sites[number]) => ({
    id: site.id,
    code: site.code,
    name: site.shortName || site.name,
    fullName: site.name,
    siteType: site.siteType,
    address: site.address,
    googleMapsUrl: site.googleMapsUrl,
    contactName: site.contactName,
    contactPhone: site.contactPhone,
    liftFeeInvoiceName: site.liftFeeInvoiceName,
    liftFeeInvoiceAddress: site.liftFeeInvoiceAddress,
    liftFeeTaxCode: site.liftFeeTaxCode,
    strictRules: site.strictRules,
    sourceVersion: site.version,
  });
  const byId = new Map(sites.map((site) => [site.id, allowlist(site)]));
  return {
    deliverySite: shipment.operationalSiteId ? byId.get(shipment.operationalSiteId) : null,
    pickupWarehouse: shipment.pickupWarehouseSiteId ? byId.get(shipment.pickupWarehouseSiteId) : null,
  };
}

async function listActiveRows(tx: Tx, shipmentId: number): Promise<FulfillmentRow[]> {
  return tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id));
}

function assertExistingDecompositionMatches(
  shipment: typeof s.shipments.$inferSelect,
  containers: Array<typeof s.shipmentContainers.$inferSelect>,
  rows: FulfillmentRow[],
): void {
  if (shipment.cargoMode === 'FCL') {
    const expected = new Set(containers.map((container) => container.id));
    const actual = new Set(rows.map((row) => row.shipmentContainerId).filter((id): id is number => id != null));
    if (rows.length !== expected.size || actual.size !== expected.size
      || [...expected].some((id) => !actual.has(id))) {
      throw new ApiError(409, 'Tác vụ thực hiện hiện có không khớp danh sách container.');
    }
    return;
  }
  if (rows.length !== 1 || rows[0].fulfillmentType !== 'LCL_SHIPMENT'
    || rows[0].shipmentContainerId !== null) {
    throw new ApiError(409, 'Lô hàng lẻ phải có đúng một tác vụ thực hiện.');
  }
}

export async function ensureShipmentFulfillmentsInTx(
  tx: Tx,
  input: EnsureShipmentFulfillmentsInTxInput,
): Promise<FulfillmentRow[]> {
  if (!Number.isInteger(input.shipmentId) || input.shipmentId < 1) {
    throw new ApiError(400, 'Lô hàng không hợp lệ.');
  }
  if (!Number.isInteger(input.actorId) || input.actorId < 1) {
    throw new ApiError(400, 'Người thực hiện không hợp lệ.');
  }
  if (input.expectedVersion != null
    && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ.');
  }

  if (!input.allowClerkIntake) {
    await assertDecompositionActor(input.actorId, tx);
  }
  await lockApplicationOwnedUniqueness(
    tx,
    'shipment-fulfillments:active-shipment',
    [input.shipmentId],
  );
  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  if (input.expectedVersion != null && shipment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
  }
  const shipmentStatus = canonicalShipmentStatus(shipment.status);
  if (shipmentStatus === 'CANCELED' || shipmentStatus === 'COMPLETED') {
    throw new ApiError(409, 'Không thể tạo tác vụ cho lô hàng đã kết thúc.');
  }
  if (shipment.cargoMode !== 'FCL' && shipment.cargoMode !== 'LCL') {
    throw new ApiError(409, 'Hình thức hàng FCL/LCL chưa được xác định.');
  }

  const containers = await tx.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipment.id))
    .orderBy(asc(s.shipmentContainers.id));
  if (shipment.cargoMode === 'FCL' && containers.length === 0) {
    throw new ApiError(409, 'Lô hàng nguyên container phải có ít nhất một container.');
  }
  if (shipment.cargoMode === 'LCL' && containers.length > 0) {
    throw new ApiError(409, 'Lô hàng lẻ không được tạo container giả.');
  }

  const existing = await listActiveRows(tx, shipment.id);
  if (existing.length > 0) {
    assertExistingDecompositionMatches(shipment, containers, existing);
    return existing;
  }

  const siteSnapshot = await loadSiteSnapshot(tx, shipment);
  // Per-container factory authority (SILVER L1): an FCL container naming its
  // own FACTORY overrides the shipment-level deliverySite half of the shared
  // snapshot. Cancellation + re-decompose is the refresh mechanism — whenever
  // a container's site changes, the guarded reconcile cancels the stale
  // fulfillments and this decomposition rebuilds snapshots from authority.
  const containerSnapshots = await loadContainerSiteSnapshots(tx, shipment, containers);
  const values: Array<typeof s.shipmentFulfillments.$inferInsert> = shipment.cargoMode === 'FCL'
    ? containers.map((container) => ({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER' as const,
      cargoMode: 'FCL' as const,
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: containerSnapshots.get(container.id) ?? siteSnapshot,
      createdBy: input.actorId,
    }))
    : [{
      shipmentId: shipment.id,
      fulfillmentType: 'LCL_SHIPMENT' as const,
      cargoMode: 'LCL' as const,
      shipmentContainerId: null,
      sourceShipmentVersion: shipment.version,
      siteSnapshot,
      createdBy: input.actorId,
    }];
  return tx.insert(s.shipmentFulfillments).values(values).returning();
}

/**
 * Resolve per-container overrides for the deliverySite snapshot half. Only
 * containers with their own FACTORY authority participate — everything else
 * keeps the shipment-level snapshot untouched (legacy precedence).
 */
async function loadContainerSiteSnapshots(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
  containers: Array<typeof s.shipmentContainers.$inferSelect>,
): Promise<Map<number, Record<string, unknown>>> {
  const siteIds = [...new Set(
    containers.map((container) => container.operationalSiteId)
      .filter((id): id is number => id != null),
  )];
  if (siteIds.length === 0) return new Map();

  const sites = await tx.select().from(s.operationalSites)
    .where(and(
      inArray(s.operationalSites.id, siteIds),
      eq(s.operationalSites.customerId, shipment.customerId),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    ));
  const byId = new Map(sites.map((site) => [site.id, site]));
  const overrides = new Map<number, Record<string, unknown>>();
  for (const container of containers) {
    if (container.operationalSiteId == null) continue;
    const site = byId.get(container.operationalSiteId);
    if (!site) continue;
    overrides.set(container.id, {
      deliverySite: {
        id: site.id,
        code: site.code,
        name: site.shortName || site.name,
        fullName: site.name,
        siteType: site.siteType,
        address: site.address,
        googleMapsUrl: site.googleMapsUrl,
        contactName: site.contactName,
        contactPhone: site.contactPhone,
        liftFeeInvoiceName: site.liftFeeInvoiceName,
        liftFeeInvoiceAddress: site.liftFeeInvoiceAddress,
        liftFeeTaxCode: site.liftFeeTaxCode,
        strictRules: site.strictRules,
        sourceVersion: site.version,
      },
    });
  }
  return overrides;
}

/**
 * Deterministically decompose a shipment into its independently dispatchable
 * units. Application-owned advisory locking serializes different idempotency
 * keys before the canonical active-row lookup.
 */
export async function createShipmentFulfillments(input: CreateShipmentFulfillmentsInput) {
  validateCommand(input);
  // Authorize before idempotency lookup as well as inside the transaction so
  // unauthorized callers cannot replay another actor's successful command.
  await assertDecompositionActor(input.actorId, db);
  return runIdempotent<ShipmentFulfillmentDto[]>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENTS_DECOMPOSE,
    idempotencyKey: input.idempotencyKey,
    payload: { shipmentId: input.shipmentId, expectedVersion: input.expectedVersion },
    createdBy: input.actorId,
    entityType: 'shipment_fulfillment_set',
    getEntityId: () => null,
    create: async (tx) => {
      const rows = await ensureShipmentFulfillmentsInTx(tx, {
        shipmentId: input.shipmentId,
        actorId: input.actorId,
        expectedVersion: input.expectedVersion,
      });
      return rows.map(toDto);
    },
  });
}

export async function assertFulfillmentBelongsToShipment(
  fulfillmentId: number,
  shipmentId: number,
  tx: Tx | typeof db = db,
): Promise<FulfillmentRow> {
  const [row] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, fulfillmentId),
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
    ))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy tác vụ thực hiện.');
  return row;
}

/**
 * Merge a per-container deliverySite override into an existing snapshot,
 * preserving the pickupWarehouse half. Used by the change-request review
 * path when it copies a canceled fulfillment's snapshot onto its
 * replacement — the override carries the container's current factory
 * authority instead of the stale inherited one.
 */
export function mergeContainerSiteSnapshotOverride(
  base: Record<string, unknown>,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!override) return base;
  return { ...base, ...override };
}


export async function assertFulfillmentReadyForDispatch(
  fulfillmentId: number,
  shipmentId: number,
  tx: Tx | typeof db = db,
): Promise<FulfillmentRow> {
  const row = await assertFulfillmentBelongsToShipment(fulfillmentId, shipmentId, tx);
  if (row.canceledAt) throw new ApiError(409, 'Tác vụ đã bị hủy và không thể điều xe.');
  const [shipment] = await tx.select({ status: s.shipments.status })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  const shipmentStatus = canonicalShipmentStatus(shipment.status);
  if (shipmentStatus !== 'READY_FOR_DISPATCH' && shipmentStatus !== 'DISPATCHED') {
    throw new ApiError(409, 'Lô hàng chưa sẵn sàng điều xe.');
  }
  if (!row.plannedCarrierType) {
    throw new ApiError(409, 'Tác vụ chưa được CUS gán nhà xe.');
  }
  return row;
}

/** Unresolved cancellation remains required until replacement/waiver is valid. */
export function isFulfillmentRequired(
  row: FulfillmentRow,
  replacement?: FulfillmentRow | null,
): boolean {
  if (!row.canceledAt) return true;
  if (row.cancellationDisposition === 'REPLACED') {
    const isValidReplacement = row.replacementFulfillmentId != null
      && replacement?.id === row.replacementFulfillmentId
      && replacement.shipmentId === row.shipmentId
      && replacement.fulfillmentType === row.fulfillmentType
      && replacement.shipmentContainerId === row.shipmentContainerId
      && replacement.canceledAt == null;
    return !isValidReplacement;
  }
  if (row.cancellationDisposition === 'NOT_REQUIRED'
    && row.notRequiredApprovedBy != null
    && row.notRequiredApprovedAt != null
    && Boolean(row.notRequiredReason?.trim())) return false;
  return true;
}
