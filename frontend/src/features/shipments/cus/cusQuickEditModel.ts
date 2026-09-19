// Quick-edit domain model for the CUS workspace inline cell editor.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01 structural
// split so the field-gating, draft construction, unchanged-diff and payload
// assembly rules are unit-testable without rendering the workboard.

import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CUS_SEARCH_PATTERN } from '@tingting/shared';
import type { updateShipment, updateShipmentDeclaration } from '../../../api/shipmentClient';
import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { scheduleTime, type ShipmentQuickEditDraft } from './cusUtils';

export type QuickEditField = ShipmentQuickEditDraft['field'];

/** Shipment PATCH body shape accepted by updateShipment. */
export type QuickEditShipmentPayload = Parameters<typeof updateShipment>[1];
/** Declaration upsert body accepted by updateShipmentDeclaration. */
export type QuickEditDeclarationBody = Parameters<typeof updateShipmentDeclaration>[2];

/** FCL factories belong to individual containers, including undated intake. */
export function factoryDetailPath(item: ShipmentCusWorkspaceListItem): string {
  const params = new URLSearchParams({ dateScope: 'all' });
  const reference = (item.billOrBookNumber || item.declarationNumber || '').toUpperCase();
  if (CUS_SEARCH_PATTERN.test(reference)) params.set('searchSuffix', reference);
  if (item.raw.customerId) params.set('customerId', String(item.raw.customerId));
  return `/shipments-detail?${params}`;
}

/**
 * Field-access keys each edit mode may write, mirroring the seven cell groups.
 * A mode is openable when at least one of its keys is not READ_ONLY.
 */
export function quickEditAccessKeys(field: QuickEditField): readonly (keyof ShipmentCusWorkspaceListItem['fieldAccess'])[] {
  return field === 'identity' ? ['factoryName'] as const
    : field === 'documents' ? ['blNumber', 'bookingRef', 'declarationNumber'] as const
      : field === 'classification' ? ['tradeDirection', 'shippingLineName'] as const
        : field === 'cargo' ? ['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'] as const
          : field === 'schedule' ? ['closingAt', 'plannedReturnAt'] as const
            : ['customerNotes', 'operationalNotes'] as const;
}

/** Seed the editable draft from the row's current values (verbatim seed rules). */
export function buildQuickEditDraft(item: ShipmentCusWorkspaceListItem, field: QuickEditField): ShipmentQuickEditDraft {
  return {
    shipmentId: item.id,
    field,
    date: item.transportDate ?? '',
    time: scheduleTime(item),
    customerNote: item.customerNotes ?? '',
    operationalNote: item.operationalNotes ?? '',
    factoryName: item.raw.factoryName ?? '',
    blNumber: item.raw.blNumber ?? '',
    bookingRef: item.raw.bookingRef ?? '',
    declarationNumber: item.raw.declarationNumber ?? '',
    declarationChannel: item.raw.declarationChannel ?? '',
    declarationId: item.raw.declarationId,
    declarationIssuedAt: item.raw.declarationIssuedAt,
    declarationScope: item.raw.declarationScope,
    declarationNote: item.raw.declarationNote,
    tradeDirection: item.raw.tradeDirection ?? '',
    shippingLineName: item.raw.shippingLineName ?? '',
    packageCount: item.raw.packageCount == null ? '' : String(item.raw.packageCount),
    packageType: item.raw.packageType ?? '',
    cargoWeightKg: item.raw.cargoWeightKg ?? '',
    cargoVolumeCbm: item.raw.cargoVolumeCbm ?? '',
  };
}

/**
 * True when the draft matches the row on every field its mode writes, so the
 * save can be skipped entirely (no version bump, no change-request
 * bookkeeping). Field-by-field because each mode seeds a different subset.
 */
