/**
 * The classification law for ONE detailed-plan row — the single owner of
 * "which Phân loại values may this row carry".
 *
 * Source of truth: `testplan/flows/02-dieuvan-dispatch.md` §2.13 (2026-10-03)
 * and its permanent case TC-DV-DISPATCH-053:
 *  - An LCL lot row is ONE whole-lot LCL_SHIPMENT fulfillment, so its
 *    classification is the cargo-mode-bound PAIR Lẻ (`LCL`) / Lấy Lẻ
 *    (`LCL_PICKUP`) — never a cont model (Đơn/Kẹp/Kết hợp). "Lấy Lẻ" is the
 *    empty-shell run: take a 40' shell and close the LCL cargo into it.
 *  - A CONTAINER row takes the three cont models plus "Lấy Lẻ".
 *
 * SIL-702 (id 822): the DB check
 * `shipment_fulfillments_lcl_dispatch_classification_check` (added 2026-08-20,
 * BEFORE the "Lấy Lẻ" classification existed) pinned an LCL_SHIPMENT row to
 * 'LCL' alone. Saving "Lấy Lẻ" on an LCL lot therefore died on the constraint
 * as a raw 23514 surfaced as HTTP 500, and the workaround on 2026-10-06
 * (`007352d6`) dropped the option from the select instead of widening the
 * constraint — the dialog then offered only "Lẻ" while its own hint still
 * promised "Lẻ hoặc Lấy Lẻ". The check now admits the pair (migration
 * `20261107094500_lcl_fulfillment_lcl_pickup_classification`), and this module
 * is the law the write path guards with.
 */
import type { DispatchClassification } from '@tingting/shared';

/** The two values an LCL lot row may carry. */
export const LCL_PLAN_ROW_CLASSIFICATIONS = ['LCL', 'LCL_PICKUP'] as const satisfies readonly DispatchClassification[];

/**
 * True when `classification` may be stored on a plan row of `fulfillmentType`.
 * Only the LCL lot row is restricted: a container row takes every cont model
 * plus "Lấy Lẻ", and the enum itself rejects any other value.
 */
export function isStorablePlanClassification(
  fulfillmentType: string,
  classification: DispatchClassification,
): boolean {
  if (fulfillmentType !== 'LCL_SHIPMENT') return true;
  return (LCL_PLAN_ROW_CLASSIFICATIONS as readonly string[]).includes(classification);
}

/** The business message when an LCL lot row is given a cont model. */
export const LCL_ROW_CLASSIFICATION_REFUSAL_MESSAGE =
  'Phân loại không hợp lệ cho lô Hàng lẻ. Lô hàng lẻ chỉ dùng phân loại "Lẻ" hoặc "Lấy Lẻ".';
