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

/** Row prefixes for issues inside an array field — a 1-based, user-facing label
 *  instead of the raw index path. */
const ARRAY_ROOT_LABELS: Record<string, string> = {
  legs: 'Chặng',
  containers: 'Container',
};

/** Zod's own English phrasing is internal vocabulary and must never reach a
 *  user; custom messages (the Vietnamese ones our schemas declare) pass
 *  through untouched. */
const ZOD_INTERNAL_MESSAGE = /^(Expected |Invalid |Required$|String must |Number must |Array must |Unrecognized key|Too (small|big))/;
const UNKNOWN_VALUE_MESSAGE = 'Giá trị không hợp lệ';

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
    const issues = details.filter(isRecord).map((entry) => ({
      path: Array.isArray(entry.path) ? entry.path : [],
      message: typeof entry.message === 'string' ? entry.message : '',
    }));
    if (issues.length > 0) return formatIssueList(issues);
  }
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null && 'message' in raw && typeof raw.message === 'string') {
    return raw.message;
  }
  return raw === undefined || raw === null ? 'Lỗi không xác định' : UNKNOWN_VALUE_MESSAGE;
}

interface ZodIssue {
  path: Array<string | number>;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface TranslatedIssue {
  /** The row the issue belongs to, when the path names an item of a labeled
   *  array ("Container 3", "Chặng 2"); null for shipment-level fields. */
  row: string | null;
  /** The sentence to show — never an internal field path. */
  text: string;
}

/** Translate one issue. Internal field paths are dropped entirely: a path with
 *  no known label contributes no text of its own, only the (translated)
 *  message. */
function translateZodIssue(issue: ZodIssue): TranslatedIssue {
  const rawPath: Array<string | number> = Array.isArray(issue?.path)
    ? issue.path
    : issue?.path
      ? [issue.path]
      : [];
  const idx = rawPath.find((segment) => typeof segment === 'number');
  const namedPath = rawPath.filter((segment) => typeof segment === 'string').join('.');
  const rootLabel = typeof idx === 'number' && typeof rawPath[0] === 'string'
    ? ARRAY_ROOT_LABELS[rawPath[0]]
    : undefined;
  const message = issue?.message ?? '';
  const viMessage = MSG_VI[message] ?? (ZOD_INTERNAL_MESSAGE.test(message) ? UNKNOWN_VALUE_MESSAGE : message);
  const viField = namedPath ? FIELD_VI[namedPath] : undefined;
  // Our schemas already put the Vietnamese field name inside the message
  // ("Khách hàng là bắt buộc"); prefixing the label again would read twice.
  const labelAddsDetail = viField != null && !viMessage.toLowerCase().startsWith(viField.toLowerCase());
  return {
    row: rootLabel ? `${rootLabel} ${Number(idx) + 1}` : null,
    text: labelAddsDetail ? `${viField}: ${viMessage}` : viMessage,
  };
}

/** The same sentence on five rows is one problem, not five banner lines: group
 *  by sentence in first-seen order and list the rows it covers. */
function formatIssueList(issues: ZodIssue[]): string {
  const groups = new Map<string, string[]>();
  for (const issue of issues) {
    const { row, text } = translateZodIssue(issue);
    if (!text) continue;
    const rows = groups.get(text) ?? [];
    if (row && !rows.includes(row)) rows.push(row);
    groups.set(text, rows);
  }
  return [...groups].map(([text, rows]) => {
    if (rows.length === 0) return text;
    if (rows.length === 1) return `${rows[0]} — ${text}`;
    return `${joinRowLabels(rows)}: ${text}`;
  }).join('; ');
}

/** "Container 1, Container 3" reads as noise — one shared root word carries the
 *  list ("Container 1, 3"). Mixed roots keep their full labels. */
function joinRowLabels(rows: string[]): string {
  const parts = rows.map((row) => /^(.*) (\d+)$/.exec(row));
  const root = parts[0]?.[1];
  if (root && parts.every((part) => part?.[1] === root)) {
    return `${root} ${parts.map((part) => part?.[2]).join(', ')}`;
  }
  return rows.join(', ');
}
