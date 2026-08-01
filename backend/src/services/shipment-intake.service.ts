import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { loadClerkShipmentScope } from './clerk-shipment-scope.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SubmitShipmentForDispatchInput {
  shipmentId: number;
  expectedVersion: number;
  idempotencyKey: string;
  actor: AuthUser;
  priority?: 'NORMAL' | 'URGENT';
  vehicleNeededBy?: Date | null;
  operationalNote?: string | null;
}

type SubmitShipmentForDispatchResult = {
  shipment: typeof s.shipments.$inferSelect;
  handoff: typeof s.dispatchHandoffs.$inferSelect;
};

export async function listOperationalSitesForIntake(customerId: number, actor: AuthUser) {
  if (![Role.ADMIN, Role.MANAGER, Role.CLERK].includes(actor.role)) {
    throw new ApiError(403, 'Bạn không có quyền xem điểm vận hành.');
  }
  if (actor.role === Role.CLERK) {
    const scope = await loadClerkShipmentScope(actor.userId);
    if (scope.businessUnitIds.length === 0 || !scope.customerIds.includes(customerId)) {
      throw new ApiError(404, 'Không tìm thấy khách hàng.');
    }
  }
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers)
    .where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt))).limit(1);
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng.');

  return db.select({
    id: s.operationalSites.id,
    customerId: s.operationalSites.customerId,
    code: s.operationalSites.code,
    name: s.operationalSites.name,
    siteType: s.operationalSites.siteType,
    address: s.operationalSites.address,
    googleMapsUrl: s.operationalSites.googleMapsUrl,
    contactName: s.operationalSites.contactName,
    contactPhone: s.operationalSites.contactPhone,
    liftFeeInvoiceName: s.operationalSites.liftFeeInvoiceName,
    liftFeeInvoiceAddress: s.operationalSites.liftFeeInvoiceAddress,
    liftFeeTaxCode: s.operationalSites.liftFeeTaxCode,
    strictRules: s.operationalSites.strictRules,
    version: s.operationalSites.version,
  }).from(s.operationalSites).where(and(
    eq(s.operationalSites.customerId, customerId),
    eq(s.operationalSites.isActive, true),
    isNull(s.operationalSites.deletedAt),
  )).orderBy(s.operationalSites.name);
}

async function assertReferenceIsActive(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
): Promise<void> {
  if (shipment.routeId == null) {
    throw new ApiError(409, 'Vui lòng chọn tuyến đường trước khi gửi điều phối.');
  }
  const [route] = await tx.select({ id: s.routes.id }).from(s.routes)
    .where(and(eq(s.routes.id, shipment.routeId), isNull(s.routes.deletedAt))).limit(1);
  if (!route) throw new ApiError(409, 'Tuyến đường không còn hiệu lực.');

  if (shipment.operationalSiteId == null) throw new ApiError(409, 'Vui lòng chọn nhà máy.');
  const [factory] = await tx.select({ id: s.operationalSites.id }).from(s.operationalSites)
    .where(and(
      eq(s.operationalSites.id, shipment.operationalSiteId),
      eq(s.operationalSites.customerId, shipment.customerId),
      eq(s.operationalSites.siteType, 'FACTORY'),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    )).limit(1);
  if (!factory) throw new ApiError(409, 'Nhà máy không còn hiệu lực hoặc không thuộc khách hàng.');
  if (shipment.cargoMode === 'LCL') {
    if (shipment.pickupWarehouseSiteId == null) throw new ApiError(409, 'Vui lòng chọn kho lấy hàng.');
    const [warehouse] = await tx.select({ id: s.operationalSites.id }).from(s.operationalSites)
      .where(and(
        eq(s.operationalSites.id, shipment.pickupWarehouseSiteId),
        eq(s.operationalSites.customerId, shipment.customerId),
        eq(s.operationalSites.siteType, 'WAREHOUSE'),
        eq(s.operationalSites.isActive, true),
        isNull(s.operationalSites.deletedAt),
      )).limit(1);
    if (!warehouse) throw new ApiError(409, 'Kho lấy hàng không còn hiệu lực hoặc không thuộc khách hàng.');
  }
}

