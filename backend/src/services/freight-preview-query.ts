// SIL-1147 — freight-preview query law (pure, db-free).
//
// The preview route used to throw the request through a strict zod object:
// any missing or non-numeric customerId/routeId coerced to NaN and answered
// `400 {"error":"Invalid input: expected number, received NaN"}` for EVERY
// probe that named the lot instead of the pricing key (QA r40b). A missing
// pricing term is not a malformed request — it is the preview's own MANUAL
// family: the answer must be a 200 MISSING_INPUT projection body naming the
// gap, the same contract the saved lot's detail projection uses (K2.24).
// Only a genuinely malformed date FORMAT stays a 400, with the verbatim
// Vietnamese message the old schema carried.
//
// Pure on purpose: backend tests are unit-only (AGENTS.md §2), so the law the
// route enforces lives here, pinable without an app boot.

/** The projection-aligned body the route answers when a pricing term is missing. */
export interface FreightPreviewMissingBody {
  readiness: 'MISSING_INPUT';
  message: string;
  missingInput: string;
}

export interface FreightPreviewQueryInput {
  customerId: number;
  routeId: number;
  vehicleSizeClassCode: string;
  transportDate: string;
}

export type ParsedFreightPreviewQuery =
  | { ok: true; mode: 'SHIPMENT'; shipmentId: number }
  | { ok: true; mode: 'KEYS'; input: FreightPreviewQueryInput }
  | { ok: false; kind: 'MISSING_INPUT'; body: FreightPreviewMissingBody }
  | { ok: false; kind: 'FORMAT'; message: string };

/** Express query values: undefined | string | string[]. A one-element array is
 *  the same single value; anything wider is garbage (the old z.coerce answered
 *  NaN for it — the defect class this module replaces). */
function queryString(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length === 1 ? queryString(value[0]) : null;
  return typeof value === 'string' ? value : null;
}

/** A query id counts as provided only when it is a positive integer — the two
 *  ids (customer, route) must normalize in lockstep so the NaN class (0, -2,
 *  "abc", "1.5", multi-value) can never reach the engine as a number. */
function queryPositiveInt(value: unknown): number | null {
  const raw = queryString(value);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseFreightPreviewQuery(query: Record<string, unknown>): ParsedFreightPreviewQuery {
  // SIL-1147 retest (QA r42): the saved-lot probe `?shipmentId=1207` is the
  // contract QA verifies — the preview must resolve the pricing key from the
  // lot itself (the same grounds the freeze uses), not demand the explicit
  // key the CUS create form sends. A present-but-malformed id is a caller
  // bug, same class as the malformed date: FORMAT 400.
  const rawShipmentId = query.shipmentId;
  const hasShipmentId = rawShipmentId != null
    && !(typeof rawShipmentId === 'string' && rawShipmentId.trim() === '');
  if (hasShipmentId) {
    const text = queryString(rawShipmentId);
    const shipmentId = text != null ? Number(text) : Number.NaN;
    if (!Number.isInteger(shipmentId) || shipmentId < 1) {
      return { ok: false, kind: 'FORMAT', message: 'shipmentId phải là số nguyên dương' };
    }
    return { ok: true, mode: 'SHIPMENT', shipmentId };
  }
  const customerId = queryPositiveInt(query.customerId);
  if (customerId == null) {
    return {
      ok: false,
      kind: 'MISSING_INPUT',
      body: { readiness: 'MISSING_INPUT', message: 'Thiếu khách hàng để xem cước dự kiến.', missingInput: 'khách hàng' },
    };
  }
  const routeId = queryPositiveInt(query.routeId);
  if (routeId == null) {
    return {
      ok: false,
      kind: 'MISSING_INPUT',
      body: { readiness: 'MISSING_INPUT', message: 'Thiếu tuyến đường để xem cước dự kiến.', missingInput: 'tuyến đường' },
    };
  }
  const vehicleSizeClassCode = queryString(query.vehicleSizeClassCode)?.trim() ?? '';
  if (!vehicleSizeClassCode) {
    return {
      ok: false,
      kind: 'MISSING_INPUT',
      body: { readiness: 'MISSING_INPUT', message: 'Thiếu loại xe tính cước để xem cước dự kiến.', missingInput: 'loại xe tính cước' },
    };
  }
  const transportDate = queryString(query.transportDate)?.trim() ?? '';
  if (!transportDate) {
    return {
      ok: false,
      kind: 'MISSING_INPUT',
      body: { readiness: 'MISSING_INPUT', message: 'Thiếu ngày vận chuyển để xem cước dự kiến.', missingInput: 'ngày vận chuyển' },
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transportDate)) {
    // A malformed date is a caller bug, not a missing pricing term — keep the
    // verbatim 400 message the strict schema carried (SIL-1147 only retires
    // the NaN class).
    return { ok: false, kind: 'FORMAT', message: 'Ngày vận chuyển phải có dạng YYYY-MM-DD' };
  }
  return { ok: true, mode: 'KEYS', input: { customerId, routeId, vehicleSizeClassCode, transportDate } };
}

/** The MISSING_INPUT body for a saved-lot preview whose pricing basis is
 *  incomplete — the same gaps the KEYS mode names, plus the weight column a
 *  CONT20/CONT40 basis needs. REV_GROUPED is the merged-LCL 0-share law's
 *  verdict (the group owns a member's cước thu — never its own price to
 *  preview). Pure so the unit suite pins it without a db. */
export function freightPreviewSkipBody(
  reason: 'AD_HOC' | 'REV_GROUPED' | 'NO_CUSTOMER' | 'NO_ROUTE' | 'NO_RATE_KEY' | 'NO_TRANSPORT_DATE' | 'MISSING_WEIGHT',
): FreightPreviewMissingBody {
  switch (reason) {
    case 'NO_CUSTOMER':
      return { readiness: 'MISSING_INPUT', message: 'Thiếu khách hàng để xem cước dự kiến.', missingInput: 'khách hàng' };
    case 'NO_ROUTE':
      return { readiness: 'MISSING_INPUT', message: 'Thiếu tuyến đường để xem cước dự kiến.', missingInput: 'tuyến đường' };
    case 'NO_RATE_KEY':
      return { readiness: 'MISSING_INPUT', message: 'Thiếu loại xe tính cước để xem cước dự kiến.', missingInput: 'loại xe tính cước' };
    case 'NO_TRANSPORT_DATE':
      return { readiness: 'MISSING_INPUT', message: 'Thiếu ngày vận chuyển để xem cước dự kiến.', missingInput: 'ngày vận chuyển' };
    case 'MISSING_WEIGHT':
      return { readiness: 'MISSING_INPUT', message: 'Thiếu trọng tải hàng để chọn cột giá container.', missingInput: 'trọng tải hàng' };
    case 'AD_HOC':
      return {
        readiness: 'MISSING_INPUT',
        message: 'Lô lệnh chạy ngoài không áp bảng giá tự động — cần nhập tay giá cước.',
        missingInput: 'lô lệnh chạy ngoài',
      };
    case 'REV_GROUPED':
      return {
        readiness: 'MISSING_INPUT',
        message: 'Lô đã ghép cước thu khách — cước vận tải do nhóm ghép giữ (Lô 1 giữ 100% cước thu nhóm); tách nhóm để xem cước riêng.',
        missingInput: 'cước riêng của lô (đã ghép cước)',
      };
  }
}
