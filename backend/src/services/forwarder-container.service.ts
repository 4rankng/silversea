import { db, type Executor, type Tx } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { normalizeContainerNumber } from '@tingting/shared';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { syncShipmentIdentityFromTripContainers } from './shipment-containers.service';
import { decideTripContainerNumberLink, type TripContainerLinkContext, type TripContainerLinkDecision } from './trip-container-link.service';

export type { Executor } from '../db';

function assertExpectedUpdatedAt(
  current: Date,
  expectedUpdatedAt?: Date,
  message = 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.',
) {
  if (!expectedUpdatedAt) return;
  if (current.getTime() !== expectedUpdatedAt.getTime()) {
    throw new ApiError(409, message);
  }
}

interface ContainerSealInput {
  id?: number;
  sealNumber: string;
  sealType?: string | null;
  notes?: string | null;
}

/**
 * Diff-sync one container's seal rows: delete rows absent from `seals`, update
 * rows whose id is still present, insert the rest. Shared by the
 * single-container seal editor and the bulk trip-container upsert so the two
 * write paths can never drift.
 */
async function syncContainerSeals(
  tx: Tx,
  containerId: number,
  seals: ContainerSealInput[],
  userId: number | null,
  existingSealIds: Set<number>,
): Promise<void> {
  const incomingIds = new Set(seals.filter(x => x.id).map(x => x.id as number));

  const toDelete = [...existingSealIds].filter(id => !incomingIds.has(id));
  if (toDelete.length > 0) {
    await tx.delete(s.tripContainerSeals).where(inArray(s.tripContainerSeals.id, toDelete));
  }

  const toUpdate = seals.filter(x => x.id && existingSealIds.has(x.id));
  const toInsert = seals.filter(x => !(x.id && existingSealIds.has(x.id)));
  await Promise.all(toUpdate.map(seal => tx.update(s.tripContainerSeals)
    .set({
      tripContainerId: containerId,
      sealNumber: seal.sealNumber,
      sealType: seal.sealType ?? null,
      notes: seal.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(s.tripContainerSeals.id, seal.id!))));
  if (toInsert.length > 0) {
    await tx.insert(s.tripContainerSeals).values(toInsert.map(seal => ({
      tripContainerId: containerId,
      sealNumber: seal.sealNumber,
      sealType: seal.sealType ?? null,
      notes: seal.notes ?? null,
      createdBy: userId,
      updatedAt: new Date(),
    })));
  }
}

export async function derivePrimarySealNumber(
  executor: Executor,
  tripContainerId: number,
): Promise<string | null> {
  const [row] = await executor.select({ sealNumber: s.tripContainerSeals.sealNumber })
    .from(s.tripContainerSeals)
    .where(eq(s.tripContainerSeals.tripContainerId, tripContainerId))
    .orderBy(s.tripContainerSeals.id)
    .limit(1);
  return row?.sealNumber ?? null;
}

// ─── SIL-655 (id 762) — the link invariant at every trip-container write ────
//
// A numbered trip_container on a shipment-linked trip must resolve to one
// shipment_containers row of that lot; an unlinked numbered row is a silent
// bridge no-op ("lái xe nhập số cont nhưng CUS/ĐV vẫn chưa có"). Every write
// path below resolves-or-throws BEFORE storing a number on an unlinked row;
// already-linked rows keep the SIL-653 semantics (the bridge mirrors their
// number onto their own lot row). Boundary: trips without a lot
// (trips.shipment_id IS NULL) resolve to NO_SHIPMENT — invariant vacuous.

export type TripContainerLinkFields = {
  sourceShipmentId: number;
  sourceShipmentContainerId: number;
  sourceShipmentVersion: number | null;
};

async function loadTripContainerLinkContext(
  executor: Executor,
  tripId: number,
): Promise<TripContainerLinkContext & { shipmentVersion: number | null }> {
  const [trip] = await executor.select({ shipmentId: s.trips.shipmentId })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  const tripShipmentId = trip?.shipmentId ?? null;
  if (tripShipmentId == null) {
    return { tripShipmentId: null, shipmentVersion: null, lotContainers: [], tripRows: [] };
  }
  const [shipment] = await executor.select({ version: s.shipments.version })
    .from(s.shipments).where(eq(s.shipments.id, tripShipmentId)).limit(1);
  const lotContainers = await executor.select({
    id: s.shipmentContainers.id,
    containerNumber: s.shipmentContainers.containerNumber,
  }).from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, tripShipmentId));
  const tripRows = await executor.select({
    id: s.tripContainers.id,
    sourceShipmentContainerId: s.tripContainers.sourceShipmentContainerId,
    containerNumber: s.tripContainers.containerNumber,
  }).from(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  return {
    tripShipmentId,
    shipmentVersion: shipment?.version ?? null,
    lotContainers,
    tripRows,
  };
}

