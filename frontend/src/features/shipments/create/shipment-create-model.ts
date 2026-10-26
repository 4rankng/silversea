import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { ShipmentStatus } from '@tingting/shared';

export type CargoMode = 'FCL' | 'LCL';
export type SaveIntent = 'DRAFT' | 'CREATE' | 'SUBMIT';

export interface ShipmentCreateFormState {
  customerId: string;
  /** Lệnh chạy ngoài (MasterDataNhaMay §4): free-text customer when no
   *  catalog row is selected — payload sends rawCustomerName + null id. */
  isAdHoc: boolean;
  rawCustomerName: string;
  rawRouteName: string;
  /** Ad-hoc LCL free-text factory (payload factoryName; catalog LCL derives
   *  it from the picked site instead). */
  factoryName: string;
  routeId: string;
  cargoTypeId: string;
  bookingRef: string;
  blNumber: string;
  shippingLineName: string;
  declarationNumber: string;
  declarationNumbers?: string[];
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  cargoMode: CargoMode;
  isCombined: boolean;
  /** Card 20260922_6 — "có cược" intake tick + expected amount (string input
   *  state; payload coerces digits). Intake intent only — the persisted
   *  outcome is the deposit_refund_trackers row from the create tx. */
  hasDeposit: boolean;
  depositAmount: string;
  operationalSiteId: string;
  pickupWarehouseSiteId: string;
  /** Kho (CFS/Cảng) free text for hàng lẻ (FB-105 spec §2: the picker accepts a
   *  catalog pick OR typed text). Meaning follows `tradeDirection`: Nhập khẩu =
   *  "Kho lấy hàng", Xuất khẩu = "Kho trả hàng". The payload maps it onto the
   *  lot's direction-correct lift/drop name (pickup_location /
   *  delivery_location); the catalog pick still rides `pickupWarehouseSiteId`. */
  pickupWarehouseName: string;
  customsCutoffAt: string;
  closingAt: string;
  plannedReturnAt: string;
  expectedDeliveryDate: string;
  /**
   * LCL split-lot extra delivery dates (doc Create Shipment Block 2B: "[+]"
   * adds more delivery days). The backend has no array column for these yet,
   * so they persist formatted inside the driver note; the first date is
   * `expectedDeliveryDate` proper and drives the auto-status rule.
   */
  extraDeliveryDates: string[];
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  packageCount: string;
  packageType: string;
  operationalNotes: string;
}

export interface ShipmentContainerDraft {
  key: string;
  /** Persisted row id when the draft edits an EXISTING container (SIL-171
   *  edit mode). The batch reconcile updates by id and deletes the rest, so
   *  carrying it keeps an unchanged edit an UPDATE — without it every save
   *  would delete + reinsert the lot's containers (and 409 on lots with
   *  issued dispatch orders). Undefined on the create form. */
  id?: number;
  containerNumber: string;
  containerTypeId: string;
  /** Selected independently for this container. */
  routeId: string;
  /** Ad-hoc free-text row route (Lệnh chạy ngoài §4.2) — XOR with routeId. */
  rawRouteName: string;
  pickupPortId: string;
  dropoffPortId: string;
  /** Ad-hoc free-text cảng nâng/hạ (Lệnh chạy ngoài) — XOR with the ids. */
  rawPickupPortName: string;
  rawDropoffPortName: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  /** Ngày giờ đóng/trả của riêng container này, entered in Vietnam local time. */
  customerAppointmentAt: string;
  /** Per-container factory authority (SILVER L1): empty inherits nothing —
   *  the shipment factory pre-fills new rows as a suggestion only. */
  operationalSiteId: string;
  /** Ad-hoc free-text row factory (Lệnh chạy ngoài §4.2) — XOR with the id. */
  rawFactoryName: string;
}

/** `mode` is the top-of-form Loại hàng band (cards 211026130215/30315): it
 *  carries no validation issues (the mode is always chosen), so it never joins
 *  `sectionDefinitions` — it exists for the section DOM id only. */
export type ShipmentCreateSectionId = 'identity' | 'route' | 'cargo' | 'schedule' | 'mode';

export interface ShipmentCreateIssue {
  fieldId: string;
  message: string;
  sectionId: ShipmentCreateSectionId;
}

