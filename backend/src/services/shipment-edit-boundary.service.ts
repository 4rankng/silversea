import { NotificationType, Role } from '@tingting/shared';
import { ApiError } from '../errors';
import * as s from '../db/schema';
import { persistNotificationInTx } from './notification.service';
import type { Tx } from './trip-shared';

type ShipmentRow = typeof s.shipments.$inferSelect;
type ShipmentContainerRow = typeof s.shipmentContainers.$inferSelect;

export type ShipmentPlanPatch = {
  customerId?: number;
  routeId?: number | null;
  cargoTypeId?: number | null;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  tradeDirection?: typeof s.shipmentTradeDirectionEnum.enumValues[number] | null;
  cargoMode?: typeof s.shipmentCargoModeEnum.enumValues[number] | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  expectedDeliveryDate?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  operationalNotes?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
};

export type ShipmentContainerDraft = {
  id?: number;
  containerTypeId?: number | null;
  containerNumber?: string | null;
  sealNumber?: string | null;
  cargoWeightKg?: string | number | null;
  shippingLineName?: string | null;
  pickupPortId?: number | null;
  dropoffPortId?: number | null;
  notes?: string | null;
};

type ChangeMode = 'DIRECT' | 'REQUESTED' | 'NOOP';

const POST_DISPATCH_DIRECT_FIELDS = new Set<keyof ShipmentPlanPatch>([
  'bookingRef',
  'blNumber',
  'contactName',
  'contactPhone',
]);

const POST_DISPATCH_REQUEST_FIELDS = new Set<keyof ShipmentPlanPatch>([
  'customerId',
  'routeId',
  'cargoTypeId',
  'responsibleUnitId',
  'tradeDirection',
  'cargoMode',
  'operationalSiteId',
  'pickupWarehouseSiteId',
  'factoryName',
  'shippingLineName',
  'expectedDeliveryDate',
  'customsCutoffAt',
  'closingAt',
  'plannedReturnAt',
  'cargoWeightKg',
  'cargoVolumeCbm',
  'packageCount',
  'packageType',
  'operationalNotes',
  'pickupLocation',
  'deliveryLocation',
]);

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberString(
  value: string | number | null | undefined,
  scale: number,
): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  return num.toFixed(scale);
}

