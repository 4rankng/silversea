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
  | { ok: true; input: FreightPreviewQueryInput }
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
  return { ok: true, input: { customerId, routeId, vehicleSizeClassCode, transportDate } };
}
