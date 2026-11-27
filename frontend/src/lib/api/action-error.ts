/**
 * Permission-toast policy (lead ruling, user 2026-10-08 — card 071026212000):
 *
 * A permission toast may fire ONLY for a genuine user-initiated denied action —
 * never at page load, never for background queries, never for capability checks
 * settling to false, never for aborted/raced requests. A genuine 403 on a user
 * action may still toast, but it MUST name the action
 * ("Bạn không có quyền xóa khách hàng."), never the bare server body
 * ("Không có quyền truy cập").
 *
 * Sweep rule for every toast mapping that can fire for non-user-initiated or
 * non-403 events: route the message through `actionErrorMessage(action, error,
 * fallback)` —
 *   - aborted/raced errors return null (toast NOTHING);
 *   - a genuine 403 denial becomes "Bạn không có quyền <action>.";
 *   - a permission-shaped message on a NON-403 (error-shape collision) is
 *     refused: the caller's fallback stands instead;
 *   - everything else keeps today's behavior (server message verbatim, then
 *     fallback).
 *
 * Background/query error paths that can fire WITHOUT a user gesture route
 * through `backgroundErrorMessage(error, fallback, describe?)` (card
 * 20261008_6): no named permission toast is ever minted there, a
 * permission-shaped body falls back to the caller's degrade message, and
 * aborted/raced errors return null. Sites with their own message solver (GPS
 * failures, body formatting) pass it as `describe` — the validation-message
 * passthrough; the policy still gates denial/abort first and refuses a solver
 * that smuggles permission copy. One module, no forks: every error→toast
 * mapping in frontend/src routes through these two functions.
 */
import { ApiError } from './errors';

/** Every backend denial body starts with "Không có quyền…" (casbin.ts:26/60/87,
 *  ocr.ts:229, ops.ts:297, upload.ts, advances.ts, master-data-import.service.ts)
 *  or the FE-named form "Bạn không có quyền…". Matched at the prefix so no
 *  diacritic drift or suffix can smuggle the bare string through to a toast. */
const PERMISSION_DENIAL = /^(bạn\s+)?không\s+có\s+quyền(\s|$)/i;

/**
 * Raw fetch failures (SIL-1035, KB K4.49 §4.2.8): the browser's network
 * TypeError carries engine English — Chrome 'Failed to fetch', Firefox
 * 'NetworkError when attempting to fetch resource.', Safari 'Load failed',
 * React Native 'Network request failed', undici 'fetch failed'. None of it
 * tells a Vietnamese driver anything; all of it means the same thing: the
 * request never reached the server, NOTHING was saved, retry when online.
 * Matched on the known engine texts only (and only inside a TypeError) so a
 * genuine programming TypeError keeps its own message instead of being
 * masked as a connection loss.
 */
const NETWORK_FAILURE_TEXTS = /\bnetwork ?error\b|failed to fetch|\bload failed\b|network request failed|fetch failed|network disconnected/i;

/** The site's single offline sentence (RoleWorkInbox pattern, QA-pinned). */
export const NETWORK_FAILURE_MESSAGE = 'Mất kết nối. Vui lòng thử lại.';

/**
 * SIL-1105 (KB §2.5.1 K2.161) — the offline sentence for an action that
 * SAVES. The shared sentence names the connection loss; a save must also say
 * what did NOT happen (nothing was saved, the draft is kept) and WHEN to
 * retry (when the machine is back online). The classification stays in this
 * layer — the caller only supplies the domain copy.
 */
export const NETWORK_FAILURE_SAVE_MESSAGE =
  'Mất kết nối, chưa lưu được. Giữ nguyên nội dung và thử lại khi có mạng.';

/** True when the error is a bare fetch/network TypeError (never an ApiError —
 *  an HTTP response always has a real server reason of its own). */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_FAILURE_TEXTS.test(error.message);
}

/**
 * Fetch aborts (component unmount, superseded/raced request, StrictMode
 * teardown) are not user-visible failures — nothing may toast for them.
 * Exported because the same classification is asserted across the sweep.
 */
export function isAbortedOrRaced(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : '';
  return /the user aborted a request|signal is aborted/i.test(message);
}

/**
 * A site's own message solver for the NON-denial path (the validation-message
 * passthrough, card 20261008_6): GPS failures, Zod/body formatting, typed
 * fallbacks. The policy still gates denial/abort BEFORE this runs, and a
 * describe result that smuggles permission copy is refused like any collision.
 */