function normalizeTimestampString(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

function normalizeShipmentPlanValue(
  field: keyof ShipmentPlanPatch,
  value: ShipmentPlanPatch[keyof ShipmentPlanPatch],
) {
  switch (field) {
    case 'customerId':
    case 'routeId':
    case 'cargoTypeId':
    case 'responsibleUnitId':
    case 'operationalSiteId':
    case 'pickupWarehouseSiteId':
    case 'packageCount':
      return value ?? null;
    case 'cargoWeightKg':
      return normalizeNumberString(value as string | number | null, 2);
    case 'cargoVolumeCbm':
      return normalizeNumberString(value as string | number | null, 3);
    case 'customsCutoffAt':
    case 'closingAt':
    case 'plannedReturnAt':
      return normalizeTimestampString(value as string | null);
    case 'tradeDirection':
    case 'cargoMode':
      return value ?? null;
    default:
      return normalizeNullableText(value as string | null);
  }
}

function currentShipmentSnapshot(row: ShipmentRow) {
  return {
    customerId: row.customerId,
    routeId: row.routeId ?? null,
    cargoTypeId: row.cargoTypeId ?? null,
    bookingRef: row.bookingRef ?? null,
    blNumber: row.blNumber ?? null,
    tradeDirection: row.tradeDirection ?? null,
    cargoMode: row.cargoMode ?? null,
    operationalSiteId: row.operationalSiteId ?? null,
    pickupWarehouseSiteId: row.pickupWarehouseSiteId ?? null,
    factoryName: row.factoryName ?? null,
    shippingLineName: row.shippingLineName ?? null,
    expectedDeliveryDate: row.expectedDeliveryDate ?? null,
    customsCutoffAt: normalizeTimestampString(row.customsCutoffAt),
    closingAt: normalizeTimestampString(row.closingAt),
    plannedReturnAt: normalizeTimestampString(row.plannedReturnAt),
    cargoWeightKg: normalizeNumberString(row.cargoWeightKg, 2),
    cargoVolumeCbm: normalizeNumberString(row.cargoVolumeCbm, 3),
    packageCount: row.packageCount ?? null,
    packageType: row.packageType ?? null,
    operationalNotes: row.operationalNotes ?? null,
    pickupLocation: row.pickupLocation ?? null,
    deliveryLocation: row.deliveryLocation ?? null,
    contactName: row.contactName ?? null,
    contactPhone: row.contactPhone ?? null,
    responsibleUnitId: row.responsibleUnitId ?? null,
    status: row.status,
    version: row.version,
  };
}

function currentContainerSnapshot(rows: ShipmentContainerRow[]) {
  return rows
    .map((row) => ({
      id: row.id,
      containerTypeId: row.containerTypeId ?? null,
      containerNumber: row.containerNumber ?? null,
      sealNumber: row.sealNumber ?? null,
      cargoWeightKg: row.cargoWeightKg ?? null,
      shippingLineName: row.shippingLineName ?? null,
      pickupPortId: row.pickupPortId ?? null,
      dropoffPortId: row.dropoffPortId ?? null,
      notes: row.notes ?? null,
    }))
    .sort((a, b) => {
      const aKey = `${a.id ?? 0}:${a.containerNumber ?? ''}`;
      const bKey = `${b.id ?? 0}:${b.containerNumber ?? ''}`;
      return aKey.localeCompare(bKey);
    });
}

function requestedContainerSnapshot(rows: ShipmentContainerDraft[]) {
  return rows
    .map((row) => ({
      id: row.id ?? null,
      containerTypeId: row.containerTypeId ?? null,
      containerNumber: normalizeNullableText(row.containerNumber ?? null),
      sealNumber: normalizeNullableText(row.sealNumber ?? null),
      cargoWeightKg: normalizeNumberString(row.cargoWeightKg ?? null, 2),
      notes: normalizeNullableText(row.notes ?? null),
    }))
    .sort((a, b) => {
      const aKey = `${a.id ?? 0}:${a.containerNumber ?? ''}`;
      const bKey = `${b.id ?? 0}:${b.containerNumber ?? ''}`;
      return aKey.localeCompare(bKey);
    });
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function classifyClerkShipmentPatch(
  existing: ShipmentRow,
  patch: ShipmentPlanPatch,
): {
  mode: ChangeMode;
  directPatch: Partial<ShipmentPlanPatch>;
  beforeSnapshot: ReturnType<typeof currentShipmentSnapshot>;
  afterSnapshot: ReturnType<typeof currentShipmentSnapshot>;
  changedFields: Array<keyof ShipmentPlanPatch>;
} {
  const beforeSnapshot = currentShipmentSnapshot(existing);
  const directPatch: Partial<ShipmentPlanPatch> = {};
  const afterSnapshot = { ...beforeSnapshot };
  const changedFields: Array<keyof ShipmentPlanPatch> = [];
  let requested = false;

  const entries = Object.entries(patch) as Array<[keyof ShipmentPlanPatch, ShipmentPlanPatch[keyof ShipmentPlanPatch]]>;
  for (const [field, value] of entries) {
    if (value === undefined) continue;
    const normalizedValue = normalizeShipmentPlanValue(field, value);
    const currentValue = beforeSnapshot[field];
    if (currentValue === normalizedValue) continue;

    changedFields.push(field);
    afterSnapshot[field] = normalizedValue as never;

    if (existing.status === 'DRAFT' || POST_DISPATCH_DIRECT_FIELDS.has(field)) {
      directPatch[field] = normalizedValue as never;
      continue;
    }

    if (POST_DISPATCH_REQUEST_FIELDS.has(field)) {
      requested = true;
      continue;
    }

    directPatch[field] = normalizedValue as never;
  }

  if (changedFields.length === 0) {
    return { mode: 'NOOP', directPatch: {}, beforeSnapshot, afterSnapshot, changedFields };
  }
  if (requested) {
    return { mode: 'REQUESTED', directPatch: {}, beforeSnapshot, afterSnapshot, changedFields };
  }
  return { mode: 'DIRECT', directPatch, beforeSnapshot, afterSnapshot, changedFields };
}

export function classifyClerkContainerChange(
  existing: ShipmentContainerRow[],
  requested: ShipmentContainerDraft[],
): {
  mode: ChangeMode;
  beforeSnapshot: ReturnType<typeof currentContainerSnapshot>;
  afterSnapshot: ReturnType<typeof requestedContainerSnapshot>;
} {
  const beforeSnapshot = currentContainerSnapshot(existing);
  const afterSnapshot = requestedContainerSnapshot(requested);
  if (jsonEqual(beforeSnapshot, afterSnapshot)) {
    return { mode: 'NOOP', beforeSnapshot, afterSnapshot };
  }
  return {
    mode: existing.length === 0 ? 'DIRECT' : 'REQUESTED',
    beforeSnapshot,
    afterSnapshot,
  };
}

function mapUniqueViolation(err: unknown): ApiError | null {
  if (!err || typeof err !== 'object') return null;
  const candidate = err as { code?: string; cause?: { code?: string } };
  if (candidate.code === '23505' || candidate.cause?.code === '23505') {
    return new ApiError(409, 'Lô hàng đã có yêu cầu thay đổi mới hơn. Vui lòng tải lại.');
  }
  return null;
}

export async function createShipmentChangeRequest(
  tx: Tx,
  input: {
    shipment: ShipmentRow;
    sourceVersion: number;
    requestKind: typeof s.shipmentChangeRequestKindEnum.enumValues[number];
    requestedBy: number;
    beforeSnapshot: unknown;
    afterSnapshot: unknown;
  },
): Promise<number> {
  try {
    const [row] = await tx.insert(s.shipmentChangeRequests).values({
      shipmentId: input.shipment.id,
      sourceVersion: input.sourceVersion,
      requestKind: input.requestKind,
      requestedBy: input.requestedBy,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
    }).returning({ id: s.shipmentChangeRequests.id });
    await persistNotificationInTx(tx, {
      type: NotificationType.SHIPMENT_HANDOFF,
      title: 'Có yêu cầu thay đổi kế hoạch lô hàng',
      message: `Lô ${input.shipment.shipmentCode ?? 'chưa có mã'} có thay đổi cần điều vận xem lại`,
      relatedEntityType: 'shipments',
      relatedEntityId: input.shipment.id,
      targetRoles: [Role.ADMIN, Role.MANAGER],
    });
    return row.id;
  } catch (err) {
    const conflict = mapUniqueViolation(err);
    if (conflict) throw conflict;
    throw err;
  }
}

export async function persistChangeRequestDecisionNotification(tx: Tx, input: {
  shipmentId: number;
  shipmentCode: string | null;
  requesterId: number;
  resolution: 'APPLIED' | 'REJECTED';
}): Promise<void> {
  await persistNotificationInTx(tx, {
    type: NotificationType.SHIPMENT_HANDOFF,
    title: input.resolution === 'APPLIED'
      ? 'Yêu cầu thay đổi lô hàng đã được áp dụng'
      : 'Yêu cầu thay đổi lô hàng đã bị từ chối',
    message: input.resolution === 'APPLIED'
      ? `Lô ${input.shipmentCode ?? 'chưa có mã'} đã được cập nhật theo yêu cầu của bạn`
      : `Yêu cầu thay đổi cho lô ${input.shipmentCode ?? 'chưa có mã'} đã bị từ chối`,
    relatedEntityType: 'shipments',
    relatedEntityId: input.shipmentId,
    targetUserId: input.requesterId,
  });
}
