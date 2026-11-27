/**
 * Shared soft-409 confirmation contract for dispatch plan save and order issue.
 *
 * Multiple independent soft checks can fire sequentially on the same truck +
 * timeslot (e.g., `KEP_WEIGHT_WARNING` followed by `RIG_OVERLAP_COMPLETED`, or
 * `PLATE_DEFERRED_CONFIRM` followed by `RIG_OVERLAP_COMPLETED`). Every surface
 * (row quick-issue, editor modal, grid banner, bulk issue) accumulates confirmed
 * flags across retries and stops immediately if a flag that was already sent
 * comes back again — preventing both dead-end retries and infinite loops.
 */

export type SoftIssueConfirmCode =
  | 'RIG_OVERLAP_COMPLETED'
  | 'PLATE_DEFERRED_CONFIRM'
  | 'KEP_WEIGHT_WARNING';

export type SoftIssueConfirmFlag =
  | 'rigOverlapCompletedConfirmed'
  | 'plateDeferredConfirmed'
  | 'kepWeightWarningConfirmed';

export type SoftSaveConfirmCode =
  | 'RIG_OVERLAP_COMPLETED'
  | 'KEP_WEIGHT_WARNING'
  | 'KEP_PAIR_SPLIT_WARNING';

export type SoftSaveConfirmFlag =
  | 'rigOverlapCompletedConfirmed'
  | 'kepWeightWarningConfirmed'
  | 'kepPairSplitConfirmed';

export interface SoftIssueConfirmMatch {
  code: SoftIssueConfirmCode;
  flag: SoftIssueConfirmFlag;
  message: string;
}

export interface SoftSaveConfirmMatch {
  code: SoftSaveConfirmCode;
  flag: SoftSaveConfirmFlag;
  message: string;
  confirmPrompt: string;
}

interface SoftErrorShape {
  status?: number;
  message?: string;
  code?: string;
  raw?: { code?: string };
}

function asSoftErrorShape(cause: unknown): SoftErrorShape | null {
  if (typeof cause !== 'object' || cause === null) return null;
  return cause as SoftErrorShape;
}

function extractRawCode(err: SoftErrorShape): string | undefined {
  if (typeof err.raw?.code === 'string') return err.raw.code;
  return undefined;
}

export function detectIssueSoftConfirm(cause: unknown): SoftIssueConfirmMatch | null {
  const err = asSoftErrorShape(cause);
  if (!err || err.status !== 409) return null;
  const rawCode = extractRawCode(err);
  const directCode = typeof err.code === 'string' ? err.code : undefined;
  const message = typeof err.message === 'string' && err.message.trim() !== '' ? err.message : undefined;

  if (rawCode === 'RIG_OVERLAP_COMPLETED' || directCode === 'RIG_OVERLAP_COMPLETED') {
    return {
      code: 'RIG_OVERLAP_COMPLETED',
      flag: 'rigOverlapCompletedConfirmed',
      // Fallback for a message-less refusal. The confirmable tiers under this
      // code are the lot's own rotation, the weak/date-only overlaps and the
      // cross-lot named-lot warn — a finished trip's staged rig slot answers
      // with the hard RIG_OVERLAP_FINISHED_TRIP tier instead.
      message: message ?? 'Đầu xe đã được gán cho tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?',
    };
  }
  if (rawCode === 'PLATE_DEFERRED_CONFIRM' || directCode === 'PLATE_DEFERRED_CONFIRM') {
    return {
      code: 'PLATE_DEFERRED_CONFIRM',
      flag: 'plateDeferredConfirmed',
      message: message ?? 'Phát lệnh chưa có biển số xe nhà xe ngoài. Vẫn phát lệnh?',
    };
  }
  if (
    rawCode === 'KEP_WEIGHT_WARNING'
    || directCode === 'KEP_WEIGHT_WARNING'
    || (message?.includes('vượt tải trọng cho phép') ?? false)
  ) {
    return {
      code: 'KEP_WEIGHT_WARNING',
      flag: 'kepWeightWarningConfirmed',
      message: message ?? 'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại',
    };
  }
  return null;
}

export function detectSaveSoftConfirm(cause: unknown): SoftSaveConfirmMatch | null {
  const err = asSoftErrorShape(cause);
  if (!err || err.status !== 409) return null;
  const rawCode = extractRawCode(err);
  const directCode = typeof err.code === 'string' ? err.code : undefined;
  const message = typeof err.message === 'string' && err.message.trim() !== '' ? err.message : undefined;

  if (rawCode === 'RIG_OVERLAP_COMPLETED' || directCode === 'RIG_OVERLAP_COMPLETED') {
    // Fallback for a message-less refusal — the confirmable rotation/weak/
    // cross-lot tiers (a finished trip's staged slot rides the hard tier).
    const resolved = message ?? 'Đầu xe đã được gán cho container khác của lô này trong khung giờ trùng lặp. Vẫn lưu?';
    return {
      code: 'RIG_OVERLAP_COMPLETED',
      flag: 'rigOverlapCompletedConfirmed',
      message: resolved,
      confirmPrompt: resolved,
    };
  }
  if (
    rawCode === 'KEP_WEIGHT_WARNING'
    || directCode === 'KEP_WEIGHT_WARNING'
    || (message?.includes('vượt tải trọng cho phép') ?? false)
  ) {
    const resolved = message ?? 'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại';
    return {
      code: 'KEP_WEIGHT_WARNING',
      flag: 'kepWeightWarningConfirmed',
      message: resolved,
      confirmPrompt: resolved.includes('Vẫn lưu?') ? resolved : `${resolved} Vẫn lưu?`,
    };
  }
  if (
    rawCode === 'KEP_PAIR_SPLIT_WARNING'
    || directCode === 'KEP_PAIR_SPLIT_WARNING'
    || (message?.includes('2 chân Kẹp phải cùng xe') ?? false)
  ) {
    const resolved = message ?? '2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách.';
    return {
      code: 'KEP_PAIR_SPLIT_WARNING',
      flag: 'kepPairSplitConfirmed',
      message: resolved,
      confirmPrompt: resolved.includes('Vẫn lưu?') ? resolved : `${resolved} Vẫn lưu?`,
    };
  }
  return null;
}
