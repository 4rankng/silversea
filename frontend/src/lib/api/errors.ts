/**
 * Transport-level error type. Carries the HTTP status, the raw response body
 * (for callers that need to inspect it), and a human-readable message that has
 * already been run through the project's Vietnamese translation layer.
 *
 * Domain-specific error mapping (Zod field labels, etc.) lives in
 * `./errors.ts` and is composed in `fromResponse` — kept out of this file so
 * the HTTP transport stays generic.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly raw: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Parse a failed fetch response and produce a typed `ApiError`. The message
   * is the user-facing string already translated to Vietnamese where
   * applicable — callers should surface it as-is in toasts / inline errors.
   */
  static async fromResponse(res: Response): Promise<ApiError> {
    const body = await res.json().catch(() => ({}));
    return new ApiError(res.status, body, formatErrorMessage(body));
  }
}

/* ── Domain error translation ──────────────────────────────────────────────
 * The maps below translate Zod validation error shapes to Vietnamese
 * user-facing strings. They live in this file (not in client.ts) because they
 * are project-specific UX decisions, not transport concerns. Adding a new
 * field is a single line in `FIELD_VI`.
 * ------------------------------------------------------------------------ */

const FIELD_VI: Record<string, string> = {
  legs: 'Hành trình',
  'legs.origin': 'Điểm đi',
  'legs.destination': 'Điểm đến',
  'legs.km': 'Số km',
  'legs.loadingType': 'Loại tải',
  fuelMode: 'Chế độ nhiên liệu',
  fuelLitersOverride: 'Số lít dầu',
  fuelSupplementLiters: 'Dầu bổ sung',
  fuelSupplementReason: 'Lý do bổ sung',
  tollsDiscount: 'Tiền vé (công ty) đã thanh toán',
  tollsAddition: 'Tổng tiền đi đường',
  tollsStations: 'Số trạm',
  hasReturnCargo: 'Hàng về',
  driverSalary: 'Tiền kết hợp',
  revenue: 'Doanh thu',
  notes: 'Ghi chú',
  customerId: 'Khách hàng',
  routeId: 'Tuyến đường',
  truckId: 'Xe đầu kéo',
  driverId: 'Lái xe',
  cargoTypeId: 'Loại hàng',
  departureDate: 'Ngày xuất phát',
  containerCount: 'Số container',
  roadAllowanceOverride: 'Điều chỉnh tiền đi đường',
};

const MSG_VI: Record<string, string> = {
  'Array must contain at least 1 element': 'Phải có ít nhất 1 chặng hành trình',
  'Number must be greater than 0': 'Giá trị phải lớn hơn 0',
  Required: 'Trường bắt buộc',
};

/**
 * Translate any backend error body shape (Zod issue array, plain string, or
 * structured object) to a single Vietnamese user-facing string. Returns a
 * fallback message when the body shape is unrecognised.
 */
export function formatErrorMessage(body: unknown): string {
  const anyBody = body as Record<string, unknown> | undefined;
  const raw = anyBody?.error ?? anyBody?.detail ?? anyBody?.message;
  const details = anyBody?.details ?? (Array.isArray(raw) ? raw : null);

  if (Array.isArray(details) && details.length > 0) {
    return details
      .map(translateZodIssue)
      .filter(Boolean)
      .join('; ');
  }
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    return (raw as { message?: string }).message ?? JSON.stringify(raw);
  }
  return 'Lỗi không xác định';
}

interface ZodIssue {
  path: Array<string | number>;
  message: string;
}

function translateZodIssue(issue: ZodIssue): string {
  // Zod reports array indices numerically (legs.0.km). Strip them from the
  // label lookup path, but preserve a 1-based "Chặng N" prefix in the output
  // so users can see which leg failed.
  const rawPath: Array<string | number> = Array.isArray(issue?.path)
    ? issue.path
    : issue?.path
      ? [issue.path]
      : [];
  const idx = rawPath.find((s) => typeof s === 'number');
  const namedPath = rawPath.filter((s) => typeof s === 'string').join('.');
  const viField = namedPath ? FIELD_VI[namedPath] || namedPath : '';
  const viMsg = MSG_VI[issue?.message] || issue?.message || '';
  const prefix =
    typeof idx === 'number' && namedPath.startsWith('legs')
      ? `Chặng ${Number(idx) + 1} — `
      : '';
  return viField ? `${prefix}${viField}: ${viMsg}` : `${prefix}${viMsg}`;
}