async function assertIntakeReady(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
): Promise<void> {
  if (!shipment.bookingRef?.trim() && !shipment.blNumber?.trim()) {
    throw new ApiError(409, 'Vui lòng nhập Số Bill hoặc Số Booking.');
  }
  if (shipment.cargoMode !== 'FCL' && shipment.cargoMode !== 'LCL') {
    throw new ApiError(409, 'Vui lòng chọn hình thức hàng FCL hoặc LCL.');
  }
  await assertReferenceIsActive(tx, shipment);

  const containers = await tx.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipment.id));
  if (shipment.cargoMode === 'LCL') {
    if (containers.length > 0) throw new ApiError(409, 'Hàng lẻ không được có container giả.');
    if (!shipment.expectedDeliveryDate) throw new ApiError(409, 'Hàng lẻ cần ngày giao dự kiến.');
    if (!shipment.packageType?.trim() || shipment.packageCount == null || shipment.packageCount < 1
      || Number(shipment.cargoWeightKg ?? 0) <= 0 || Number(shipment.cargoVolumeCbm ?? 0) <= 0) {
      throw new ApiError(409, 'Hàng lẻ cần đủ quy cách, số lượng, trọng lượng và thể tích.');
    }
    return;
  }

  if (containers.length === 0) throw new ApiError(409, 'Hàng nguyên container cần ít nhất một container.');
  const incomplete = containers.find((container) => (
    !container.containerNumber?.trim()
    || container.containerTypeId == null
    || !container.shippingLineName?.trim()
    || container.pickupPortId == null
    || container.dropoffPortId == null
  ));
  if (incomplete) throw new ApiError(409, 'Mỗi container cần đủ số container, loại, hãng tàu, cảng nâng và cảng hạ.');
  const containerTypeIds = [...new Set(containers.map((container) => container.containerTypeId)
    .filter((id): id is number => id != null))];
  const activeContainerTypes = await tx.select({ id: s.containerTypes.id }).from(s.containerTypes)
    .where(and(inArray(s.containerTypes.id, containerTypeIds), isNull(s.containerTypes.deletedAt)));
  if (activeContainerTypes.length !== containerTypeIds.length) {
    throw new ApiError(409, 'Loại công-te-nơ không còn hiệu lực.');
  }
  const portIds = [...new Set(containers.flatMap((container) => [
    container.pickupPortId,
    container.dropoffPortId,
  ]).filter((id): id is number => id != null))];
  const activePorts = await tx.select({ id: s.ports.id }).from(s.ports)
    .where(and(inArray(s.ports.id, portIds), isNull(s.ports.deletedAt)));
  if (activePorts.length !== portIds.length) throw new ApiError(409, 'Cảng nâng/hạ không còn hiệu lực.');
}

export async function submitShipmentForDispatch(input: SubmitShipmentForDispatchInput) {
  if (![Role.ADMIN, Role.MANAGER, Role.CLERK].includes(input.actor.role)) {
    throw new ApiError(403, 'Bạn không có quyền gửi lô hàng sang điều phối.');
  }
  // Authorization is evaluated before idempotency replay so a CLERK who has
  // since lost customer/unit scope cannot retrieve an earlier response.
  await db.transaction((tx) => assertActorCanAccessShipment(
    tx,
    input.shipmentId,
    input.actor,
    { write: true },
  ));
  return runIdempotent<SubmitShipmentForDispatchResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_SUBMIT_FOR_DISPATCH,
    idempotencyKey: input.idempotencyKey,
    payload: {
      shipmentId: input.shipmentId,
      expectedVersion: input.expectedVersion,
      priority: input.priority ?? 'NORMAL',
      vehicleNeededBy: input.vehicleNeededBy?.toISOString() ?? null,
      operationalNote: input.operationalNote?.trim() || null,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment',
    getEntityId: (result) => result.shipment.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
      const [shipment] = await tx.select().from(s.shipments)
        .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
        .for('update').limit(1);
      if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
      if (shipment.version !== input.expectedVersion) {
        throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
      }
      if (shipment.status !== 'DRAFT') {
        throw new ApiError(409, 'Chỉ lô hàng nháp mới được gửi sang điều phối.');
      }
      await assertIntakeReady(tx, shipment);

      const nextVersion = shipment.version + 1;
      const now = new Date();
      const [updatedShipment] = await tx.update(s.shipments).set({
        status: 'IN_PROGRESS',
        version: nextVersion,
        updatedBy: input.actor.userId,
        updatedAt: now,
      }).where(and(
        eq(s.shipments.id, shipment.id),
        eq(s.shipments.version, shipment.version),
        eq(s.shipments.status, 'DRAFT'),
      )).returning();
      if (!updatedShipment) throw new ApiError(409, 'Lô hàng đã được gửi bởi người khác.');

      await tx.insert(s.shipmentStatusHistory).values({
        shipmentId: shipment.id,
        fromStatus: 'DRAFT',
        toStatus: 'IN_PROGRESS',
        reason: 'Gửi sang bảng điều phối',
        changedBy: input.actor.userId,
      });
      const [handoff] = await tx.insert(s.dispatchHandoffs).values({
        shipmentId: shipment.id,
        handlerId: null,
        priority: input.priority ?? 'NORMAL',
        vehicleNeededBy: input.vehicleNeededBy ?? null,
        operationalNote: input.operationalNote?.trim() || null,
        status: 'UNSEEN',
        handoffVersion: nextVersion,
        createdBy: input.actor.userId,
      }).returning();

      return { shipment: updatedShipment, handoff };
    },
  });
}