function assertTripContainerLinkDecision(decision: TripContainerLinkDecision, containerNumber: string): void {
  const shown = normalizeContainerNumber(containerNumber);
  if (decision.kind === 'REJECT_UNDECLARED') {
    throw new ApiError(409, `Số container "${shown}" chưa được khai trên lô hàng của chuyến.`);
  }
  if (decision.kind === 'REJECT_DUPLICATE_ON_TRIP') {
    throw new ApiError(409, `Số container "${shown}" đã có trên chuyến này.`);
  }
}

export async function createTripContainerInClient(executor: Executor, data: {
  tripId: number;
  containerTypeId?: number | null;
  containerNumber?: string | null;
  sealNumber: string | null;
  cargoWeightKg?: string | number | null;
  notes: string | null;
  createdBy: number | null;
  seals?: Array<{
    sealNumber: string;
    sealType?: string | null;
    notes?: string | null;
  }>;
}) {
  if (executor !== db) {
    await assertTripShipmentAccountingUnlocked(executor, data.tripId);
  }
  const initialSeals = data.seals ?? [];
  // Canonical at the store (batch-parity): normalize-empty input ('-') clears
  // to null so a NUMBERLESS decision always matches the stored state.
  const containerNumber = data.containerNumber?.trim()
    ? (normalizeContainerNumber(data.containerNumber) || null)
    : null;

  // SIL-655 — this POST used to store the number with no link and never call
  // the bridge (the driver's "Nhập số cont" route lands here): resolve the
  // number to the lot's container first — 409 when it is not declared on the
  // lot or already used on this trip — so the bridge below can mirror it.
  let link: TripContainerLinkFields | null = null;
  if (containerNumber) {
    // Serialize concurrent numbered creates against the batch PUT path (which
    // already locks the trip): the duplicate law reads a snapshot.
    await executor.select({ id: s.trips.id }).from(s.trips)
      .where(eq(s.trips.id, data.tripId)).limit(1).for('update');
    const ctx = await loadTripContainerLinkContext(executor, data.tripId);
    const decision = decideTripContainerNumberLink(ctx, containerNumber, null);
    assertTripContainerLinkDecision(decision, containerNumber);
    if (decision.kind === 'LINK') {
      link = {
        sourceShipmentId: ctx.tripShipmentId as number,
        sourceShipmentContainerId: decision.sourceShipmentContainerId,
        sourceShipmentVersion: ctx.shipmentVersion,
      };
    }
  }

  const [inserted] = await executor.insert(s.tripContainers).values({
    tripId: data.tripId,
    ...(link ?? {}),
    containerTypeId: data.containerTypeId ?? null,
    containerNumber,
    sealNumber: null,
    cargoWeightKg: data.cargoWeightKg != null ? String(data.cargoWeightKg) : null,
    notes: data.notes,
    createdBy: data.createdBy,
  }).returning();

  if (initialSeals.length > 0) {
    await executor.insert(s.tripContainerSeals).values(
      initialSeals.map((seal) => ({
        tripContainerId: inserted.id,
        sealNumber: seal.sealNumber,
        sealType: seal.sealType ?? null,
        notes: seal.notes ?? null,
        createdBy: data.createdBy,
      })),
    );
  }
  const primarySeal = await derivePrimarySealNumber(executor, inserted.id);
  if (primarySeal !== null) {
    await executor.update(s.tripContainers)
      .set({ sealNumber: primarySeal, updatedAt: new Date() })
      .where(eq(s.tripContainers.id, inserted.id));
  }
  // SIL-655 — the add-container POST is a trip-side identity write like the
  // PATCH/PUT paths, so the bridge runs here too: on a fresh LINK the number
  // was just matched to the lot row (diff-guarded no-op) and the primary seal
  // mirrors back; unlinked rows are skipped inside the bridge.
  await syncShipmentIdentityFromTripContainers(executor, [inserted.id]);
  return { ...inserted, sealNumber: primarySeal };
}

