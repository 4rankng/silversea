import type { DispatchClassification } from '@tingting/shared';
import {
  DISPATCH_CLASSIFICATIONS,
  DISPATCH_CLASSIFICATION_LABELS,
} from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { SearchableSelectOption } from '../../../design-system';
import { formatAppointmentGroupLine } from '../../shipments/cus/cusUtils';
import { formatISODate, formatNumber, formatVolumeCbm, formatWeight } from '../../../lib/format';

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

/** The row's order is issued and its trip is live: the vehicle may only change
 *  through the governed reassignment flow, never through a plain plan save
 *  (the backend's live-trip guard would reject it). One authority for every
 *  trigger that names or routes this verb — the row ⋯ menu, the editor cell's
 *  openEditor guard, and its click-to-edit carrier label (SIL-500). */
export function canReassignIssuedTrip(row: DispatchDetailPlanRow): boolean {
  return row.taskStatus === 'DISPATCHED'
    && row.dispatch.tripId != null
    && (row.dispatch.tripStatus === 'CREATED' || row.dispatch.tripStatus === 'IN_TRANSIT');
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
    // SIL-702 (id 822): the LCL row's select is the cargo-mode-bound PAIR
    // Lẻ / Lấy Lẻ (testplan/flows/02-dieuvan-dispatch.md §2.13, 2026-10-03;
    // TC-DV-DISPATCH-053). "Lấy Lẻ" is the empty-shell run — take a 40' shell
    // and close the LCL cargo into it — and the dispatcher moves between the
    // two. The cont models (Đơn/Kẹp/Kết hợp) stay off an LCL lot: they are
    // the CONTAINER-row taxonomy, and PRD §2b keeps Lẻ out of it.
    //
    // It was storable again since migration
    // 20261107094500_lcl_fulfillment_lcl_pickup_classification widened the DB
    // check that had pinned an LCL_SHIPMENT row to 'LCL' (the check predated
    // the classification and turned a legal save into a raw 23514 → HTTP 500).
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

/* ── Owner redesign 23/10 — shared schedule line ──────────────────────────
 * The table cell and the mobile card both print the SAME schedule reading
 * (one definition, two surfaces): stored plannedEndAt outranks the
 * appointment-derived run timestamp, a present date renders ALONE (card
 * 20261003_304), and the delivery-date fallback stays LABELLED (card
 * 20261003_318). Lives beside the row-key helper so neither surface imports
 * the other for it. */
export function detailedScheduleLine(row: Pick<DispatchDetailPlanRow, 'plannedEndAt' | 'time'>): string {
  if (row.plannedEndAt) return formatAppointmentGroupLine(row.plannedEndAt);
  if (row.time.runAt) return formatAppointmentGroupLine(row.time.runAt);
  if (row.time.runHour != null) {
    return [
      `${row.time.runHour}H`,
      row.time.deliveryDate ? formatISODate(row.time.deliveryDate) : null,
    ].filter(Boolean).join(' ');
  }
  return row.time.deliveryDate
    ? `Ngày giao ${formatISODate(row.time.deliveryDate)}`
    : '—';
}

/* SIL-793 — the schedule column's container-demand line ("1 x 20DC"), the
 * fact /dispatch's LỊCH TRÌNH prints under every appointment block
 * (appointment group containerSummary). A detailed row IS one container
 * (fulfillment-per-container wire), so the demand is the row's own type at
 * count 1 — never a lot-level aggregation the row does not own. An LCL lot
 * owns no container: null (its cargo prints in the CONTAINER column, and on
 * the phone card the type rides cargoLine), so no surface invents a count. */
export function detailedDemandLine(row: Pick<DispatchDetailPlanRow, 'cargoMode' | 'container'>): string | null {
  if (row.cargoMode !== 'FCL') return null;
  const label = row.container.containerTypeLabel?.trim();
  return label ? `1 x ${label}` : null;
}

/* SIL-796 (r2) — the pure signed-price seed law of the dispatch editor's two
 * "dự kiến" fee fields. A stored ''/0 is "chưa định giá", never a price; the
 * seed fills the SIGNED answer per side and never writes a fabricated 0
 * (owner law 04/11: "giá đã ký phải dùng đúng theo loại xe/cont, không trả
 * 0"). The two sides read DIFFERENT signed tables:
 *   - Cước thu (revenue) ← the customer pricing engine preview. AUTO total > 0
 *     seeds an absent/0 field; MANUAL (no signed row for the key) clears a
 *     stored fake 0 and names the gap.
 *   - Cước trả (cost) ← the nhà-xe price board cascade (route × loại xe ×
 *     [supplier], giá riêng → giá chung) — NOT the customer freight: QA r2
 *     proved the board price (3.937.500₫) differs from the thu total. A
 *     matched price > 0 seeds an absent/0 field for ANY carrier (OWN reads
 *     the giá-chung row; an external carrier rides its supplierId); a board
 *     miss clears a stored fake 0.
 * Operator-entered values are never rewritten, and `null` returns mean no
 * state change. The cost seed ignores an idle/no-ask board query (null input)
 * — an LCL row or weightless container has no class to ask with, and the
 * Phát-lệnh save blocks loudly on missing weight on its own. */
export interface FreightSeedPreview {
  source: 'AUTO' | 'MANUAL';
  total: number;
}

export interface CarrierSeedPrice {
  price: number;
  matched: 'SUPPLIER' | 'GENERIC' | null;
}

export function seededFees(
  draft: { plannedRevenue: number | ''; plannedCarrierCost: number | '' },
  freightPreview: FreightSeedPreview | null | undefined,
  carrierPrice: CarrierSeedPrice | null | undefined,
): { plannedRevenue?: number | ''; plannedCarrierCost?: number | '' } | null {
  const seeded: { plannedRevenue?: number | ''; plannedCarrierCost?: number | '' } = {};
  if (freightPreview) {
    const needsRevenueSeed = draft.plannedRevenue === '' || draft.plannedRevenue === 0;
    if (freightPreview.source === 'AUTO' && freightPreview.total > 0 && needsRevenueSeed) {
      seeded.plannedRevenue = freightPreview.total;
    } else if (freightPreview.source === 'MANUAL' && draft.plannedRevenue === 0) {
      seeded.plannedRevenue = '';
    }
  }
  if (carrierPrice) {
    const needsCostSeed = draft.plannedCarrierCost === '' || draft.plannedCarrierCost === 0;
    if (carrierPrice.matched != null && carrierPrice.price > 0 && needsCostSeed) {
      seeded.plannedCarrierCost = carrierPrice.price;
    } else if ((carrierPrice.matched == null || carrierPrice.price <= 0) && draft.plannedCarrierCost === 0) {
      // Board miss: a stored 0 was never a price — the help text names the
      // gap; the dispatcher types one or leaves the field empty.
      seeded.plannedCarrierCost = '';
    }
  }
  return seeded.plannedRevenue !== undefined || seeded.plannedCarrierCost !== undefined ? seeded : null;
}

/* ── Owner redesign 23/10 — LCL cargo lines, shared by table + card ────────
 * Moved verbatim from DetailedPlanGrid.tsx (FB-092) so the mobile card list
 * reads the SAME cargo/measure derivation; the grid re-exports them to keep
 * the existing import surface. */
export function lclCargoLine(row: DispatchDetailPlanRow): string | null {
  const lcl = row.lcl;
  if (!lcl) return null;
  return [
    lcl.packageCount != null ? formatNumber(lcl.packageCount) : null,
    lcl.packageType?.trim() || null,
  ].filter(Boolean).join(' ') || null;
}

export function lclMeasureLine(row: DispatchDetailPlanRow): string | null {
  const lcl = row.lcl;
  const weight = row.container.cargoWeightKg != null && row.container.cargoWeightKg !== ''
    ? formatWeight(row.container.cargoWeightKg)
    : null;
  if (!lcl) return weight;
  return [
    weight,
    lcl.cargoVolumeCbm ? formatVolumeCbm(lcl.cargoVolumeCbm) : null,
  ].filter(Boolean).join(' · ') || null;
}
