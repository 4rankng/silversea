// Pure helpers for the CUS container-detail workboard.
//
// Extracted verbatim from pages/ShipmentsDetailPage.tsx (since renamed
// ShipmentContainersPage) in the 2026-09-01
// structural split: URL-param readers, edit-mode permission rules, and the
// optimistic-conlict sniff every save uses to self-heal instead of failing.

import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { CUS_SEARCH_PATTERN } from '@tingting/shared';
import { ApiError } from '../../../lib/api';
import type { ShipmentDetailEditMode } from '../../shipments/detail/ShipmentContainerLedger';
import { DISPATCH_STATUS } from '../../shipments/detail/ShipmentContainerLedger';

export { CUS_SEARCH_PATTERN };
export const CUS_DETAIL_PAGE_SIZE = 20;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** URL-legal Trạng thái values: the four badge states the ledger displays
 * plus the legacy coarse carrier-presence aliases (ASSIGNED = any active
 * carrier, UNASSIGNED = none), so older links keep filtering. The aliases
 * are accepted but not offered in the dropdown. */
export type DispatchStatusFilter = 'ASSIGNED' | 'UNASSIGNED' | keyof typeof DISPATCH_STATUS;
export const DISPATCH_STATUS_VALUES: readonly DispatchStatusFilter[] = ['ASSIGNED', 'UNASSIGNED', ...(Object.keys(DISPATCH_STATUS) as DispatchStatusFilter[])];

/** 409s that mean "someone else wrote first" — recoverable by refetching. */
export function isOptimisticShipmentConflict(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  return error.message.includes('Lô hàng vừa thay đổi')
    || error.message.includes('Lô hàng đã bị người khác cập nhật')
    || error.message.includes('yêu cầu thay đổi mới hơn')
    || error.message.includes('Dữ liệu đã được xử lý đồng thời');
}

/** Strict ISO date reader — rejects partial/invalid values outright. */
export function readIsoDate(value: string | null): string {
  if (!value || !ISO_DATE_PATTERN.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? '' : value;
}

export function readPositiveInteger(value: string | null, fallback = 0): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** A mode is editable when at least one of its authority fields is writable. */
export function canEditMode(
  detail: ShipmentCusWorkspaceDetail,
  line: ShipmentCusWorkspaceContainerLine,
  mode: ShipmentDetailEditMode,
): boolean {
  if (mode === 'identity') return detail.summary.cargoMode === 'FCL'
    ? line.fieldAccess.operationalSiteId?.mode === 'DIRECT'
    : ['factoryName', 'routeId', 'deliveryLocation'].some((field) => detail.summary.fieldAccess[field as 'factoryName'].mode !== 'READ_ONLY');
  if (mode === 'documents') return ['blNumber', 'bookingRef', 'tradeDirection', 'shippingLineName'].some((field) => detail.summary.fieldAccess[field as 'blNumber'].mode !== 'READ_ONLY');
  if (mode === 'container') return ['containerNumber', 'containerTypeId', 'cargoWeightKg', 'cargoVolumeCbm'].some((field) => line.fieldAccess[field as 'containerNumber'].mode !== 'READ_ONLY');
  if (mode === 'route') return line.permissions.liftSiteEditable || line.permissions.dropoffSiteEditable;
  if (mode === 'vehicle') return line.permissions.carrierEditable || line.permissions.plateEditable;
  if (mode === 'schedule') return detail.summary.operational.transportDateEditable || line.permissions.customerAppointmentEditable;
  return ['customerNotes', 'operationalNotes'].some((field) => detail.summary.fieldAccess[field as 'customerNotes'].mode !== 'READ_ONLY');
}