export interface ShipmentCreateSectionReadiness {
  id: ShipmentCreateSectionId;
  label: string;
  complete: boolean;
  missingCount: number;
}

export interface ShipmentCreateReadiness {
  draftReady: boolean;
  dispatchReady: boolean;
  initialStatus: ShipmentStatus.PENDING_DATE | ShipmentStatus.READY_FOR_DISPATCH;
  issues: ShipmentCreateIssue[];
  sections: ShipmentCreateSectionReadiness[];
  firstInvalidFieldId: string | null;
}

export const EMPTY_SHIPMENT_CREATE_FORM: ShipmentCreateFormState = {
  customerId: '',
  isAdHoc: false,
  rawCustomerName: '',
  rawRouteName: '',
  factoryName: '',
  routeId: '',
  cargoTypeId: '',
  bookingRef: '',
  blNumber: '',
  shippingLineName: '',
  declarationNumber: '',
  declarationNumbers: [],
  tradeDirection: '',
  cargoMode: 'FCL',
  isCombined: false,
  hasDeposit: false,
  depositAmount: '',
  operationalSiteId: '',
  pickupWarehouseSiteId: '',
  pickupWarehouseName: '',
  customsCutoffAt: '',
  closingAt: '',
  plannedReturnAt: '',
  expectedDeliveryDate: '',
  extraDeliveryDates: [],
  cargoWeightKg: '',
  cargoVolumeCbm: '',
  packageCount: '',
  packageType: '',
  operationalNotes: '',
};

/** VN đồng formatting for the deposit-amount input: digits in, dotted
 *  thousands out ("5000000" → "5.000.000"). Payload strips non-digits. */
