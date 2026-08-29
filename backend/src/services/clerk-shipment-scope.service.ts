import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { db } from '../db';
import type { Tx } from './trip-shared';

export interface ClerkShipmentScope {
  businessUnitIds: number[];
  /**
   * Admin-managed user_customer_links only. Drives the has-any-assignment
   * gate so a clerk with zero admin links cannot self-bootstrap scope by
   * creating a customer.
   */
  adminCustomerIds: number[];
  /**
   * adminCustomerIds ∪ customers this clerk created via intake
   * (customers.created_by). Makes an inline-created customer a working
   * customer for its creator — visible on the workboard and usable for
   * shipment creates — without touching admin-managed link tables.
   */
  customerIds: number[];
  shipmentIds: number[];
}

function normalizeIds(values: Array<number | null | undefined>): number[] {
  return [...new Set(
    values.filter((value): value is number => value != null && Number.isInteger(value) && value > 0),
  )].sort((a, b) => a - b);
}

export function isClerkScopedUser(actor: Pick<AuthUser, 'role'> | null | undefined): boolean {
  return actor?.role === Role.CUS;
}

export async function loadClerkShipmentScope(
  userId: number,
  tx?: Tx,
): Promise<ClerkShipmentScope> {
  const client = tx ?? db;
  const [unitRows, customerRows, createdCustomerRows, shipmentRows] = await Promise.all([
    client.select({ id: s.userBusinessUnitLinks.businessUnitId })
      .from(s.userBusinessUnitLinks)
      .innerJoin(s.businessUnits, eq(s.userBusinessUnitLinks.businessUnitId, s.businessUnits.id))
      .where(and(
        eq(s.userBusinessUnitLinks.userId, userId),
        eq(s.businessUnits.status, 'ACTIVE'),
      ))
      .orderBy(s.userBusinessUnitLinks.businessUnitId),
    client.select({ id: s.userCustomerLinks.customerId })
      .from(s.userCustomerLinks)
      .innerJoin(s.customers, eq(s.userCustomerLinks.customerId, s.customers.id))
      .where(and(
        eq(s.userCustomerLinks.userId, userId),
        sql`${s.customers.deletedAt} IS NULL`,
      ))
      .orderBy(s.userCustomerLinks.customerId),
    client.select({ id: s.customers.id })
      .from(s.customers)
      .where(and(
        eq(s.customers.createdBy, userId),
        sql`${s.customers.deletedAt} IS NULL`,
      ))
      .orderBy(s.customers.id),
    client.select({ id: s.userShipmentLinks.shipmentId })
      .from(s.userShipmentLinks)
      .innerJoin(s.shipments, eq(s.userShipmentLinks.shipmentId, s.shipments.id))
      .where(and(
        eq(s.userShipmentLinks.userId, userId),
        sql`${s.shipments.deletedAt} IS NULL`,
      ))
      .orderBy(s.userShipmentLinks.shipmentId),
  ]);

  const adminCustomerIds = normalizeIds(customerRows.map((row) => row.id));
  const createdCustomerIds = normalizeIds(createdCustomerRows.map((row) => row.id));
  return {
    businessUnitIds: normalizeIds(unitRows.map((row) => row.id)),
    adminCustomerIds,
    customerIds: normalizeIds([...adminCustomerIds, ...createdCustomerIds]),
    shipmentIds: normalizeIds(shipmentRows.map((row) => row.id)),
  };
}

export function hasAnyClerkShipmentAssignment(scope: ClerkShipmentScope): boolean {
  // Admin links only — a self-created customer must not bootstrap a scope-less
  // clerk past the assignment gate; links stay the admin's lever.
  return scope.businessUnitIds.length > 0 && (scope.adminCustomerIds.length > 0 || scope.shipmentIds.length > 0);
}

export function shipmentMatchesClerkScope(
  scope: ClerkShipmentScope,
  shipment: Pick<typeof s.shipments.$inferSelect, 'id' | 'customerId' | 'responsibleUnitId'>,
): boolean {
  if (!hasAnyClerkShipmentAssignment(scope)) return false;
  if (shipment.responsibleUnitId == null) return false;
  if (!scope.businessUnitIds.includes(shipment.responsibleUnitId)) return false;
  return scope.customerIds.includes(shipment.customerId) || scope.shipmentIds.includes(shipment.id);
}

export function buildShipmentScopeWhere(scope: ClerkShipmentScope): SQL {
  if (!hasAnyClerkShipmentAssignment(scope)) {
    return sql`false`;
  }

  const assignmentConditions: SQL[] = [];
  if (scope.customerIds.length > 0) {
    assignmentConditions.push(inArray(s.shipments.customerId, scope.customerIds));
  }
  if (scope.shipmentIds.length > 0) {
    assignmentConditions.push(inArray(s.shipments.id, scope.shipmentIds));
  }

  const assignmentClause = assignmentConditions.length === 1
    ? assignmentConditions[0]
    : or(...assignmentConditions)!;

  return and(
    inArray(s.shipments.responsibleUnitId, scope.businessUnitIds),
    assignmentClause,
  )!;
}

export function assertClerkCanAccessShipment(
  scope: ClerkShipmentScope,
  shipment: Pick<typeof s.shipments.$inferSelect, 'id' | 'customerId' | 'responsibleUnitId'>,
): void {
  if (!shipmentMatchesClerkScope(scope, shipment)) {
    throw new ApiError(404, 'Không tìm thấy lô hàng');
  }
}

export function resolveClerkResponsibleUnitId(
  scope: ClerkShipmentScope,
  requestedResponsibleUnitId: number | null | undefined,
): number {
  if (scope.businessUnitIds.length === 0) {
    throw new ApiError(403, 'Nhân viên chứng từ chưa được gán đơn vị phụ trách');
  }
  if (requestedResponsibleUnitId != null) {
    if (!scope.businessUnitIds.includes(requestedResponsibleUnitId)) {
      throw new ApiError(403, 'Đơn vị phụ trách không thuộc phạm vi của nhân viên chứng từ');
    }
    return requestedResponsibleUnitId;
  }
  if (scope.businessUnitIds.length === 1) {
    return scope.businessUnitIds[0];
  }
  throw new ApiError(400, 'Cần chọn đơn vị phụ trách cho lô hàng');
}

export function assertClerkCanCreateForCustomer(
  scope: ClerkShipmentScope,
  customerId: number,
): void {
  if (!hasAnyClerkShipmentAssignment(scope)) {
    throw new ApiError(403, 'Nhân viên chứng từ chưa được gán phạm vi lô hàng');
  }
  if (!scope.customerIds.includes(customerId)) {
    throw new ApiError(403, 'Khách hàng không thuộc phạm vi của nhân viên chứng từ');
  }
}
