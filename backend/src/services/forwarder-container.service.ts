import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../errors';

type DbOrTx = typeof db | Tx;

export async function derivePrimarySealNumber(
  client: DbOrTx,
  tripContainerId: number,
): Promise<string | null> {
  const [row] = await client.select({ sealNumber: s.tripContainerSeals.sealNumber })
    .from(s.tripContainerSeals)
    .where(eq(s.tripContainerSeals.tripContainerId, tripContainerId))
    .orderBy(s.tripContainerSeals.id)
    .limit(1);
  return row?.sealNumber ?? null;
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
  const initialSeals = data.seals ?? [];

  const [inserted] = await db.insert(s.tripContainers).values({
    tripId: data.tripId,
    containerTypeId: data.containerTypeId ?? null,
    containerNumber: data.containerNumber?.trim() || null,
    sealNumber: null,
    cargoWeightKg: data.cargoWeightKg != null ? String(data.cargoWeightKg) : null,
    notes: data.notes,
    createdBy: data.createdBy,
  }).returning();

  if (initialSeals.length > 0) {
    await db.insert(s.tripContainerSeals).values(
      initialSeals.map(seal => ({
        tripContainerId: inserted.id,
        sealNumber: seal.sealNumber,
        sealType: seal.sealType ?? null,
        notes: seal.notes ?? null,
        createdBy: data.createdBy,
      })),
    );
  }
  const primarySeal = await derivePrimarySealNumber(db, inserted.id);
  if (primarySeal !== null) {
    await db.update(s.tripContainers)
      .set({ sealNumber: primarySeal, updatedAt: new Date() })
      .where(eq(s.tripContainers.id, inserted.id));
  }
  return { ...inserted, sealNumber: primarySeal };
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
) {
  const [row] = await db.select({ id: s.tripContainers.id, tripId: s.tripContainers.tripId })
    .from(s.tripContainers).where(eq(s.tripContainers.id, containerId)).limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy số cont');

  const [trip] = await db.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, row.tripId)).limit(1);
  if (trip?.status === 'LOCKED') {
    throw new ApiError(409, 'Không thể sửa số cont của chuyến đã chốt');
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.containerTypeId !== undefined) set.containerTypeId = patch.containerTypeId ?? null;
  if (patch.containerNumber !== undefined) set.containerNumber = patch.containerNumber?.trim() || null;
  if (patch.sealNumber !== undefined) set.sealNumber = patch.sealNumber ?? null;
  if (patch.cargoWeightKg !== undefined) {
    set.cargoWeightKg = patch.cargoWeightKg != null ? String(patch.cargoWeightKg) : null;
  }
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;

  const hasScalarChanges = Object.keys(set).length > 1;
  const hasSealsToAdd = (patch.addSeals?.length ?? 0) > 0;

  if (!hasScalarChanges && !hasSealsToAdd) {
    return listTripContainers(row.tripId).then(rows => rows.find(r => r.id === containerId));
  }

  if (hasScalarChanges) {
    await db.update(s.tripContainers).set(set).where(eq(s.tripContainers.id, containerId));
  }

  if (hasSealsToAdd) {
    await db.insert(s.tripContainerSeals).values(
      (patch.addSeals ?? []).map(seal => ({
        tripContainerId: containerId,
        sealNumber: seal.sealNumber,
        sealType: seal.sealType ?? null,
        notes: seal.notes ?? null,
        createdBy: patch.userId ?? null,
      })),
    );
    const primarySeal = await derivePrimarySealNumber(db, containerId);
    await db.update(s.tripContainers)
      .set({ sealNumber: primarySeal, updatedAt: new Date() })
      .where(eq(s.tripContainers.id, containerId));
  }

  const rows = await listTripContainers(row.tripId);
  return rows.find(r => r.id === containerId);
}

export async function listTripContainers(tripId: number, tx?: Tx) {
  const client = tx ?? db;
  const rows = await client.select({
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
  const sealRows = await client.select({
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

  const photoRows = await client.select({
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
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      tripId: s.tripContainers.tripId,
      tripStatus: s.trips.status,
    })
      .from(s.tripContainers)
      .leftJoin(s.trips, eq(s.trips.id, s.tripContainers.tripId))
      .where(eq(s.tripContainers.id, containerId))
      .limit(1);
    if (!row) throw new ApiError(404, 'Không tìm thấy số cont');
    if (row.tripStatus === 'LOCKED') {
      throw new ApiError(409, 'Không thể sửa seal của cont trong chuyến đã chốt');
    }

    const existing = await tx.select({ id: s.tripContainerSeals.id })
      .from(s.tripContainerSeals)
      .where(eq(s.tripContainerSeals.tripContainerId, containerId));
    const existingIds = new Set(existing.map(r => r.id));
    const incomingIds = new Set(seals.filter(s2 => s2.id).map(s2 => s2.id as number));

    const toDelete = [...existingIds].filter(id => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await tx.delete(s.tripContainerSeals).where(inArray(s.tripContainerSeals.id, toDelete));
    }

    const toUpdate = seals.filter(s2 => s2.id && existingIds.has(s2.id));
    const toInsert = seals.filter(s2 => !(s2.id && existingIds.has(s2.id)));
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

    const primarySeal = await derivePrimarySealNumber(tx, containerId);
    await tx.update(s.tripContainers)
      .set({ sealNumber: primarySeal, updatedAt: new Date() })
      .where(eq(s.tripContainers.id, containerId));

    return tx.select({
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
  });
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
    const [trip] = await tx.select({
      id: s.trips.id,
      version: s.trips.version,
      deletedAt: s.trips.deletedAt,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip || trip.deletedAt) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (expectedVersion !== undefined && trip.version !== expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    const existing = await tx.select({ id: s.tripContainers.id })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId));
    const existingIds = new Set(existing.map(r => r.id));
    const incomingIds = new Set(containers.filter(c => c.id).map(c => c.id as number));

    const toDelete = [...existingIds].filter(id => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await tx.delete(s.tripContainers).where(inArray(s.tripContainers.id, toDelete));
    }

    const upsertedContainerIds: number[] = [];
    for (const c of containers) {
      const payload = {
        containerTypeId: c.containerTypeId ?? null,
        containerNumber: c.containerNumber?.trim() || null,
        sealNumber: null,
        cargoWeightKg: c.cargoWeightKg != null ? String(c.cargoWeightKg) : null,
        notes: c.notes ?? null,
        updatedAt: new Date(),
      };
      let containerId: number;
      if (c.id && existingIds.has(c.id)) {
        await tx.update(s.tripContainers)
          .set(payload)
          .where(eq(s.tripContainers.id, c.id));
        containerId = c.id;
      } else {
        const [inserted] = await tx.insert(s.tripContainers).values({
          tripId,
          createdBy: userId,
          ...payload,
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
      const incomingSealIds = new Set(seals.filter(x => x.id).map(x => x.id as number));

      const sealsToDelete = [...existingSealIds].filter(id => !incomingSealIds.has(id));
      if (sealsToDelete.length > 0) {
        await tx.delete(s.tripContainerSeals).where(inArray(s.tripContainerSeals.id, sealsToDelete));
      }

      const toUpdate = seals.filter(s2 => s2.id && existingSealIds.has(s2.id));
      const toInsert = seals.filter(s2 => !(s2.id && existingSealIds.has(s2.id)));
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

    await tx.update(s.trips).set({
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId));

    return listTripContainers(tripId, tx);
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}