export function formatVnMoney(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function createEmptyContainer(): ShipmentContainerDraft {
  return {
    key: crypto.randomUUID(),
    containerNumber: '',
    containerTypeId: '',
    routeId: '',
    rawRouteName: '',
    pickupPortId: '',
    dropoffPortId: '',
    rawPickupPortName: '',
    rawDropoffPortName: '',
    cargoWeightKg: '',
    cargoVolumeCbm: '',
    customerAppointmentAt: '',
    operationalSiteId: '',
    rawFactoryName: '',
  };
}

/**
 * Start a new FCL row from the preceding row's data (REQ-22 REVERSED, ticket
 * 221026173728 22/10 — SIL-488 closes the workspace gap of reversal 093c5334,
 * which only reached the CUS ledger): pressing "Thêm container" inherits the
 * previous row's shared fields — route, factory, ports, weight and the
 * schedule window — but NEVER its two per-container identifiers: the
 * Số container stays empty for entry and the Loại cont stays blank ("Chọn
 * loại") for the operator's own pick. The payload already sends an EXPLICIT
 * `containerTypeId: null` when unpicked, so the server cannot re-copy either.
 */
export function createContainerFromPrevious(
  previous?: ShipmentContainerDraft,
): ShipmentContainerDraft {
  if (!previous) return createEmptyContainer();

  return {
    ...previous,
    key: crypto.randomUUID(),
    containerNumber: '',
    containerTypeId: '',
    // SIL-171: a cloned row is a NEW container — never inherit the source
    // row's persisted id (the reconcile would overwrite its sibling).
    id: undefined,
  };
}

/**
 * SIL-513 (owner 26/10): the STT column's hover copy DUPLICATES the row — a
 * full-value copy of the source line (số cont, loại, nhà máy, tuyến, cảng,
 * kg, giờ đóng/trả) inserted right below it. Deliberately DIFFERENT from
 * `createContainerFromPrevious` (whose REQ-22-reversed contract leaves số
 * cont + loại empty for "Thêm container"): the owner names cont and loại
 * among the copied values, so this clone carries the whole line. Still never
 * inherits the persisted `id` — a duplicated row is a NEW container; the
 * reconcile would overwrite its sibling.
 */
export function duplicateContainerRow(
  previous: ShipmentContainerDraft,
): ShipmentContainerDraft {
  return {
    ...previous,
    key: crypto.randomUUID(),
    id: undefined,
  };
}

function issue(
  fieldId: string,
  message: string,
  sectionId: ShipmentCreateSectionId,
): ShipmentCreateIssue {
  return { fieldId, message, sectionId };
}

export function getShipmentCreateReadiness(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
): ShipmentCreateReadiness {
  const issues: ShipmentCreateIssue[] = [];
  // Ad-hoc bypass (MasterDataNhaMay §4.1): catalog/pricing prerequisites are
  // waived; data-safety checks (direction, doc ref, ISO numbers, positive
  // quantities, dates) still apply unchanged.
  const adHoc = form.isAdHoc;

  if (!adHoc && !form.customerId) {
    issues.push(issue('shipment-customer', 'Chọn khách hàng.', 'identity'));
  }
  if (adHoc && !form.customerId && !form.rawCustomerName.trim()) {
    issues.push(issue('shipment-customer', 'Nhập tên khách hàng (lệnh chạy ngoài).', 'identity'));
  }
  if (!form.tradeDirection) {
    issues.push(issue('shipment-trade-direction', 'Chọn hình thức nhập khẩu hoặc xuất khẩu.', 'identity'));
  } else if (form.tradeDirection === 'IMPORT' && !form.blNumber) {
    issues.push(issue('shipment-booking-ref', 'Hàng Nhập cần Số Bill.', 'identity'));
  } else if (form.tradeDirection === 'EXPORT' && !form.bookingRef) {
    issues.push(issue('shipment-booking-ref', 'Hàng Xuất cần Số Booking.', 'identity'));
  }
  if (!adHoc && form.cargoMode === 'LCL' && !form.routeId) {
    issues.push(issue('shipment-route', 'Chọn tuyến đường.', 'route'));
  }

  if (form.cargoMode === 'FCL') {
    containers.forEach((row, index) => {
      const prefix = `container-${row.key}`;
      const label = `Container ${index + 1}`;
      if (!row.containerTypeId) issues.push(issue(`${prefix}-type`, `${label}: chọn loại container.`, 'cargo'));
      if (!adHoc) {
        if (!row.operationalSiteId) issues.push(issue(`${prefix}-factory`, `${label}: chọn nhà máy.`, 'cargo'));
        if (!row.routeId) issues.push(issue(`${prefix}-route`, `${label}: chọn tuyến đường.`, 'cargo'));
        if (!row.pickupPortId) issues.push(issue(`${prefix}-pickup-port`, `${label}: chọn cảng nâng.`, 'cargo'));
        if (!row.dropoffPortId) issues.push(issue(`${prefix}-dropoff-port`, `${label}: chọn cảng hạ.`, 'cargo'));
      }
      if (!row.customerAppointmentAt) issues.push(issue(`${prefix}-customer-appointment`, `${label}: chọn ngày giờ đóng/trả.`, 'schedule'));
    });
  } else {
    // FB-105 (spec §2): a hàng lẻ lot needs BOTH operating points — the Nhà máy
    // and the Kho (CFS/Cảng) — and each accepts a catalog pick OR typed text
    // (the "+ Thêm kho" button is the catalog route). Ad-hoc lots waive the
    // catalog prerequisites as before.
    if (!adHoc && !form.operationalSiteId && !form.factoryName.trim()) {
      issues.push(issue('shipment-operational-site', 'Chọn nhà máy.', 'route'));
    }
    if (!adHoc && !form.pickupWarehouseSiteId && !form.pickupWarehouseName.trim()) {
      issues.push(issue('shipment-pickup-warehouse', 'Chọn kho lấy hàng.', 'route'));
    }
    if (!form.packageType) issues.push(issue('shipment-package-type', 'Nhập quy cách đóng gói.', 'cargo'));
    if (!form.packageCount || Number(form.packageCount) < 1) issues.push(issue('shipment-package-count', 'Nhập số lượng kiện lớn hơn 0.', 'cargo'));
    if (!form.cargoWeightKg || Number(form.cargoWeightKg) <= 0) issues.push(issue('shipment-cargo-weight', 'Nhập trọng lượng lớn hơn 0.', 'cargo'));
    // Helpdesk 2026-10-13 (ops Tiếp Vu): CBM is optional for LCL — blank (or
    // whitespace-only) is not an issue; an entered value must still be > 0.
    if (form.cargoVolumeCbm.trim() && Number(form.cargoVolumeCbm) <= 0) issues.push(issue('shipment-cargo-volume', 'Nhập thể tích lớn hơn 0.', 'cargo'));
    if (!form.expectedDeliveryDate) issues.push(issue('shipment-expected-delivery', 'Chọn ngày giao hàng.', 'schedule'));
  }

  const sectionDefinitions: Array<[ShipmentCreateSectionId, string]> = [
    ['identity', 'Nhận diện lô'],
    ['route', 'Điểm vận hành & tuyến'],
    ['cargo', 'Thông tin hàng'],
    ['schedule', 'Lịch & ghi chú'],
  ];
  const sections = sectionDefinitions.map(([id, label]) => {
    const missingCount = issues.filter((item) => item.sectionId === id).length;
    return { id, label, complete: missingCount === 0, missingCount };
  });

  return {
    // Ad-hoc drafts are create-ready with a free-text customer instead of a
    // catalog id (Lệnh chạy ngoài §4.1).
    draftReady: Boolean(form.customerId) || (form.isAdHoc && Boolean(form.rawCustomerName.trim())),
    dispatchReady: issues.length === 0,
    initialStatus: form.cargoMode === 'LCL' && (form.expectedDeliveryDate || form.closingAt || form.plannedReturnAt)
      ? ShipmentStatus.READY_FOR_DISPATCH
      : ShipmentStatus.PENDING_DATE,
    issues,
    sections,
    firstInvalidFieldId: issues[0]?.fieldId ?? null,
  };
}

/** DRAFT = partial save (customer only). CREATE = full intake validation.
 *  SUBMIT = CREATE + submit-for-dispatch (no UI caller today; pre-existing,
 *  left in place). */
export function validateShipmentCreate(
  intent: SaveIntent,
  readiness: ShipmentCreateReadiness,
): ShipmentCreateIssue[] {
  if (intent === 'DRAFT') {
    return readiness.draftReady
      ? []
      : [issue('shipment-customer', 'Chọn khách hàng để tạo lô hàng.', 'identity')];
  }
  return readiness.issues;
}

interface OperationalSiteName {
  id: number;
  name: string;
  shortName?: string;
}

/** A different customer's factories cannot remain on a draft. Preserve an
 * independently chosen route, including a manual ad-hoc route override. */
export function resetCustomerSite(
  selection: { operationalSiteId: string; routeId: string },
  sites: ReadonlyArray<{ id: number; routeId: number | null }>,
) {
  const factoryRoute = sites.find((site) => String(site.id) === selection.operationalSiteId)?.routeId;
  return {
    operationalSiteId: '',
    routeId: factoryRoute != null && String(factoryRoute) === selection.routeId ? '' : selection.routeId,
  };
}

export function buildShipmentRootPayload(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
  sites: OperationalSiteName[],
) {
  // FB-105 (spec §2/§3): hàng lẻ names BOTH operating points, and the Kho
  // (CFS/Cảng) field means "Kho lấy hàng" for hàng Nhập and "Kho trả hàng" for
  // hàng Xuất. Resolve the display names once (catalog short name first, else
  // the typed free text) and store them on the direction-correct lift/drop
  // columns so điều vận prints Nâng/Trả instead of "—".
  const siteLabel = (siteId: string, fallback: string) => {
    const site = siteId ? sites.find((item) => String(item.id) === siteId) : undefined;
    return (site ? site.shortName || site.name : '') || fallback.trim();
  };
  const isLcl = form.cargoMode === 'LCL';
  const exportLot = form.tradeDirection === 'EXPORT';
  const warehouseName = siteLabel(form.pickupWarehouseSiteId, form.pickupWarehouseName);
  const factoryName = siteLabel(form.operationalSiteId, form.factoryName);
  return {
    // Hybrid intake (Lệnh chạy ngoài): catalog id when selected, else null +
    // the raw free text. XOR is normalized again server-side.
    customerId: form.customerId ? Number(form.customerId) : null,
    isAdHoc: form.isAdHoc,
    rawCustomerName: !form.customerId && form.isAdHoc ? form.rawCustomerName.trim() || null : null,
    rawRouteName: !form.routeId && form.isAdHoc ? form.rawRouteName.trim() || null : null,
    // Route authority for FCL lives in shipment_containers. Keep the root
    // column empty so no later reader can mistake it for a lot-level route.
    routeId: form.cargoMode === 'LCL' && form.routeId ? Number(form.routeId) : null,
    cargoTypeId: form.cargoTypeId ? Number(form.cargoTypeId) : null,
    bookingRef: form.tradeDirection === 'EXPORT' ? form.bookingRef || null : null,
    blNumber: form.tradeDirection === 'IMPORT' ? form.blNumber || null : null,
    tradeDirection: form.tradeDirection || null,
    cargoMode: form.cargoMode,
    isCombined: form.isCombined,
    hasDeposit: form.hasDeposit,
    depositAmount: form.hasDeposit ? Number(form.depositAmount.replace(/\D/g, '')) || null : null,
    operationalSiteId: form.cargoMode === 'LCL' && form.operationalSiteId ? Number(form.operationalSiteId) : null,
    pickupWarehouseSiteId: form.cargoMode === 'LCL' && form.pickupWarehouseSiteId ? Number(form.pickupWarehouseSiteId) : null,
    factoryName: (() => {
      if (form.isAdHoc) return form.factoryName.trim() || null;
      if (!isLcl) return null;
      return factoryName || null;
    })(),
    // FB-105 §3 — the lot's two operating points, direction-correct: Nhập khẩu
    // lấy tại Kho (CFS) giao tại Nhà máy; Xuất khẩu lấy tại Nhà máy giao tại
    // Kho (CFS). FCL keeps these columns untouched (its points live on the
    // containers' ports — never overwrite them from the root payload).
    ...(isLcl ? {
      pickupLocation: (exportLot ? factoryName : warehouseName) || null,
      deliveryLocation: (exportLot ? warehouseName : factoryName) || null,
    } : {}),
    shippingLineName: form.cargoMode === 'FCL' ? form.shippingLineName || null : null,
    customsCutoffAt: localDateTimeToIso(form.customsCutoffAt),
    closingAt: localDateTimeToIso(form.closingAt),
    plannedReturnAt: localDateTimeToIso(form.plannedReturnAt),
    // FCL's lot date is derived by the container reconcile in the backend;
    // only LCL retains a shipment-level delivery date.
    expectedDeliveryDate: form.cargoMode === 'LCL' ? form.expectedDeliveryDate || null : undefined,
    cargoWeightKg: form.cargoMode === 'LCL' ? form.cargoWeightKg || null : null,
    cargoVolumeCbm: form.cargoMode === 'LCL' ? form.cargoVolumeCbm.trim() || null : null,
    packageCount: form.cargoMode === 'LCL' && form.packageCount ? Number(form.packageCount) : null,
    packageType: form.cargoMode === 'LCL' ? form.packageType || null : null,
    driverNotes: [
      form.cargoMode === 'LCL' && form.extraDeliveryDates.length > 0
        ? `Ngày giao bổ sung: ${form.extraDeliveryDates.filter(Boolean).join(', ')}`
        : '',
      form.operationalNotes,
    ].filter(Boolean).join('\n') || null,
  };
}

export function buildShipmentContainerPayload(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
) {
  const rows = form.cargoMode === 'FCL'
    ? containers.filter((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value))
    : [];
  return rows.map((row) => ({
    // SIL-171 edit mode: existing rows ride their persisted id so the
    // reconcile updates in place instead of delete + reinsert.
    ...(row.id != null ? { id: row.id } : {}),
    containerNumber: row.containerNumber || null,
    containerTypeId: row.containerTypeId ? Number(row.containerTypeId) : null,
    shippingLineName: form.shippingLineName || null,
    routeId: row.routeId ? Number(row.routeId) : null,
    rawRouteName: !row.routeId && form.isAdHoc ? row.rawRouteName.trim() || null : null,
    pickupPortId: row.pickupPortId ? Number(row.pickupPortId) : null,
    dropoffPortId: row.dropoffPortId ? Number(row.dropoffPortId) : null,
    rawPickupPortName: !row.pickupPortId && form.isAdHoc ? row.rawPickupPortName.trim() || null : null,
    rawDropoffPortName: !row.dropoffPortId && form.isAdHoc ? row.rawDropoffPortName.trim() || null : null,
    operationalSiteId: row.operationalSiteId ? Number(row.operationalSiteId) : null,
    rawFactoryName: !row.operationalSiteId && form.isAdHoc ? row.rawFactoryName.trim() || null : null,
    cargoWeightKg: row.cargoWeightKg || null,
    cargoVolumeCbm: row.cargoVolumeCbm || null,
    customerAppointmentAt: localDateTimeToIso(row.customerAppointmentAt),
  }));
}
