import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, localDateInBusinessZone, OperationalSiteType, Role } from '@tingting/shared';
import type { OperationalSiteInput, OperationalSiteUpdateInput } from '@tingting/shared';

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import type {
  ShipmentDeclarationScopeValue,
  ShipmentDocumentTypeValue,
} from './shipment-types';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SubmitShipmentForDispatchInput {
  shipmentId: number;
  expectedVersion: number;
  idempotencyKey: string;
  actor: AuthUser;
  priority?: 'NORMAL' | 'URGENT';
  vehicleNeededBy?: Date | null;
  operationalNote?: string | null;
  carrierAllocations?: Array<{
    carrierType: 'OWN' | 'EXTERNAL';
    externalCarrierId?: number | null;
    count20: number;
    count40: number;
    appointmentDate?: string | null;
  }>;
}

export interface AssignShipmentCarriersCommand {
  shipmentId: number;
  expectedVersion: number;
  actor: AuthUser;
  carrierAllocations: NonNullable<SubmitShipmentForDispatchInput['carrierAllocations']>;
  /**
   * Dispatch master-plan mode: under-allocation is allowed (docx rule B only
   * forbids overflow). Containers beyond the allocated totals keep their
   * existing planned carrier cleared.
   */
  allowPartial?: boolean;
  transaction?: Tx;
}

function containerSizeBucket(code: string, name: string): 20 | 40 | null {
  const normalized = `${code} ${name}`.trim().toUpperCase();
  if (/^20(?:\D|$)/.test(normalized)) return 20;
  if (/^40(?:\D|$)/.test(normalized)) return 40;
  return null;
}

