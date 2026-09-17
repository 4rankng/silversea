import type { DispatchClassification } from '@tingting/shared';
import { DISPATCH_CLASSIFICATIONS, DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { SearchableSelectOption } from '../../../design-system';

// Cell value vocabulary shared by the plan editor: every carrier/vehicle
// choice serialises into a prefixed string so the select stays a single
// value while the atomic save resolves it back into request bodies.

export const EXTERNAL_CARRIER_PREFIX = 'carrier:';
export const OWN_CARRIER_VALUE = 'carrier:own';
export const FREE_TEXT_PREFIX = 'free:';
export const CURRENT_PLATE_PREFIX = 'current:';
export const EXTERNAL_VEHICLE_PREFIX = 'vehicle:';

// Zone-agnostic wording: suggestions derive from whichever zone the order's
// own ports sit in (not just Lạch Huyện), so the tag must not hard-code "LH".
export const SUGGESTION_LABELS: Record<'D-1_DROP' | 'D+1_PICKUP', string> = {
  'D-1_DROP': 'Hạ tại khu vực D-1',
  'D+1_PICKUP': 'Lấy tại khu vực D+1',
};


export function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function carrierValueForRow(row: DispatchDetailPlanRow): string {
  // Carrier-less rows (detail plan since 2026-09-09): '' keeps the picker's
  // "Chọn nhà xe" placeholder instead of a garbage `EXT:undefined` value.
  if (row.dispatch.carrierType == null) return '';
  return row.dispatch.carrierType === 'OWN'
    ? OWN_CARRIER_VALUE
    : `${EXTERNAL_CARRIER_PREFIX}${row.dispatch.externalCarrierId}`;
}

export function vehicleValueForRow(row: DispatchDetailPlanRow): string {
  if (row.dispatch.externalCarrierVehicleId != null) {
    return `${EXTERNAL_VEHICLE_PREFIX}${row.dispatch.externalCarrierVehicleId}`;
  }
  return row.dispatch.assignedPlate ? `${CURRENT_PLATE_PREFIX}${row.dispatch.assignedPlate}` : '';
}

/** Comparison key for plate equality: separator-stripped uppercase, so the
 *  punctuated and normalized forms of one plate (15E-016.26 / 15E01626)
 *  compare equal wherever they meet — picker option, current-row placeholder
 *  or free text. */
export function plateCompareKey(value: string): string {
  return normalizePlate(value).replace(/[^A-Z0-9 ]/g, '');
}

/** Resolves any vehicle-select value to its plate for comparison. The row's
 *  own-fleet placeholder (`current:{plate}`) and the same truck's fetched
 *  option (`truck:{id}`) are two different value strings for one vehicle —
 *  without this, re-selecting the already-assigned truck (or just opening
 *  the picker) registers as an unsaved change and the fetched list shows the
 *  same plate twice. */
export function vehiclePlateKey(value: string, options: SearchableSelectOption[]): string {
  if (!value) return '';
  if (value.startsWith(CURRENT_PLATE_PREFIX)) return plateCompareKey(value.slice(CURRENT_PLATE_PREFIX.length));
  if (value.startsWith(FREE_TEXT_PREFIX)) return plateCompareKey(value.slice(FREE_TEXT_PREFIX.length));
  const label = options.find((option) => option.value === value)?.label;
  return label ? plateCompareKey(label.split(' — ')[0]) : value;
}

/** Cont rows offer the three cont models (Đơn/Kẹp/Kết hợp) — the dispatcher's
 *  call since 2026-09-08. LCL rows are cargo-mode bound: the select shows Lẻ,
 *  locked (PRD §2b keeps Lẻ separate from the three cont models). */

export function classificationOptionsForRow(classification: DispatchClassification): Array<{
  value: DispatchClassification;
  label: string;
}> {
  if (classification === 'LCL') {
    return [{ value: 'LCL', label: DISPATCH_CLASSIFICATION_LABELS.LCL }];
  }
  return DISPATCH_CLASSIFICATIONS
    .filter((value) => value !== 'LCL')
    .map((value) => ({ value, label: DISPATCH_CLASSIFICATION_LABELS[value] }));
}


export function parseCarrier(value: string): { carrierType: 'OWN' | 'EXTERNAL'; externalCarrierId?: number } | null {
  if (value === OWN_CARRIER_VALUE) return { carrierType: 'OWN' };
  if (!value.startsWith(EXTERNAL_CARRIER_PREFIX)) return null;
  const externalCarrierId = Number(value.slice(EXTERNAL_CARRIER_PREFIX.length));
  return Number.isInteger(externalCarrierId) && externalCarrierId > 0
    ? { carrierType: 'EXTERNAL', externalCarrierId }
    : null;
}

/** Stable unique row key. Fulfillment rows key on the fulfillment id; branch
 *  rows (not yet decomposed) on their container id — the wire sends a null
 *  fulfillment id there, and keying on it floods the console with
 *  "two children with the same key, null" on every render. */
export function detailRowKey(row: DispatchDetailPlanRow): string {
  if (row.fulfillmentId != null) return `f-${row.fulfillmentId}`;
  if (row.shipmentContainerId != null) return `c-${row.shipmentContainerId}`;
  return `s-${row.shipmentId}-${row.shipmentCode ?? 'lot'}`;
}