export async function createTripContainer(data: {
  tripId: number;
  containerTypeId?: number | null;
  containerNumber?: string | null;
  sealNumber: string | null;
  cargoWeightKg?: string | number | null;
  notes: string | null;
  createdBy: number | null;
  seals?: Array<{
    sealNumber: string;
    sealType?: string | null;
    notes?: string | null;
  }>;
}) {
  return db.transaction((tx) => createTripContainerInClient(tx, data));
}

export async function updateTripContainerInClient(
  executor: Executor,
  containerId: number,
  patch: {
    containerTypeId?: number | null;
    containerNumber?: string | null;
    sealNumber?: string | null;
    cargoWeightKg?: string | number | null;
    notes?: string | null;
    addSeals?: Array<{
      sealNumber: string;
      sealType?: string | null;
      notes?: string | null;
    }>;
    userId?: number | null;
  },
  options: {
    expectedUpdatedAt?: Date;
  } = {},
) {
  const [reference] = await executor.select({ tripId: s.tripContainers.tripId })
    .from(s.tripContainers)
    .where(eq(s.tripContainers.id, containerId))
    .limit(1);
  if (!reference) throw new ApiError(404, 'Không tìm thấy số cont');
  if (executor !== db) {
    await assertTripShipmentAccountingUnlocked(executor, reference.tripId);
  }
  const [row] = await executor.select({
    id: s.tripContainers.id,
    tripId: s.tripContainers.tripId,
    sourceShipmentContainerId: s.tripContainers.sourceShipmentContainerId,
    updatedAt: s.tripContainers.updatedAt,
  })
    .from(s.tripContainers)
    .where(eq(s.tripContainers.id, containerId))
    .limit(1)
    .for('update');
  if (!row) throw new ApiError(404, 'Không tìm thấy số cont');
  assertExpectedUpdatedAt(row.updatedAt, options.expectedUpdatedAt);

  const [trip] = await executor.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, row.tripId)).limit(1);
  if (trip?.status === 'COMPLETED') {
    throw new ApiError(409, 'Không thể sửa số cont của chuyến đã hoàn thành');
  }

  // SIL-655 — a number written onto an UNLINKED row (placeholder copy, legacy
  // row) must resolve to the lot's container or be refused — 409 when the
  // number is not declared on the lot (incl. the LCL synthetic row, whose lot
  // lawfully has no containers). Linked rows keep SIL-653 semantics: the
  // bridge below mirrors their number onto THEIR lot row.
  let link: TripContainerLinkFields | null = null;
  if (row.sourceShipmentContainerId == null && patch.containerNumber != null && patch.containerNumber.trim()) {
    const containerNumber = patch.containerNumber.trim();
    const ctx = await loadTripContainerLinkContext(executor, row.tripId);
    const decision = decideTripContainerNumberLink(ctx, containerNumber, containerId);
    assertTripContainerLinkDecision(decision, containerNumber);
    if (decision.kind === 'LINK') {
      link = {
        sourceShipmentId: ctx.tripShipmentId as number,
        sourceShipmentContainerId: decision.sourceShipmentContainerId,
        sourceShipmentVersion: ctx.shipmentVersion,
      };
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date(), ...(link ?? {}) };
  if (patch.containerTypeId !== undefined) set.containerTypeId = patch.containerTypeId ?? null;
  if (patch.containerNumber !== undefined) {
    // Canonical at the store (batch-parity): normalize-empty clears to null.
    set.containerNumber = patch.containerNumber?.trim()
      ? (normalizeContainerNumber(patch.containerNumber) || null)
      : null;
  }
  if (patch.sealNumber !== undefined) set.sealNumber = patch.sealNumber ?? null;
  if (patch.cargoWeightKg !== undefined) {
    set.cargoWeightKg = patch.cargoWeightKg != null ? String(patch.cargoWeightKg) : null;
  }
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;

  const hasScalarChanges = Object.keys(set).length > 1;
  const hasSealsToAdd = (patch.addSeals?.length ?? 0) > 0;

  if (!hasScalarChanges && !hasSealsToAdd) {
    return listTripContainers(row.tripId, executor)
      .then((rows) => rows.find((item) => item.id === containerId));
  }

  if (hasScalarChanges) {
    await executor.update(s.tripContainers).set(set).where(eq(s.tripContainers.id, containerId));
  }

  if (hasSealsToAdd) {
    await executor.insert(s.tripContainerSeals).values(
      (patch.addSeals ?? []).map((seal) => ({
        tripContainerId: containerId,
        sealNumber: seal.sealNumber,
        sealType: seal.sealType ?? null,
        notes: seal.notes ?? null,
        createdBy: patch.userId ?? null,
      })),
    );
    const primarySeal = await derivePrimarySealNumber(executor, containerId);
    await executor.update(s.tripContainers)
      .set({ sealNumber: primarySeal, updatedAt: new Date() })
      .where(eq(s.tripContainers.id, containerId));
  }

  // SIL-653 (id 760) — identity bridge (lái xe → ĐV/CUS): the driver's "Số
  // cont & seal" save must land on the lot's shipment_containers row too, or
  // dispatch/CUS keep reading "Chưa có số cont" forever. Diff-guarded no-op
  // unless the number/seal actually moved; throws 400 on a malformed or
  // in-lot-duplicate number (same message as the CUS line command).
  if (patch.containerNumber !== undefined || patch.sealNumber !== undefined || hasSealsToAdd) {
    await syncShipmentIdentityFromTripContainers(executor, [containerId]);
  }

  const rows = await listTripContainers(row.tripId, executor);
  return rows.find((item) => item.id === containerId);
}