async function persistCarrierAllocations(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
  actorId: number,
  allocations: NonNullable<SubmitShipmentForDispatchInput['carrierAllocations']>,
  allowPartial = false,
) {
  const fulfillmentRows = await ensureShipmentFulfillmentsInTx(tx, {
    shipmentId: shipment.id,
    actorId,
    allowClerkIntake: true,
  });
  if (shipment.cargoMode === CARGO_MODE.LCL) {
    // 20260916_5 ruling (a): an LCL lô is ONE allocation unit — one carrier
    // covers the whole lô (per-carrier groups still apply); container-bucket
    // arithmetic does not apply to a lô without its own container demand.
    const totalUnits = allocations.reduce((sum, row) => sum + row.count20 + row.count40, 0);
    if (totalUnits > 1) {
      throw new ApiError(409, `Lô LCL chỉ nhận đúng 1 nhà xe (đang gán ${totalUnits}).`);
    }
    if (!allowPartial && totalUnits !== 1) {
      throw new ApiError(409, 'Lô LCL cần đúng 1 phân bổ nhà xe.');
    }
    const lclFulfillment = fulfillmentRows.find((row) => row.shipmentContainerId == null)
      ?? fulfillmentRows[0];
    if (!lclFulfillment) throw new ApiError(409, 'Không tìm thấy phân bổ nhà xe cho lô LCL.');
    const lclAlloc = allocations[0];
    if (lclAlloc) {
      await tx.update(s.shipmentFulfillments).set({
        plannedCarrierType: lclAlloc.carrierType,
        plannedExternalCarrierId: lclAlloc.carrierType === 'EXTERNAL' ? lclAlloc.externalCarrierId ?? null : null,
        version: sql`${s.shipmentFulfillments.version} + 1`,
        updatedAt: new Date(),
      }).where(eq(s.shipmentFulfillments.id, lclFulfillment.id));
    }
    return fulfillmentRows;
  }

  const hasDates = allocations.some((row) => Boolean(row.appointmentDate));
  const duplicateKeys = allocations.map((row) => {
    const carrier = row.carrierType === 'OWN'
      ? 'OWN'
      : `EXTERNAL:${row.externalCarrierId ?? ''}`;
    return hasDates ? `${row.appointmentDate ?? ''}:${carrier}` : carrier;
  });
  if (new Set(duplicateKeys).size !== duplicateKeys.length) {
    throw new ApiError(409, hasDates ? 'Mỗi nhà xe chỉ được xuất hiện một lần trong cùng một ngày.' : 'Mỗi nhà xe chỉ được xuất hiện một lần.');
  }
  const externalCarrierIds = allocations
    .filter((row) => row.carrierType === 'EXTERNAL')
    .map((row) => row.externalCarrierId)
    .filter((id): id is number => id != null);
  if (externalCarrierIds.length > 0) {
    const activeCarriers = await tx.select({ id: s.customers.id }).from(s.customers)
      .where(and(
        inArray(s.customers.id, externalCarrierIds),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ));
    if (new Set(activeCarriers.map((row) => row.id)).size !== new Set(externalCarrierIds).size) {
      throw new ApiError(409, 'Nhà xe không còn hoạt động hoặc không hợp lệ.');
    }
  }

  const containerRows = await tx.select({
    id: s.shipmentContainers.id,
    typeCode: s.containerTypes.code,
    typeName: s.containerTypes.name,
    customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
  }).from(s.shipmentContainers)
    .innerJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .where(and(
      eq(s.shipmentContainers.shipmentId, shipment.id),
      isNull(s.containerTypes.deletedAt),
    ))
    .orderBy(asc(s.shipmentContainers.id));
  const bucket20: number[] = [];
  const bucket40: number[] = [];
  const bucket20ByDate = new Map<string, number[]>();
  const bucket40ByDate = new Map<string, number[]>();

  for (const container of containerRows) {
    const bucket = containerSizeBucket(container.typeCode, container.typeName);
    const dateKey = container.customerAppointmentAt
      ? (localDateInBusinessZone(container.customerAppointmentAt) ?? '__UNSCHEDULED__')
      : '__UNSCHEDULED__';
    if (bucket === 20) {
      bucket20.push(container.id);
      const list = bucket20ByDate.get(dateKey) ?? [];
      list.push(container.id);
      bucket20ByDate.set(dateKey, list);
    } else if (bucket === 40) {
      bucket40.push(container.id);
      const list = bucket40ByDate.get(dateKey) ?? [];
      list.push(container.id);
      bucket40ByDate.set(dateKey, list);
    } else {
      throw new ApiError(409, `Loại container ${container.typeName} chưa được hỗ trợ gán nhà xe 20/40.`);
    }
  }

  const total20 = allocations.reduce((sum, row) => sum + row.count20, 0);
  const total40 = allocations.reduce((sum, row) => sum + row.count40, 0);
  if (total20 > bucket20.length || total40 > bucket40.length) {
    throw new ApiError(
      409,
      `Phân bổ vượt số lượng container: 20' ${total20}/${bucket20.length}, 40' ${total40}/${bucket40.length}.`,
    );
  }
  if (!allowPartial && (total20 !== bucket20.length || total40 !== bucket40.length)) {
    throw new ApiError(
      409,
      `Phân bổ nhà xe chưa khớp: 20' ${total20}/${bucket20.length}, 40' ${total40}/${bucket40.length}.`,
    );
  }

  if (hasDates) {
    const allocationsByDate = new Map<string, { total20: number; total40: number }>();
    for (const alloc of allocations) {
      const dateKey = alloc.appointmentDate?.trim() || '__UNSCHEDULED__';
      const cur = allocationsByDate.get(dateKey) ?? { total20: 0, total40: 0 };
      cur.total20 += alloc.count20;
      cur.total40 += alloc.count40;
      allocationsByDate.set(dateKey, cur);
    }
    for (const [dateKey, dateTotals] of allocationsByDate) {
      const demand20 = (bucket20ByDate.get(dateKey) ?? []).length;
      const demand40 = (bucket40ByDate.get(dateKey) ?? []).length;
      if (dateTotals.total20 > demand20 || dateTotals.total40 > demand40) {
        const label = dateKey === '__UNSCHEDULED__' ? 'chưa chốt ngày' : `ngày ${dateKey}`;
        throw new ApiError(
          409,
          `Phân bổ vượt số lượng container ${label}: 20' ${dateTotals.total20}/${demand20}, 40' ${dateTotals.total40}/${demand40}.`,
        );
      }
    }
  }

  const assignmentByContainer = new Map<number, { carrierType: 'OWN' | 'EXTERNAL' | null; externalCarrierId: number | null }>();
  if (hasDates) {
    const index20ByDate = new Map<string, number>();
    const index40ByDate = new Map<string, number>();
    for (const allocation of allocations) {
      if (allocation.count20 < 0 || allocation.count40 < 0 || !Number.isInteger(allocation.count20) || !Number.isInteger(allocation.count40)) {
        throw new ApiError(400, 'Số lượng container phân bổ phải là số nguyên không âm.');
      }
      const carrier = {
        carrierType: allocation.carrierType,
        externalCarrierId: allocation.carrierType === 'EXTERNAL' ? allocation.externalCarrierId ?? null : null,
      };
      const dateKey = allocation.appointmentDate?.trim() || '__UNSCHEDULED__';
      const dateBucket20 = bucket20ByDate.get(dateKey) ?? [];
      const dateBucket40 = bucket40ByDate.get(dateKey) ?? [];
      let idx20 = index20ByDate.get(dateKey) ?? 0;
      let idx40 = index40ByDate.get(dateKey) ?? 0;
      for (let count = 0; count < allocation.count20; count += 1) {
        if (idx20 < dateBucket20.length) {
          assignmentByContainer.set(dateBucket20[idx20++]!, carrier);
        }
      }
      for (let count = 0; count < allocation.count40; count += 1) {
        if (idx40 < dateBucket40.length) {
          assignmentByContainer.set(dateBucket40[idx40++]!, carrier);
        }
      }
      index20ByDate.set(dateKey, idx20);
      index40ByDate.set(dateKey, idx40);
    }
  } else {
    let index20 = 0;
    let index40 = 0;
    for (const allocation of allocations) {
      if (allocation.count20 < 0 || allocation.count40 < 0 || !Number.isInteger(allocation.count20) || !Number.isInteger(allocation.count40)) {
        throw new ApiError(400, 'Số lượng container phân bổ phải là số nguyên không âm.');
      }
      const carrier = {
        carrierType: allocation.carrierType,
        externalCarrierId: allocation.carrierType === 'EXTERNAL' ? allocation.externalCarrierId ?? null : null,
      };
      for (let count = 0; count < allocation.count20; count += 1) {
        assignmentByContainer.set(bucket20[index20++]!, carrier);
      }
      for (let count = 0; count < allocation.count40; count += 1) {
        assignmentByContainer.set(bucket40[index40++]!, carrier);
      }
    }
  }

  if (!allowPartial && assignmentByContainer.size !== containerRows.length) {
    throw new ApiError(409, 'Mỗi container phải được gán đúng một nhà xe.');
  }
  // Partial mode: containers beyond the allocated totals get no carrier —
  // clear any stale planned carrier so coverage always mirrors the request.
  if (allowPartial) {
    for (const containerId of [...bucket20, ...bucket40]) {
      if (!assignmentByContainer.has(containerId)) {
        assignmentByContainer.set(containerId, { carrierType: null, externalCarrierId: null });
      }
    }
  }

  for (const fulfillment of fulfillmentRows) {
    if (fulfillment.shipmentContainerId == null) continue;
    const assignment = assignmentByContainer.get(fulfillment.shipmentContainerId);
    if (!assignment) throw new ApiError(409, 'Không tìm thấy phân bổ nhà xe cho container.');
    await tx.update(s.shipmentFulfillments).set({
      plannedCarrierType: assignment.carrierType,
      plannedExternalCarrierId: assignment.externalCarrierId,
      version: sql`${s.shipmentFulfillments.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
  }
  return fulfillmentRows;
}

type SubmitShipmentForDispatchResult = {
  shipment: typeof s.shipments.$inferSelect;
  handoff: typeof s.dispatchHandoffs.$inferSelect;
};

export async function listOperationalSitesForIntake(customerId: number, actor: AuthUser) {
  if (![Role.ADMIN, Role.MANAGER, Role.CUS, Role.ACCOUNTANT, Role.DISPATCHER].includes(actor.role)) {
    throw new ApiError(403, 'Bạn không có quyền xem điểm vận hành.');
  }
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers)
    .where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt))).limit(1);
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng.');

  const sites = await db.select({
    id: s.operationalSites.id,
    customerId: s.operationalSites.customerId,
    code: s.operationalSites.code,
    name: s.operationalSites.name,
    shortName: s.operationalSites.shortName,
    siteType: s.operationalSites.siteType,
    routeId: s.operationalSites.routeId,
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
  )).orderBy(s.operationalSites.shortName, s.operationalSites.name);

  if (actor.role === Role.ACCOUNTANT) {
    return sites.map((site) => ({
      id: site.id,
      customerId: site.customerId,
      code: site.code,
      name: site.name,
      shortName: site.shortName,
      siteType: site.siteType,
      routeId: site.routeId,
      address: site.address,
      liftFeeInvoiceName: site.liftFeeInvoiceName,
      liftFeeInvoiceAddress: site.liftFeeInvoiceAddress,
      liftFeeTaxCode: site.liftFeeTaxCode,
      version: site.version,
    }));
  }

  return sites;
}

/**
 * Create a customer-owned operational site (factory or warehouse) from the
 * clerk intake form. Mirrors the RBAC + CLERK-scope rules of
 * {@link listOperationalSitesForIntake} and the insert logic of the
 * master-data importer, so the REST path and the Excel import path cannot
 * drift apart. The (customerId, code) partial unique index makes this an
 * upsert-by-code: re-submitting the same code updates the live master row
 * instead of erroring, matching how the importer reconciles workbooks.
 */
export async function createOperationalSiteForIntake(
  input: OperationalSiteInput,
  actor: AuthUser,
) {
  if (![Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER].includes(actor.role)) {
    throw new ApiError(403, 'Bạn không có quyền thêm điểm vận hành.');
  }
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers)
    .where(and(eq(s.customers.id, input.customerId), isNull(s.customers.deletedAt))).limit(1);
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng.');

  return db.transaction(async (tx) => {
    if (input.routeId != null) {
      const [route] = await tx.select({ id: s.routes.id }).from(s.routes)
        .where(and(eq(s.routes.id, input.routeId), isNull(s.routes.deletedAt))).limit(1);
      if (!route) throw new ApiError(409, 'Tuyến đường không còn hiệu lực.');
    }
    const [existing] = await tx.select().from(s.operationalSites).where(and(
      eq(s.operationalSites.customerId, input.customerId),
      eq(s.operationalSites.code, input.code),
      isNull(s.operationalSites.deletedAt),
    )).limit(1);
    if (existing && !existing.isActive) {
      throw new ApiError(409, 'Điểm vận hành đang ngưng hoạt động; không tự động kích hoạt lại.');
    }
    const values = {
      customerId: input.customerId,
      code: input.code,
      name: input.name,
      shortName: input.shortName?.trim() || existing?.shortName.trim() || input.name.trim(),
      siteType: input.siteType,
      routeId: input.siteType === 'FACTORY' ? input.routeId : null,
      address: input.address,
      googleMapsUrl: input.googleMapsUrl ?? null,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      liftFeeInvoiceName: input.liftFeeInvoiceName ?? null,
      liftFeeInvoiceAddress: input.liftFeeInvoiceAddress ?? null,
      liftFeeTaxCode: input.liftFeeTaxCode ?? null,
      strictRules: input.strictRules ?? null,
      isActive: input.isActive ?? true,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    };
    const [row] = existing
      ? await tx.update(s.operationalSites)
        .set({ ...values, version: sql`${s.operationalSites.version} + 1` })
        .where(eq(s.operationalSites.id, existing.id))
        .returning()
      : await tx.insert(s.operationalSites)
        .values({ ...values, createdBy: actor.userId })
        .returning();
    if (!row) throw new Error('Không thể lưu điểm vận hành.');
    return {
      id: row.id,
      customerId: row.customerId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      siteType: row.siteType,
      routeId: row.routeId,
      address: row.address,
      googleMapsUrl: row.googleMapsUrl,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      liftFeeInvoiceName: row.liftFeeInvoiceName,
      liftFeeInvoiceAddress: row.liftFeeInvoiceAddress,
      liftFeeTaxCode: row.liftFeeTaxCode,
      strictRules: row.strictRules,
      version: row.version,
    };
  });
}

/** Narrow the enum so the intake form only offers the two site types it understands. */
export function isValidIntakeSiteType(value: string): value is OperationalSiteType {
  return value === OperationalSiteType.FACTORY || value === OperationalSiteType.WAREHOUSE;
}

/**
 * Master-data view of every live customer-owned site (factory or warehouse)
 * across all customers, for the ADMIN/MANAGER "Nhà máy" config surface.
 * Unlike the intake projection this includes deactivated rows (flagged via
 * isActive) so an admin can see and re-enable them — intake lists stay
 * active-only.
 */
export async function listOperationalSitesForAdmin(actor: AuthUser) {
  if (![Role.ADMIN, Role.MANAGER].includes(actor.role)) {
    throw new ApiError(403, 'Chỉ quản trị viên hoặc giám đốc được xem danh mục nhà máy.');
  }
  return db.select({
    id: s.operationalSites.id,
    customerId: s.operationalSites.customerId,
    customerName: sql<string>`COALESCE(NULLIF(${s.customers.shortName}, ''), ${s.customers.name})`,
    code: s.operationalSites.code,
    name: s.operationalSites.name,
    shortName: s.operationalSites.shortName,
    siteType: s.operationalSites.siteType,
    routeId: s.operationalSites.routeId,
    routeName: s.routes.name,
    address: s.operationalSites.address,
    googleMapsUrl: s.operationalSites.googleMapsUrl,
    contactName: s.operationalSites.contactName,
    contactPhone: s.operationalSites.contactPhone,
    liftFeeInvoiceName: s.operationalSites.liftFeeInvoiceName,
    liftFeeInvoiceAddress: s.operationalSites.liftFeeInvoiceAddress,
    liftFeeTaxCode: s.operationalSites.liftFeeTaxCode,
    strictRules: s.operationalSites.strictRules,
    isActive: s.operationalSites.isActive,
    version: s.operationalSites.version,
    updatedAt: s.operationalSites.updatedAt,
  }).from(s.operationalSites)
    .innerJoin(s.customers, eq(s.customers.id, s.operationalSites.customerId))
    .leftJoin(s.routes, eq(s.routes.id, s.operationalSites.routeId))
    .where(isNull(s.operationalSites.deletedAt))
    .orderBy(s.customers.shortName, s.operationalSites.name);
}

/**
 * Version-checked partial update of a customer-owned site from the admin
 * config surface. Identity (customerId, code, siteType) is immutable here;
 * deactivation is a flag toggle, never a hard delete, so historical
 * shipments keep pointing at the row. The FACTORY↔route invariant is
 * re-checked against the merged row because a zod schema cannot see it.
 */
export async function updateOperationalSiteForAdmin(
  siteId: number,
  input: OperationalSiteUpdateInput,
  actor: AuthUser,
) {
  if (![Role.ADMIN, Role.MANAGER].includes(actor.role)) {
    throw new ApiError(403, 'Chỉ quản trị viên hoặc giám đốc được chỉnh sửa danh mục nhà máy.');
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.operationalSites)
      .where(and(eq(s.operationalSites.id, siteId), isNull(s.operationalSites.deletedAt)))
      .limit(1);
    if (!row) throw new ApiError(404, 'Không tìm thấy nhà máy / kho.');

    if (row.version !== input.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu vừa bị người khác thay đổi. Tải lại trang và thử lại.');
    }

    const merged = {
      routeId: 'routeId' in input ? input.routeId ?? null : row.routeId,
      name: input.name ?? row.name,
    };
    if (row.siteType === OperationalSiteType.FACTORY && merged.routeId == null) {
      throw new ApiError(409, 'Nhà máy cần được liên kết với một tuyến đường.');
    }
    if (row.siteType === OperationalSiteType.WAREHOUSE && merged.routeId != null) {
      throw new ApiError(409, 'Kho lấy hàng không dùng tuyến đường của nhà máy.');
    }
    if (merged.routeId != null && merged.routeId !== row.routeId) {
      const [route] = await tx.select({ id: s.routes.id }).from(s.routes)
        .where(and(eq(s.routes.id, merged.routeId), isNull(s.routes.deletedAt))).limit(1);
      if (!route) throw new ApiError(409, 'Tuyến đường không còn hiệu lực.');
    }

    const [updated] = await tx.update(s.operationalSites).set({
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.shortName != null ? { shortName: input.shortName } : {}),
      ...('routeId' in input ? { routeId: merged.routeId } : {}),
      ...(input.address != null ? { address: input.address } : {}),
      ...(input.googleMapsUrl !== undefined ? { googleMapsUrl: input.googleMapsUrl } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      ...(input.liftFeeInvoiceName !== undefined ? { liftFeeInvoiceName: input.liftFeeInvoiceName } : {}),
      ...(input.liftFeeInvoiceAddress !== undefined ? { liftFeeInvoiceAddress: input.liftFeeInvoiceAddress } : {}),
      ...(input.liftFeeTaxCode !== undefined ? { liftFeeTaxCode: input.liftFeeTaxCode } : {}),
      ...(input.strictRules !== undefined ? { strictRules: input.strictRules } : {}),
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
      version: sql`${s.operationalSites.version} + 1`,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.operationalSites.id, siteId)).returning();
    if (!updated) throw new Error('Không thể lưu nhà máy / kho.');
    return {
      id: updated.id,
      customerId: updated.customerId,
      code: updated.code,
      name: updated.name,
      shortName: updated.shortName,
      siteType: updated.siteType,
      routeId: updated.routeId,
      address: updated.address,
      googleMapsUrl: updated.googleMapsUrl,
      contactName: updated.contactName,
      contactPhone: updated.contactPhone,
      liftFeeInvoiceName: updated.liftFeeInvoiceName,
      liftFeeInvoiceAddress: updated.liftFeeInvoiceAddress,
      liftFeeTaxCode: updated.liftFeeTaxCode,
      strictRules: updated.strictRules,
      isActive: updated.isActive,
      version: updated.version,
    };
  });
}

async function assertReferenceIsActive(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
): Promise<void> {
  // LCL owns one route on the shipment. FCL routes are validated per
  // container below so a multi-container lot can legitimately use routes A/B.
  if (shipment.cargoMode === CARGO_MODE.LCL) {
    if (shipment.routeId == null) {
      throw new ApiError(409, 'Vui lòng chọn tuyến đường trước khi gửi điều phối.');
    }
    const [route] = await tx.select({ id: s.routes.id }).from(s.routes)
      .where(and(eq(s.routes.id, shipment.routeId), isNull(s.routes.deletedAt))).limit(1);
    if (!route) throw new ApiError(409, 'Tuyến đường không còn hiệu lực.');
  }

  // A factory is common optional intake detail for both cargo modes. Validate it
  // when supplied, but do not make it a dispatch prerequisite.
  if (shipment.operationalSiteId != null) {
    // Ad-hoc orders (null customer) may still pick a catalog factory: the
    // customer-scope equality cannot apply, but FACTORY/active still must.
    const [factory] = await tx.select({ id: s.operationalSites.id }).from(s.operationalSites)
      .where(and(
        eq(s.operationalSites.id, shipment.operationalSiteId),
        ...(shipment.customerId != null
          ? [eq(s.operationalSites.customerId, shipment.customerId)]
          : []),
        eq(s.operationalSites.siteType, 'FACTORY'),
        eq(s.operationalSites.isActive, true),
        isNull(s.operationalSites.deletedAt),
      )).limit(1);
    if (!factory) throw new ApiError(409, 'Nhà máy không còn hiệu lực hoặc không thuộc khách hàng.');
  }
  if (shipment.cargoMode === CARGO_MODE.LCL) {
    if (shipment.pickupWarehouseSiteId == null) throw new ApiError(409, 'Vui lòng chọn kho lấy hàng.');
    const [warehouse] = await tx.select({ id: s.operationalSites.id }).from(s.operationalSites)
      .where(and(
        eq(s.operationalSites.id, shipment.pickupWarehouseSiteId),
        ...(shipment.customerId != null
          ? [eq(s.operationalSites.customerId, shipment.customerId)]
          : []),
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
  if (shipment.tradeDirection !== 'IMPORT' && shipment.tradeDirection !== 'EXPORT') {
    throw new ApiError(409, 'Vui lòng chọn hình thức nhập khẩu hoặc xuất khẩu.');
  }
  if (shipment.cargoMode !== CARGO_MODE.FCL && shipment.cargoMode !== CARGO_MODE.LCL) {
    throw new ApiError(409, 'Vui lòng chọn hình thức hàng FCL hoặc LCL.');
  }
  await assertReferenceIsActive(tx, shipment);

  const containers = await tx.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipment.id));
  if (shipment.cargoMode === CARGO_MODE.LCL) {
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
    container.containerTypeId == null
    || container.operationalSiteId == null
    || container.routeId == null
    || container.pickupPortId == null
    || container.dropoffPortId == null
  ));
  if (incomplete) throw new ApiError(409, 'Mỗi container cần đủ nhà máy, tuyến đường, loại, cảng nâng và cảng hạ.');
  const routeIds = [...new Set(containers.map((container) => container.routeId)
    .filter((id): id is number => id != null))];
  const activeRoutes = await tx.select({ id: s.routes.id }).from(s.routes)
    .where(and(inArray(s.routes.id, routeIds), isNull(s.routes.deletedAt)));
  if (activeRoutes.length !== routeIds.length) throw new ApiError(409, 'Tuyến đường của container không còn hiệu lực.');
  const factoryIds = [...new Set(containers.map((container) => container.operationalSiteId)
    .filter((id): id is number => id != null))];
  const factories = await tx.select({ id: s.operationalSites.id }).from(s.operationalSites)
    .where(and(
      inArray(s.operationalSites.id, factoryIds),
      ...(shipment.customerId != null
        ? [eq(s.operationalSites.customerId, shipment.customerId)]
        : []),
      eq(s.operationalSites.siteType, 'FACTORY'),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    ));
  if (factories.length !== factoryIds.length) {
    throw new ApiError(409, 'Nhà máy của container không còn hiệu lực hoặc không thuộc khách hàng của lô hàng.');
  }
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
  if (![Role.ADMIN, Role.MANAGER, Role.CUS].includes(input.actor.role)) {
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
      carrierAllocations: input.carrierAllocations ?? [],
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
      await assertShipmentAccountingUnlocked(tx, shipment.id);
      if (shipment.version !== input.expectedVersion) {
        throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
      }
      if (canonicalShipmentStatus(shipment.status) !== 'READY_FOR_DISPATCH') {
        throw new ApiError(409, 'Cần nhập ngày đóng hoặc trả hàng trước khi gửi điều phối.');
      }
      await assertIntakeReady(tx, shipment);

      const carrierAllocations = input.carrierAllocations ?? [];
      if (carrierAllocations.length > 0) {
        await persistCarrierAllocations(tx, shipment, input.actor.userId, carrierAllocations);
      } else {
        await ensureShipmentFulfillmentsInTx(tx, {
          shipmentId: shipment.id,
          actorId: input.actor.userId,
          allowClerkIntake: true,
        });
      }

      const nextVersion = shipment.version + 1;
      const now = new Date();
      const [updatedShipment] = await tx.update(s.shipments).set({
        version: nextVersion,
        updatedBy: input.actor.userId,
        updatedAt: now,
      }).where(and(
        eq(s.shipments.id, shipment.id),
        eq(s.shipments.version, shipment.version),
        eq(s.shipments.status, shipment.status ?? 'READY_FOR_DISPATCH'),
      )).returning();
      if (!updatedShipment) throw new ApiError(409, 'Lô hàng đã được gửi bởi người khác.');
      const [existingHandoff] = await tx.select().from(s.dispatchHandoffs)
        .where(and(
          eq(s.dispatchHandoffs.shipmentId, shipment.id),
          sql`${s.dispatchHandoffs.status} <> 'REJECTED'`,
        ))
        .orderBy(sql`${s.dispatchHandoffs.id} DESC`)
        .limit(1)
        .for('update');
      const [handoff] = existingHandoff
        ? await tx.update(s.dispatchHandoffs).set({
          priority: input.priority ?? existingHandoff.priority,
          vehicleNeededBy: input.vehicleNeededBy ?? existingHandoff.vehicleNeededBy,
          operationalNote: input.operationalNote?.trim() || existingHandoff.operationalNote,
          handoffVersion: nextVersion,
          version: existingHandoff.version + 1,
          updatedAt: now,
        }).where(eq(s.dispatchHandoffs.id, existingHandoff.id)).returning()
        : await tx.insert(s.dispatchHandoffs).values({
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

export async function assignShipmentCarriers(input: AssignShipmentCarriersCommand) {
  if (![Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER].includes(input.actor.role)) {
    throw new ApiError(403, 'Bạn không có quyền gán nhà xe cho lô hàng.');
  }
  const execute = async (tx: Tx) => {
    await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
    await assertShipmentAccountingUnlocked(tx, shipment.id);
    if (shipment.version !== input.expectedVersion) {
      throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
    }
    if (canonicalShipmentStatus(shipment.status) !== 'READY_FOR_DISPATCH') {
      throw new ApiError(409, 'Chỉ được gán lại nhà xe khi lô đang sẵn sàng điều xe.');
    }
    const [issuedOrder] = await tx.select({ id: s.trips.id }).from(s.trips)
      .where(and(
        eq(s.trips.shipmentId, shipment.id),
        isNull(s.trips.deletedAt),
      ))
      .limit(1);
    if (issuedOrder) {
      throw new ApiError(409, 'Không thể đổi nhà xe sau khi đã phát hành lệnh điều xe.');
    }

    await persistCarrierAllocations(tx, shipment, input.actor.userId, input.carrierAllocations, input.allowPartial === true);
    const nextVersion = shipment.version + 1;
    const now = new Date();
    const [updatedShipment] = await tx.update(s.shipments).set({
      version: nextVersion,
      updatedBy: input.actor.userId,
      updatedAt: now,
    }).where(and(
      eq(s.shipments.id, shipment.id),
      eq(s.shipments.version, shipment.version),
    )).returning();
    if (!updatedShipment) throw new ApiError(409, 'Lô hàng đã được cập nhật bởi người khác.');
    await tx.update(s.dispatchHandoffs).set({
      handoffVersion: nextVersion,
      version: sql`${s.dispatchHandoffs.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(s.dispatchHandoffs.shipmentId, shipment.id),
      inArray(s.dispatchHandoffs.status, ['UNSEEN', 'SEEN', 'ACCEPTED']),
    ));
    const assignments = await tx.select({
      fulfillmentId: s.shipmentFulfillments.id,
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      version: s.shipmentFulfillments.version,
    }).from(s.shipmentFulfillments).where(and(
      eq(s.shipmentFulfillments.shipmentId, shipment.id),
      isNull(s.shipmentFulfillments.canceledAt),
    )).orderBy(asc(s.shipmentFulfillments.id));
    return { shipment: updatedShipment, assignments };
  };
  return runInTx(input.transaction, execute);
}


// ─── Intake-phase guard helpers (moved from shipment.service.ts) ────────────
//
// These guards are shared by the shipment mutation surface (main service),
// container reconcile, and document attach flows, so they live in this leaf
// module to keep the dependency direction one-way: features -> intake guards.

export function hasDispatchDate(shipment: Pick<typeof s.shipments.$inferSelect, 'expectedDeliveryDate' | 'closingAt' | 'plannedReturnAt'>): boolean {
  return shipment.expectedDeliveryDate != null || shipment.closingAt != null || shipment.plannedReturnAt != null;
}

export function isDirectlyEditableIntakeStatus(status: string | null | undefined): boolean {
  const canonical = canonicalShipmentStatus(status);
  return canonical === 'PENDING_DATE' || canonical === 'READY_FOR_DISPATCH';
}

export function assertDispatcherCanMutateShipmentIntake(
  actor: AuthUser | undefined,
  status: string | null | undefined,
): void {
  if (actor?.role === Role.DISPATCHER && !isDirectlyEditableIntakeStatus(status)) {
    throw new ApiError(403, 'Điều vận chỉ được cập nhật lô hàng trong giai đoạn tiếp nhận.');
  }
}

export async function ensureReadyShipmentHandoff(
  tx: Tx,
  shipment: Pick<typeof s.shipments.$inferSelect, 'id' | 'version' | 'expectedDeliveryDate' | 'closingAt' | 'plannedReturnAt'>,
  createdBy: number | null,
) {
  if (!hasDispatchDate(shipment)) return;
  const [existing] = await tx.select({ id: s.dispatchHandoffs.id })
    .from(s.dispatchHandoffs)
    .where(and(
      eq(s.dispatchHandoffs.shipmentId, shipment.id),
      sql`${s.dispatchHandoffs.status} <> 'REJECTED'`,
    ))
    .orderBy(desc(s.dispatchHandoffs.id))
    .limit(1);
  if (existing) return;
  await tx.insert(s.dispatchHandoffs).values({
    shipmentId: shipment.id,
    handoffVersion: shipment.version,
    createdBy,
    status: 'UNSEEN',
  });
}


export function normalizeShipmentDocumentType(input: unknown): ShipmentDocumentTypeValue | null {
  if (typeof input !== 'string') return null;
  switch (input.trim().toUpperCase()) {
    case 'BOOKING':
      return 'BOOKING';
    case 'BL':
      return 'BL';
    case 'DO':
      return 'DO';
    case 'DECLARATION':
      return 'DECLARATION';
    case 'OTHER':
      return 'OTHER';
    default:
      return null;
  }
}

export function normalizeShipmentDeclarationScope(input: unknown): ShipmentDeclarationScopeValue | null {
  if (typeof input !== 'string') return null;
  switch (input.trim().toUpperCase()) {
    case 'SINGLE':
      return 'SINGLE';
    case 'SHARED':
      return 'SHARED';
    default:
      return null;
  }
}
