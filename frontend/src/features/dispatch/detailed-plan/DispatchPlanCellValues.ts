import type { DispatchClassification } from '@tingting/shared';
import {
  DISPATCH_CLASSIFICATIONS,
  DISPATCH_CLASSIFICATION_LABELS,
  parseDriverTaskNote,
  composeDriverTaskNote,
} from '@tingting/shared';
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
/** Card 20261004_359 — "Bổ sung sau": issue the order for an external carrier
 *  before the plate is known (carrier stays, plate ships empty). */
export const DEFERRED_PLATE_PREFIX = 'defer:';

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

/** Classification choices for one plan row, keyed on the row's CARGO MODE —
 *  never on its stored classification. Once a dispatcher picks `LCL_PICKUP`
 *  the stored value is no longer `LCL`, so a classification-keyed lookup
 *  would silently promote an LCL lot into the cont models (Đơn/Kẹp/Kết
 *  hợp) on the next reopen.
 *
 *  - LCL lots keep the cargo-mode-bound pair: `Lẻ` (the plain LCL run) and
 *    `Lấy Lẻ` (the empty-shell run). Neither is a cont model, so neither can
 *    become Đơn/Kẹp/Kết hợp — PRD §2b keeps Lẻ out of the cont taxonomy.
 *  - Cont lots offer the three cont models plus `Lấy Lẻ`: the empty-shell
 *    LCL run is a dispatcher's own call, and the run moves the truck's shell
 *    rather than the lot's. */
export function classificationOptionsForRow(cargoMode: 'FCL' | 'LCL'): Array<{
  value: DispatchClassification;
  label: string;
}> {
  if (cargoMode === 'LCL') {
    return [
      { value: 'LCL', label: DISPATCH_CLASSIFICATION_LABELS.LCL },
      { value: 'LCL_PICKUP', label: DISPATCH_CLASSIFICATION_LABELS.LCL_PICKUP },
    ];
  }
  return DISPATCH_CLASSIFICATIONS
    .filter((value) => value !== 'LCL')
    .map((value) => ({ value, label: DISPATCH_CLASSIFICATION_LABELS[value] }));
}

/** True for the empty-shell LCL run — the only classification that overrides
 *  the row's own container code when the trailer type is inferred. */
export function isLclPickup(classification: DispatchClassification | null | undefined): boolean {
  return classification === 'LCL_PICKUP';
}

/** Operator-facing note under the Phân loại select. Carries the two rules a
 *  dispatcher cannot infer from the option list alone: an LCL lot is bound to
 *  the cargo-mode pair and never becomes a cont model, and a Lấy Lẻ run ends
 *  with a task-tag choice (back empty vs. closed, back to the port) rather
 *  than a second classification. */
export function classificationHint(
  cargoMode: 'FCL' | 'LCL',
  classification: DispatchClassification | null | undefined,
): string | undefined {
  if (classification === 'LCL_PICKUP') {
    return 'Lấy Lẻ: lấy vỏ cont rỗng 40ft, đi kết hợp đóng hàng lẻ chuyển kho. '
      + 'Kết thúc chuyến chọn bằng thẻ tác vụ: hạ vỏ rỗng, hoặc đóng hàng về hạ cảng.';
  }
  if (cargoMode === 'LCL') {
    return 'Hàng lẻ chỉ chọn Lẻ hoặc Lấy Lẻ — gắn với hình thức lô hàng.';
  }
  return undefined;
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