export async function updateTripContainer(
  containerId: number,
  patch: {
    containerTypeId?: number | null;
    containerNumber?: string | null;
    sealNumber?: string | null;
    cargoWeightKg?: string | number | null;
    notes?: string | null;
    addSeals?: Array<{
      sealNumber: string;
      sealType?: string | null;
      notes?: string | null;
    }>;
    userId?: number | null;
  },
  options: {
    expectedUpdatedAt?: Date;
  } = {},
) {
  return db.transaction((tx) => updateTripContainerInClient(tx, containerId, patch, options));
}

export async function listTripContainers(tripId: number, executor: Executor = db) {
  const rows = await executor.select({
    id: s.tripContainers.id,
    tripId: s.tripContainers.tripId,
    containerTypeId: s.tripContainers.containerTypeId,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
    containerNumber: s.tripContainers.containerNumber,
    sealNumber: s.tripContainers.sealNumber,
    cargoWeightKg: s.tripContainers.cargoWeightKg,
    notes: s.tripContainers.notes,
    createdBy: s.tripContainers.createdBy,
    createdAt: s.tripContainers.createdAt,
    updatedAt: s.tripContainers.updatedAt,
  }).from(s.tripContainers)
    .leftJoin(s.containerTypes, eq(s.tripContainers.containerTypeId, s.containerTypes.id))
    .where(eq(s.tripContainers.tripId, tripId))
    .orderBy(s.tripContainers.id);

  if (rows.length === 0) return rows;

  const containerIds = rows.map(r => r.id);
  const sealRows = await executor.select({
    id: s.tripContainerSeals.id,
    tripContainerId: s.tripContainerSeals.tripContainerId,
    sealNumber: s.tripContainerSeals.sealNumber,
    sealType: s.tripContainerSeals.sealType,
    notes: s.tripContainerSeals.notes,
    createdBy: s.tripContainerSeals.createdBy,
    createdAt: s.tripContainerSeals.createdAt,
    updatedAt: s.tripContainerSeals.updatedAt,
  }).from(s.tripContainerSeals)
    .where(inArray(s.tripContainerSeals.tripContainerId, containerIds))
    .orderBy(s.tripContainerSeals.id);

  const photoRows = await executor.select({
    id: s.tripPhotos.id,
    tripContainerId: s.tripPhotos.tripContainerId,
    type: s.tripPhotos.type,
    storageKey: s.tripPhotos.storageKey,
    uploadedAt: s.tripPhotos.uploadedAt,
  }).from(s.tripPhotos)
    .where(and(
      inArray(s.tripPhotos.tripContainerId, containerIds),
      inArray(s.tripPhotos.type, ['CONTAINER', 'SEAL'] as const),
    ))
    .orderBy(desc(s.tripPhotos.uploadedAt));

  const sealsByContainer = new Map<number, typeof sealRows>();
  for (const sr of sealRows) {
    const list = sealsByContainer.get(sr.tripContainerId) ?? [];
    list.push(sr);
    sealsByContainer.set(sr.tripContainerId, list);
  }

  const photosByContainer = new Map<number, typeof photoRows>();
  for (const pr of photoRows) {
    if (pr.tripContainerId == null) continue;
    const list = photosByContainer.get(pr.tripContainerId) ?? [];
    list.push(pr);
    photosByContainer.set(pr.tripContainerId, list);
  }

  return rows.map(r => ({
    ...r,
    seals: sealsByContainer.get(r.id) ?? [],
    photos: photosByContainer.get(r.id) ?? [],
  }));
}

