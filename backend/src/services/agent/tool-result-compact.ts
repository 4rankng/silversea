// Compact a tool result before echoing it back into the ReAct `messages` so a
// large payload doesn't re-bill multi-thousand-token raw JSON on every loop
// iteration — AND (unlike a blind character slice) never hands the model a JSON
// string that was cut mid-object/number (which corrupts synthesis). The char
// budget is always enforced, but truncation happens at a complete value/row
// boundary.
//
// Shapes handled:
//  - Array of row-objects (the data.* gateway's common list shape): cap rows,
//    drop null/undefined/empty-string columns per row, annotate how many were
//    elided. If still over budget, drop trailing rows until it fits.
//  - Envelope object `{ rows|data|items|…: [...], total, count, summary }`:
//    cap/shrink the array payload, KEEP the summary scalars (totals must not be
//    lost when rows are trimmed).
//  - Anything else: serialize and, if over budget, cut at the last complete
//    value boundary, then re-close any containers the cut left open.

export interface CompactOptions {
  /** Max rows retained from an array-of-rows payload (default 20). */
  maxRows?: number;
  /** Hard char budget on the serialized view (default 6_000, ~1.5k tokens). */
  maxChars?: number;
}

const DEFAULT_MAX_ROWS = 20;
const DEFAULT_MAX_CHARS = 6_000;
// Common envelope keys that carry the array payload of a list/report result.
const ARRAY_PAYLOAD_KEYS = ['rows', 'data', 'items', 'results', 'records', 'list'] as const;

export function compactToolResult(data: unknown, opts: CompactOptions = {}): string {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const json = JSON.stringify(shapeForModel(data, maxRows));
  if (json.length <= maxChars) return json;

  // Oversized: shrink an array payload (the common oversized shape) row-by-row
  // until it fits, annotating how many rows were elided.
  const shrunk = shrinkArrayPayload(data, maxRows, maxChars);
  if (shrunk !== null) return shrunk;

  // Non-array and over budget (e.g. one giant object): cut the serialized
  // string at the last complete value boundary so the model never sees a
  // truncated number/object/string.
  return cutAtSafeBoundary(json, maxChars);
}

/** Cap rows + drop empty columns from an array payload (top-level or envelope). */
function shapeForModel(data: unknown, maxRows: number): unknown {
  if (Array.isArray(data)) return capRows(dropEmpties(data), maxRows);
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const key = ARRAY_PAYLOAD_KEYS.find((k) => Array.isArray(obj[k]));
    if (key) return { ...obj, [key]: capRows(dropEmpties(obj[key] as unknown[]), maxRows) };
  }
  return data;
}

/** Remove null/undefined/'' values from row-objects (noise the model pays for). */
function dropEmpties(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v === '') continue;
      out[k] = v;
    }
    return out;
  });
}

function capRows(rows: unknown[], maxRows: number): unknown[] {
  const capped = rows.slice(0, maxRows);
  if (rows.length > maxRows) {
    capped.push({ _truncated: true, rowsShown: maxRows, rowsTotal: rows.length });
  }
  return capped;
}

/** Reduce an array payload until under budget. Returns null when `data` has no
 *  shrinkable array (caller then falls back to boundary-cut). */
function shrinkArrayPayload(data: unknown, maxRows: number, maxChars: number): string | null {
  const { target, key } = arrayLens(data);
  if (!target) return null;
  const total = target.length;
  // Start from the capped set and drop trailing rows until we fit (leaving room
  // for the elision marker).
  let rows = dropEmpties(target).slice(0, maxRows);
  while (rows.length > 0) {
    const marked = rowsWithMarker(rows, total);
    const candidate = key
      ? JSON.stringify({ ...(data as Record<string, unknown>), [key]: marked })
      : JSON.stringify(marked);
    if (candidate.length <= maxChars) return candidate;
    rows = rows.slice(0, rows.length - 1);
  }
  // Even a single row blows the budget → let the caller boundary-cut it.
  return null;
}

