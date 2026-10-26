// Quick-edit domain model for the CUS workspace inline cell editor.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-01 structural
// split so the field-gating, draft construction, unchanged-diff and payload
// assembly rules are unit-testable without rendering the workboard.
// SIL-521 (owner 26/10): the documents mode no longer manages a lot-level
// declaration list — tờ khai is per-cont only, edited on the container rows.

import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CUS_SEARCH_PATTERN } from '@tingting/shared';
import type { updateShipment } from '../../../api/shipmentClient';
import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { stripDecimalTrailingZeros } from '../../../lib/format';
import { scheduleTime, type ShipmentQuickEditDraft } from './cusUtils';

export type QuickEditField = ShipmentQuickEditDraft['field'];

/** Shipment PATCH body shape accepted by updateShipment. */
export type QuickEditShipmentPayload = Parameters<typeof updateShipment>[1];

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
    : field === 'documents' ? ['blNumber', 'bookingRef'] as const
      : field === 'classification' ? ['tradeDirection', 'shippingLineName'] as const
        : field === 'cargo' ? ['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'] as const
          : field === 'schedule' ? ['closingAt', 'plannedReturnAt'] as const
            : ['customerNotes', 'operationalNotes'] as const;
}

/**
 * Whether a Sửa-lô picker may open a group, with the honest reason when it
 * may not. Mirrors `startQuickEdit`'s two guards (FCL schedule is per-
 * container; a group whose every access key is READ_ONLY) so the picker
 * disables exactly what the save path would refuse — same law, checked
 * before the click instead of after.
 */
export function quickEditGroupGate(
  item: Pick<ShipmentCusWorkspaceListItem, 'cargoMode' | 'fieldAccess'>,
  field: QuickEditField,
): { disabled: boolean; reason: string | null } {
  if (field === 'schedule' && item.cargoMode === 'FCL') {
    return { disabled: true, reason: 'Lịch FCL được cập nhật theo từng container.' };
  }
  const keys = quickEditAccessKeys(field);
  const allReadOnly = keys.every((key) => item.fieldAccess[key].mode === 'READ_ONLY');
  return { disabled: allReadOnly, reason: allReadOnly ? item.fieldAccess[keys[0]].reason : null };
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
    tradeDirection: item.raw.tradeDirection ?? '',
    shippingLineName: item.raw.shippingLineName ?? '',
    packageCount: item.raw.packageCount == null ? '' : String(item.raw.packageCount),
    packageType: item.raw.packageType ?? '',
    cargoWeightKg: stripDecimalTrailingZeros(item.raw.cargoWeightKg),
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