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
 * Background/query error paths must not toast at all (inline states only); this
 * module exists for user-action catch sites.
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
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : '';
  return /the user aborted a request|signal is aborted/i.test(message);
}

/**
 * The single error→toast-message mapping for user-initiated actions
 * (the durable sweep contract — every raw `err.message` toast routes here).
 * Returns null when NOTHING may be toasted (aborted/raced).
 */
export function actionErrorMessage(action: string, error: unknown, fallback: string): string | null {
  if (isAbortedOrRaced(error)) return null;
  const raw = error instanceof Error && error.message ? error.message.trim() : '';
  const denied = error instanceof ApiError && error.status === 403;
  if (denied) {
    // A genuine denied action: permission-shaped bodies name nothing, so the
    // action name replaces them ("Bạn không có quyền <action>."). Business
    // refusals carried at 403 (e.g. the credit-limit refusal) are NOT
    // permission denials and stay verbatim.
    return PERMISSION_DENIAL.test(raw) || raw === '' ? `Bạn không có quyền ${action}.` : raw;
  }
  // Error-shape collision: a non-403 must never render a permission message.
  if (PERMISSION_DENIAL.test(raw)) return fallback;
  return raw || fallback;
}