function rowsWithMarker(rows: unknown[], total: number): unknown[] {
  return [...rows, { _truncated: true, rowsShown: rows.length, rowsTotal: total }];
}

/** Locate the array to shrink: a top-level array, or the envelope payload key. */
function arrayLens(data: unknown): { target: unknown[] | null; key: string | null } {
  if (Array.isArray(data)) return { target: data, key: null };
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const key = ARRAY_PAYLOAD_KEYS.find((k) => Array.isArray(obj[k]));
    if (key) return { target: obj[key] as unknown[], key };
  }
  return { target: null, key: null };
}

/** Cut an oversized serialized JSON string down to ≤ maxChars while keeping it
 *  VALID JSON, then append an elision note. Prefers ending after a complete
 *  value (} ] , outside a string) so the model sees whole objects; when the
 *  budget lands inside one big string value (no such boundary), it closes the
 *  open string literal + any open containers and shrinks until it fits. */
export function cutAtSafeBoundary(json: string, maxChars: number): string {
  const note = '…(đã cắt)';
  if (json.length + note.length <= maxChars) return json + note;

  const limit = maxChars - note.length;

  // Complete-value boundary indices (} ] , outside a string) up to `limit`,
  // newest first → the most data retained that still fits.
  const bounds: number[] = [];
  scanJson(json, limit, (i, inString) => {
    if (!inString) {
      const ch = json[i];
      if (ch === '}' || ch === ']' || ch === ',') bounds.push(i);
    }
  });
  for (let k = bounds.length - 1; k >= 0; k--) {
    const sealed = closeOpenContainers(json.slice(0, bounds[k] + 1).replace(/,$/, ''));
    if (sealed.length + note.length <= maxChars) return sealed + note;
  }

  // No complete-value cut fits (budget is inside one big string/value): close
  // the open string + containers, shrinking the slice until it fits. If the
  // open string is a property KEY (preceded by `{`/`,`), DROP the partial key
  // — closing it would emit `{"partialkey"}` (key with no value = invalid JSON).
  for (let end = limit; end > 0; end--) {
    const slice = json.slice(0, end);
    let sealed: string;
    if (!endsInsideString(slice)) {
      sealed = closeOpenContainers(slice);
    } else {
      const openAt = openStringStart(slice);
      const before = charBeforeSkippingWs(slice, openAt);
      if (before === '{' || before === ',') {
        sealed = closeOpenContainers(slice.slice(0, openAt).replace(/[\s,]*$/, ''));
      } else {
        sealed = closeOpenContainers(slice.replace(/\\+$/, '') + '"');
      }
    }
    if (sealed.length + note.length <= maxChars) return sealed + note;
  }
  return note;
}

/** Walk `s` up to (exclusive) `limit`, calling `visit(i, inString)` per char.
 *  `inString` reflects state AFTER processing the char at `i`. */
function scanJson(s: string, limit: number, visit: (i: number, inString: boolean) => void): void {
  let inString = false;
  let escape = false;
  const end = Math.min(limit, s.length);
  for (let i = 0; i < end; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
    } else if (ch === '\\') {
      escape = true;
    } else if (ch === '"') {
      inString = !inString;
    }
    visit(i, inString);
  }
}

/** True when `slice` ends inside an unterminated string literal. */
function endsInsideString(slice: string): boolean {
  let inString = false;
  let escape = false;
  for (const ch of slice) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
  }
  return inString;
}

/** Index of the opening `"` of the currently-open string in `slice`, or -1
 *  when the slice does not end inside a string. */
function openStringStart(slice: string): number {
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      if (inString) start = i;
    }
  }
  return inString ? start : -1;
}

/** Last non-whitespace char in `slice` before `idx`, or '' if none. Used to
 *  tell whether an open string is a KEY (after `{`/`,`) or a VALUE (after `:`). */
function charBeforeSkippingWs(slice: string, idx: number): string {
  for (let i = idx - 1; i >= 0; i--) {
    const ch = slice[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return ch;
  }
  return '';
}

/** Balance brackets/braces a truncation left open so the result is valid JSON. */
function closeOpenContainers(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
  }
  let out = s;
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}