export async function batchUpsertContainerSeals(
  containerId: number,
  seals: Array<{
    id?: number;
    sealNumber: string;
    sealType?: string | null;
    notes?: string | null;
  }>,
  userId: number | null,
  options: {
    expectedUpdatedAt?: Date;
  } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [row] = await tx.select({
      containerUpdatedAt: s.tripContainers.updatedAt,
      tripId: s.tripContainers.tripId,
      tripStatus: s.trips.status,
    })
      .from(s.tripContainers)
      .leftJoin(s.trips, eq(s.trips.id, s.tripContainers.tripId))
      .where(eq(s.tripContainers.id, containerId))
      .limit(1);
    if (!row) throw new ApiError(404, 'Không tìm thấy số cont');
    await assertTripShipmentAccountingUnlocked(tx, row.tripId);
    assertExpectedUpdatedAt(row.containerUpdatedAt, options.expectedUpdatedAt);
    if (row.tripStatus === 'COMPLETED') {
      throw new ApiError(409, 'Không thể sửa seal của cont trong chuyến đã hoàn thành');
    }

    const existing = await tx.select({ id: s.tripContainerSeals.id })
      .from(s.tripContainerSeals)
      .where(eq(s.tripContainerSeals.tripContainerId, containerId));
    const existingIds = new Set(existing.map(r => r.id));
    await syncContainerSeals(tx, containerId, seals, userId, existingIds);

    const primarySeal = await derivePrimarySealNumber(tx, containerId);
    await tx.update(s.tripContainers)
      .set({ sealNumber: primarySeal, updatedAt: new Date() })
      .where(eq(s.tripContainers.id, containerId));

    // SIL-653 — the driver's corrected/multi seal mirrors onto the lot row
    // (diff-guarded no-op when unchanged). Same bridge as the PATCH path.
    await syncShipmentIdentityFromTripContainers(tx, [containerId]);

    const [container] = await tx.select({
      updatedAt: s.tripContainers.updatedAt,
    })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, containerId))
      .limit(1);

    const sealRows = await tx.select({
      id: s.tripContainerSeals.id,
      tripContainerId: s.tripContainerSeals.tripContainerId,
      sealNumber: s.tripContainerSeals.sealNumber,
      sealType: s.tripContainerSeals.sealType,
      notes: s.tripContainerSeals.notes,
      createdBy: s.tripContainerSeals.createdBy,
      createdAt: s.tripContainerSeals.createdAt,
      updatedAt: s.tripContainerSeals.updatedAt,
    }).from(s.tripContainerSeals)
      .where(eq(s.tripContainerSeals.tripContainerId, containerId))
      .orderBy(s.tripContainerSeals.id);
    return {
      id: containerId,
      updatedAt: container?.updatedAt ?? new Date(),
      seals: sealRows,
    };
  };
  return runInTx(transaction, execute);
}

