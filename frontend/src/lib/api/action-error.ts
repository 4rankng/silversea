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
  return describedMessage(error, raw, fallback, describe);
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
): string {
  const described = describe ? describe(error).trim() : '';
  if (described) return PERMISSION_DENIAL.test(described) ? fallback : described;
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