export type DescribeError = (error: unknown) => string;

/**
 * The single error→toast-message mapping for user-initiated actions
 * (the durable sweep contract — every raw `err.message` toast routes here).
 * Returns null when NOTHING may be toasted (aborted/raced).
 */
export function actionErrorMessage(
  action: string,
  error: unknown,
  fallback: string,
  describe?: DescribeError,
  /** The offline sentence for THIS action (SIL-1105: a save must say the
   *  content was not saved). Falls back to the site's shared sentence. */
  offline?: string,
): string | null {
  if (isAbortedOrRaced(error)) return null;
  const raw = error instanceof Error && error.message ? error.message.trim() : '';
  const denied = error instanceof ApiError && error.status === 403;
  if (denied) {
    // A genuine denied action: permission-shaped bodies name nothing, so the
    // action name replaces them ("Bạn không có quyền <action>."). Business
    // refusals carried at 403 (e.g. the credit-limit refusal) are NOT
    // permission denials and stay verbatim.
    if (PERMISSION_DENIAL.test(raw) || raw === '') return `Bạn không có quyền ${action}.`;
    return (describe && describe(error).trim()) || raw;
  }
  // Error-shape collision: a non-403 must never render a permission message.
  if (PERMISSION_DENIAL.test(raw)) return fallback;
  return describedMessage(error, raw, fallback, describe, offline);
}

/**
 * The error→toast-message mapping for catches that can fire WITHOUT a user
 * gesture (auto-refresh, background preview, silent re-sync — card 20261008_6):
 * no named permission toast is EVER minted here, because the ruling reserves
 * those for genuine user-initiated denials. A permission-shaped body on any
 * status falls back to the caller's degrade message (the widget's own named
 * fallback, QA-blessed on staging dc599a82); aborted/raced return null (toast
 * NOTHING); everything else keeps the verbatim server reason.
 */
export function backgroundErrorMessage(
  error: unknown,
  fallback: string,
  describe?: DescribeError,
): string | null {
  if (isAbortedOrRaced(error)) return null;
  const raw = error instanceof Error && error.message ? error.message.trim() : '';
  const denied = error instanceof ApiError && error.status === 403;
  if (PERMISSION_DENIAL.test(raw) || (denied && raw === '')) return fallback;
  return describedMessage(error, raw, fallback, describe);
}

/**
 * Non-denial message resolution shared by both mappings: the site's own solver
 * first (validation passthrough), then the raw server reason, then fallback.
 * A solver may not smuggle permission copy through the back door.
 */
function describedMessage(
  error: unknown,
  raw: string,
  fallback: string,
  describe?: DescribeError,
  offline?: string,
): string {
  const described = describe ? describe(error).trim() : '';
  if (described) return PERMISSION_DENIAL.test(described) ? fallback : described;
  // SIL-1035 — a raw fetch TypeError is engine English, never a server reason
  // (the server never answered). Say the one offline sentence instead of
  // leaking 'NetworkError when attempting to fetch resource.' to the driver.
  // SIL-1105 — a save names what did NOT happen; the caller supplies that
  // copy, the classification stays here.
  if (isNetworkFailure(error)) return offline ?? NETWORK_FAILURE_MESSAGE;
  return raw || fallback;
}

/** Minimal error-toast sink — the shared Toast context's `toast` fits
 *  structurally. Kept narrow so the policy never depends on the toast UI. */
export type ErrorToast = (options: { kind: 'error'; message: string }) => void;

/**
 * The sweep form for user-initiated catch sites: maps then fires, and enforces
 * the abort silence centrally (a skipped null-check would toast an empty
 * message). Every migrated mutation/action catch calls this.
 */
export function toastActionError(
  toast: ErrorToast,
  action: string,
  error: unknown,
  fallback: string,
  describe?: DescribeError,
): void {
  const message = actionErrorMessage(action, error, fallback, describe);
  if (message !== null) toast({ kind: 'error', message });
}

/** The sweep form for catches that can fire without a user gesture. */
export function toastBackgroundError(
  toast: ErrorToast,
  error: unknown,
  fallback: string,
  describe?: DescribeError,
): void {
  const message = backgroundErrorMessage(error, fallback, describe);
  if (message !== null) toast({ kind: 'error', message });
}