export async function batchUpsertTripContainers(
  tripId: number,
  userId: number | null,
  containers: Array<{
    id?: number;
    containerTypeId?: number | null;
    containerNumber?: string | null;
    sealNumber?: string | null;
    cargoWeightKg?: string | number | null;
    notes?: string | null;
    seals?: Array<{
      id?: number;
      sealNumber: string;
      sealType?: string | null;
      notes?: string | null;
    }>;
  }>,
  expectedVersion?: number,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const [trip] = await tx.select({
      id: s.trips.id,
      version: s.trips.version,
      deletedAt: s.trips.deletedAt,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip || trip.deletedAt) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (expectedVersion !== undefined && trip.version !== expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    const existing = await tx.select({
      id: s.tripContainers.id,
      sourceShipmentContainerId: s.tripContainers.sourceShipmentContainerId,
    })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId));
    const existingIds = new Set(existing.map(r => r.id));
    const existingById = new Map(existing.map(r => [r.id, r]));
    if (containers.some(container => container.id != null && !existingIds.has(container.id))) {
      throw new ApiError(400, 'Container không thuộc chuyến đi này. Vui lòng tải lại danh sách.');
    }
    const typeIds = [...new Set(containers.flatMap(container => container.containerTypeId == null ? [] : [container.containerTypeId]))];
    if (typeIds.length > 0) {
      const types = await tx.select({ id: s.containerTypes.id, deletedAt: s.containerTypes.deletedAt })
        .from(s.containerTypes).where(inArray(s.containerTypes.id, typeIds)).for('share');
      if (types.length !== typeIds.length || types.some(type => type.deletedAt != null)) {
        throw new ApiError(400, 'Loại container không tồn tại hoặc đã ngừng sử dụng.');
      }
    }
    const incomingIds = new Set(containers.filter(c => c.id).map(c => c.id as number));

    const toDelete = [...existingIds].filter(id => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await tx.delete(s.tripContainers).where(inArray(s.tripContainers.id, toDelete));
    }

    // SIL-655 — link invariant for the batch: loaded after the delete above
    // so a row being replaced does not trip the duplicate law on its old
    // number. `reservedLotContainerIds` covers twin rows inside this batch
    // (they are not in tripRows until inserted).
    const linkCtx = await loadTripContainerLinkContext(tx, tripId);
    const reservedLotContainerIds = new Set<number>();

    const upsertedContainerIds: number[] = [];
    for (const c of containers) {
      const payload = {
        containerTypeId: c.containerTypeId ?? null,
        // Canonical number everywhere: the batch path accepts separator/
        // lowercase input (validation normalizes before checking) and stores
        // the normalized form, mirroring the driver add path — a raw
        // 'temu 1234 586' would otherwise read as a distinct cost-allocation
        // group from its canonical twin. Normalize-empty input clears to null.
        containerNumber: c.containerNumber ? (normalizeContainerNumber(c.containerNumber) || null) : null,
        sealNumber: null,
        cargoWeightKg: c.cargoWeightKg != null ? String(c.cargoWeightKg) : null,
        notes: c.notes ?? null,
        updatedAt: new Date(),
      };
      // SIL-655 — a number on a NEW row, or on an existing UNLINKED row,
      // resolves to the lot's container or 409s. Already-linked rows keep
      // SIL-653 semantics (the bridge mirrors their number onto their lot row).
      const isInsert = !(c.id != null && existingIds.has(c.id));
      const number = payload.containerNumber as string | null;
      let link: TripContainerLinkFields | null = null;
      if (number && (isInsert || existingById.get(c.id as number)!.sourceShipmentContainerId == null)) {
        const decision = decideTripContainerNumberLink(linkCtx, number, isInsert ? null : (c.id as number), reservedLotContainerIds);
        assertTripContainerLinkDecision(decision, number);
        if (decision.kind === 'LINK') {
          reservedLotContainerIds.add(decision.sourceShipmentContainerId);
          link = {
            sourceShipmentId: linkCtx.tripShipmentId as number,
            sourceShipmentContainerId: decision.sourceShipmentContainerId,
            sourceShipmentVersion: linkCtx.shipmentVersion,
          };
        }
      }
      let containerId: number;
      if (c.id && existingIds.has(c.id)) {
        await tx.update(s.tripContainers)
          .set({ ...payload, ...(link ?? {}) })
          .where(eq(s.tripContainers.id, c.id));
        containerId = c.id;
      } else {
        const [inserted] = await tx.insert(s.tripContainers).values({
          tripId,
          createdBy: userId,
          ...payload,
          ...(link ?? {}),
        }).returning({ id: s.tripContainers.id });
        containerId = inserted.id;
      }
      upsertedContainerIds.push(containerId);
    }

    const sealInputs = new Map<number, Array<{
      id?: number; sealNumber: string; sealType?: string | null; notes?: string | null;
    }> | undefined>();
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i];
      const containerId = upsertedContainerIds[i];
      if (c.seals !== undefined) {
        sealInputs.set(containerId, c.seals);
      } else if (c.sealNumber) {
        sealInputs.set(containerId, [{ sealNumber: c.sealNumber }]);
      }
    }

    const containersWithSealInput = [...sealInputs.entries()]
      .filter(([containerId, seals]) => seals !== undefined && existingIds.has(containerId))
      .map(([containerId]) => containerId);
    const existingSealsByContainer = new Map<number, Set<number>>();
    if (containersWithSealInput.length > 0) {
      const existingSealRows = await tx.select({
        id: s.tripContainerSeals.id,
        tripContainerId: s.tripContainerSeals.tripContainerId,
      })
        .from(s.tripContainerSeals)
        .where(inArray(s.tripContainerSeals.tripContainerId, containersWithSealInput));
      for (const row of existingSealRows) {
        const set = existingSealsByContainer.get(row.tripContainerId) ?? new Set<number>();
        set.add(row.id);
        existingSealsByContainer.set(row.tripContainerId, set);
      }
    }

    for (const [containerId, seals] of sealInputs) {
      if (seals === undefined) continue;
      const existingSealIds = existingSealsByContainer.get(containerId) ?? new Set<number>();
      await syncContainerSeals(tx, containerId, seals, userId, existingSealIds);

      const primarySeal = await derivePrimarySealNumber(tx, containerId);
      await tx.update(s.tripContainers)
        .set({ sealNumber: primarySeal, updatedAt: new Date() })
        .where(eq(s.tripContainers.id, containerId));
    }

    if (existingIds.size > 0) {
      for (const containerId of upsertedContainerIds) {
        if (sealInputs.has(containerId)) continue;
        const primarySeal = await derivePrimarySealNumber(tx, containerId);
        await tx.update(s.tripContainers)
          .set({ sealNumber: primarySeal, updatedAt: new Date() })
          .where(eq(s.tripContainers.id, containerId));
      }
    }

    // SIL-653 — the trip-edit batch PUT mirrors number + primary seal onto
    // the lot rows too; non-snapshot (trip-added) rows are skipped inside
    // the bridge, and unchanged values are a diff-guarded no-op.
    await syncShipmentIdentityFromTripContainers(tx, upsertedContainerIds);

    await tx.update(s.trips).set({
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId));

    return listTripContainers(tripId, tx);
  };
  return runInTx(transaction, execute);
}
