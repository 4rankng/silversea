// Pure helpers for the CUS container-detail workboard.
//
// Extracted verbatim from pages/ShipmentsDetailPage.tsx (since renamed
// ShipmentContainersPage) in the 2026-09-01
// structural split: URL-param readers, edit-mode permission rules, and the
// optimistic-conlict sniff every save uses to self-heal instead of failing.

import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { CUS_SEARCH_PATTERN } from '@tingting/shared';
import { ApiError } from '../../../lib/api';
import type { ShipmentDetailEditMode } from '../../shipments/detail/edit-mode';
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

/* ── SIL-503 — lot-level (hàng lẻ) rows on the container workboard ──────────
 *
 * A container-less LCL lot owns NO container line, so the two cells the CUS
 * actually edits cannot ride the per-container command the FCL cells use.
 * Both writes already exist at the shipment level; these helpers adapt the
 * lot row to them without inventing wire surface:
 *
 * - SỐ TỜ KHAI: the documents editor session opens against a READ-ONLY
 *   pseudo line (`lotPseudoLine`) — documents mode reads only the shipment
 *   summary, never the line — and the number itself saves through the
 *   shipment-declaration API (`lotDeclarationWrite` diff).
 * - PHÂN XE stays an in-cell quick edit (the ledger's `updateLclTruck`
 *   editors), never a line session.
 */

/** The shipment-declaration write one lot-row documents save must issue,
 *  in wire order: PUT the displayed row (metadata resent verbatim per the
 *  whole-row PUT contract), POST when the lot has no declaration row yet,
 *  or nothing when the draft echoes the stored number. Clearing PUTs the
 *  number null — the row and its metadata survive, mirroring the modal. */
export type LotDeclarationWrite =
  | { kind: 'noop' }
  | {
    kind: 'update';
    declarationId: number;
    body: { declarationNumber: string | null; issuedAt: string | null; scope?: 'SINGLE' | 'SHARED'; note: string | null };
  }
  | { kind: 'create'; body: { declarationNumber: string } };

type LotDeclarationSource = ShipmentCusWorkspaceDetail['summary']['raw'];

/** The lot's tờ khai lives in `shipment_declarations` (never on a container);
 *  the cell displays the read model's first non-empty row, so that row is the
 *  PUT target, the detail's pinned `declarationId` the fallback, and an empty
 *  `shipment_declarations` lot the POST case. */
export function lotDeclarationWrite(
  raw: LotDeclarationSource,
  draftDeclaration: string | null,
): LotDeclarationWrite {
  const next = (draftDeclaration ?? '').trim();
  const stored = raw.declarations ?? [];
  const current = (raw.declarationNumber ?? '').trim();
  if (next === current) return { kind: 'noop' };
  const target = (current !== ''
    ? stored.find((row) => (row.declarationNumber ?? '').trim() === current)
    : undefined)
    ?? (raw.declarationId != null ? stored.find((row) => row.id === raw.declarationId) : undefined);
  if (next === '') {
    if (!target || !(target.declarationNumber ?? '').trim()) return { kind: 'noop' };
    return {
      kind: 'update',
      declarationId: target.id,
      body: { declarationNumber: null, issuedAt: target.issuedAt, scope: target.scope ?? undefined, note: target.note },
    };
  }
  if (!target) return { kind: 'create', body: { declarationNumber: next } };
  return {
    kind: 'update',
    declarationId: target.id,
    body: { declarationNumber: next, issuedAt: target.issuedAt, scope: target.scope ?? undefined, note: target.note },
  };
}

const lotLineReadOnly = {
  mode: 'READ_ONLY' as const,
  reason: 'Lô hàng lẻ không có dòng container; hãy thao tác trên Tổng quan lô hàng.',
};

const lotLinePermissions = {
  carrierEditable: false,
  plateEditable: false,
  containerTypeEditable: false,
  liftSiteEditable: false,
  dropoffSiteEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
} as const;

/** The stand-in container line a lot-row documents session runs against.
 *  Every operational field stays READ_ONLY — the pseudo line can never
 *  authorize a container-line command (no real line exists behind the
 *  negative row id); documents mode reads the shipment summary only, which
 *  is exactly the parity SIL-503 grants. Identity fields mirror the flat row
 *  so the editor chrome labels the session with the LOT (Bill/Booking), not
 *  a fabricated container. */
export function lotPseudoLine(
  row: ShipmentCusContainerFlatRow,
  detail: ShipmentCusWorkspaceDetail,
): ShipmentCusWorkspaceContainerLine {
  const readOnly = lotLineReadOnly;
  return {
    id: row.id,
    ordinal: 1,
    operationalSiteId: null,
    containerNumber: null,
    declarationNumber: row.declarationNumber,
    containerTypeId: null,
    containerTypeLabel: null,
    routeId: detail.summary.raw.routeId,
    routeName: row.routeName,
    dispatchStatus: row.dispatchStatus,
    tripId: null,
    tripStatus: null,
    carrierType: row.carrierType,
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: row.carrierName,
    plateNumber: row.plateNumber,
    liftSiteId: null,
    liftSite: row.liftSite,
    dropoffSiteId: null,
    dropoffSite: row.dropoffSite,
    customerAppointmentAt: null,
    raw: {
      containerNumber: null,
      containerTypeId: null,
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      routeId: detail.summary.raw.routeId,
    },
    fieldAccess: {
      operationalSiteId: readOnly,
      containerNumber: readOnly,
      containerTypeId: readOnly,
      cargoWeightKg: readOnly,
      cargoVolumeCbm: readOnly,
      routeId: readOnly,
      carrierType: readOnly,
      externalCarrierId: readOnly,
      externalCarrierVehicleId: readOnly,
      plateNumber: readOnly,
      liftSiteId: readOnly,
      dropoffSiteId: readOnly,
      customerAppointmentAt: readOnly,
    },
    permissions: { ...lotLinePermissions },
    shipmentVersion: detail.summary.version,
    relatedTripVersion: null,
  };
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
  if (mode === 'documents') return ['blNumber', 'bookingRef', 'tradeDirection', 'shippingLineName', 'declarationNumber'].some((field) => detail.summary.fieldAccess[field as 'blNumber'].mode !== 'READ_ONLY');
  if (mode === 'container') return ['containerNumber', 'containerTypeId', 'cargoWeightKg', 'cargoVolumeCbm'].some((field) => line.fieldAccess[field as 'containerNumber'].mode !== 'READ_ONLY');
  if (mode === 'route') return line.permissions.liftSiteEditable || line.permissions.dropoffSiteEditable;
  if (mode === 'vehicle') return line.permissions.carrierEditable || line.permissions.plateEditable;
  if (mode === 'schedule') return detail.summary.operational.transportDateEditable || line.permissions.customerAppointmentEditable;
  return ['customerNotes', 'operationalNotes'].some((field) => detail.summary.fieldAccess[field as 'customerNotes'].mode !== 'READ_ONLY');
}