export function isQuickEditUnchanged(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): boolean {
  return draft.field === 'identity'
    ? draft.factoryName.trim() === (item.raw.factoryName ?? '')
    : draft.field === 'documents'
      ? draft.blNumber.trim() === (item.raw.blNumber ?? '') && draft.bookingRef.trim() === (item.raw.bookingRef ?? '')
        && (item.fieldAccess.declarationNumber.mode === 'READ_ONLY'
          || (draft.declarationNumber.trim() === (item.raw.declarationNumber ?? '')
            && draft.declarationChannel === (item.raw.declarationChannel ?? '')))
      : draft.field === 'classification'
        ? draft.tradeDirection === (item.raw.tradeDirection ?? '') && draft.shippingLineName.trim() === (item.raw.shippingLineName ?? '')
        : draft.field === 'cargo'
          ? draft.packageCount === (item.raw.packageCount == null ? '' : String(item.raw.packageCount))
            && draft.packageType.trim() === (item.raw.packageType ?? '')
            && draft.cargoWeightKg === (item.raw.cargoWeightKg ?? '')
            && draft.cargoVolumeCbm === (item.raw.cargoVolumeCbm ?? '')
          : draft.field === 'schedule'
            ? draft.date === (item.transportDate ?? '') && draft.time === scheduleTime(item)
            : draft.customerNote.trim() === (item.customerNotes ?? '').trim()
              && draft.operationalNote.trim() === (item.operationalNotes ?? '').trim();
}

/** Stable identity for the in-flight save guard (latest save wins). */
export function quickEditSaveIdentity(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): string {
  return `${draft.field}:${draft.shipmentId}:${item.version}`;
}

/**
 * Build the shipment PATCH body for the draft's mode. Direction and
 * field-access gate which keys ship; empty strings become null so the API can
 * distinguish "cleared" from "unchanged".
 */
export function buildQuickEditPayload(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): QuickEditShipmentPayload {
  const scheduleValue = draft.date && draft.time
    ? localDateTimeToIso(`${draft.date}T${draft.time}`)
    : null;
  return draft.field === 'identity' ? {
    expectedVersion: item.version,
    ...(item.cargoMode !== 'FCL' ? { factoryName: draft.factoryName.trim() || null } : {}),
  } : draft.field === 'documents' ? {
    expectedVersion: item.version,
    ...(draft.tradeDirection === 'IMPORT' && item.fieldAccess.blNumber.mode !== 'READ_ONLY' ? {
      blNumber: draft.blNumber.trim() || null,
      bookingRef: null,
    } : draft.tradeDirection === 'EXPORT' && item.fieldAccess.bookingRef.mode !== 'READ_ONLY' ? {
      bookingRef: draft.bookingRef.trim() || null,
      blNumber: null,
    } : {}),
  } : draft.field === 'classification' ? {
    expectedVersion: item.version,
    tradeDirection: draft.tradeDirection || null,
    shippingLineName: draft.shippingLineName.trim() || null,
  } : draft.field === 'cargo' ? {
    expectedVersion: item.version,
    packageCount: draft.packageCount ? Number(draft.packageCount) : null,
    packageType: draft.packageType.trim() || null,
    ...(item.fieldAccess.cargoWeightKg.mode !== 'READ_ONLY' ? { cargoWeightKg: draft.cargoWeightKg || null } : {}),
    ...(item.fieldAccess.cargoVolumeCbm.mode !== 'READ_ONLY' ? { cargoVolumeCbm: draft.cargoVolumeCbm || null } : {}),
  } : draft.field === 'schedule' ? {
        expectedVersion: item.version,
        expectedDeliveryDate: draft.date || null,
        ...(item.direction === 'IMPORT'
          ? { plannedReturnAt: scheduleValue }
          : { closingAt: scheduleValue }),
      } : {
        expectedVersion: item.version,
        driverNotes: draft.operationalNote.trim() || null,
        customerNotes: draft.customerNote.trim() || null,
      };
}

/**
 * Declaration lives in its own table behind its own endpoints; when the
 * number changed and the actor may write it, upsert alongside the shipment
 * save. PUT replaces the whole row, so resend issuedAt/scope/note verbatim to
 * keep the existing metadata.
 */
export function quickEditDeclarationChanged(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): boolean {
  return draft.field === 'documents'
    && item.fieldAccess.declarationNumber.mode !== 'READ_ONLY'
    && (draft.declarationNumber.trim() !== (item.raw.declarationNumber ?? '')
      || draft.declarationChannel !== (item.raw.declarationChannel ?? ''));
}

export function buildQuickEditDeclarationBody(draft: ShipmentQuickEditDraft): QuickEditDeclarationBody {
  return {
    declarationNumber: draft.declarationNumber.trim() || null,
    channel: draft.declarationChannel || null,
    issuedAt: draft.declarationIssuedAt,
    scope: draft.declarationScope ?? undefined,
    note: draft.declarationNote,
  };
}
