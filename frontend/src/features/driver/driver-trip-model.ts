// Pure milestone/fuel-evidence helpers for the driver trip detail surface.
// Split from pages/DriverTripDetailPage.tsx in the 2026-09-01 structural wave (move-only).
import { DriverProgressEventType } from '@tingting/shared';
import { ApiError } from '../../lib/api';
import { formatDateTimeShort } from '../../lib/format';
import { getLocationPermissionIssue, isGeolocationError } from '../../lib/gps/geolocation';
import { useDriverTaskProgress } from '../../hooks/useDriverQueries';
import type { DriverTaskDetail } from '../../api/driverClient';

export type MilestoneType = DriverProgressEventType.ORDER_RECEIVED;

export type MilestoneActionState = 'done' | 'available' | 'locked';

// Spec AC-DETAIL-003: BỎ HOÀN TOÀN 4 mốc thực hiện truyền thống. Only the
// ORDER_RECEIVED action remains — the driver accepts the dispatch order in one
// tap. No check-in milestones for pickup, loading, or delivery.
export const MILESTONES: Array<{
  eventType: MilestoneType;
  title: string;
  help: string;
}> = [
  {
    eventType: DriverProgressEventType.ORDER_RECEIVED,
    title: 'Đã nhận lệnh',
    help: 'Xác nhận đã nhận lệnh vận chuyển. Thời điểm này được lưu để theo dõi SLA.',
  },
];

export const FUEL_EVIDENCE_OUTCOME_LABELS = {
  ACCEPTED: 'Ảnh bơm hợp lệ',
  UNREADABLE: 'Ảnh mờ hoặc không đọc được',
  MULTI_SCREEN: 'Ảnh có nhiều màn hình',
  NON_PUMP: 'Ảnh không phải màn hình bơm',
  ANOMALY: 'Số liệu cần kế toán soát',
} as const;

export const FUEL_EVIDENCE_REVIEW_LABELS = {
  PENDING: 'Chờ kế toán xác nhận',
  CONFIRMED: 'Kế toán đã xác nhận',
  REJECTED: 'Kế toán từ chối',
} as const;

export const formatDateTime = formatDateTimeShort;

export function valueOrDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

// The completion CTA must not read as an actionable "HOÀN THÀNH CHUYẾN" while
// disabled: only IN_TRANSIT trips can complete, COMPLETED is already done, and
// every other status gets a neutral not-yet label.
export function completeCtaLabel(status: DriverTaskDetail['status']): string {
  if (status === 'IN_TRANSIT') return 'HOÀN THÀNH CHUYẾN';
  if (status === 'COMPLETED') return 'Đã hoàn thành chuyến';
  return 'Chưa thể hoàn thành chuyến';
}

/**
 * Classify a fuel-evidence upload error for the driver.
 *
 * A 409 (version mismatch, sequencing violation, or a domain conflict such as
 * "vehicle already on another trip") or 428 (precondition required) is a
 * terminal *conflict* — surface the server's Vietnamese message so the driver
 * understands the blocker. Geolocation failures map to actionable permission
 * hints. Any other failure (network blip, 5xx, auth) falls back to a generic
 * retry message.
 *
 * NOTE: we inspect `ApiError.status`, never the message. The message is a
 * Vietnamese human-readable string and never contains the HTTP status code, so
 * a regex on `error.message` would silently misclassify every API error.
 */
export function fuelEvidenceUploadErrorMessage(error: unknown): string {
  if (isGeolocationError(error)) {
    const issue = getLocationPermissionIssue(error);
    switch (issue.type) {
      case 'denied':
        return 'Chưa được cấp quyền vị trí. Hãy cho phép GPS rồi chụp lại ảnh nhiên liệu.';
      case 'timeout':
        return 'GPS phản hồi chậm. Vui lòng thử lại khi thiết bị bắt vị trí tốt hơn.';
      case 'unavailable':
        return 'Thiết bị chưa bắt được GPS. Vui lòng thử lại ở nơi có tín hiệu tốt hơn.';
      case 'inaccurate':
        return 'GPS chưa đủ chính xác để lưu ảnh nhiên liệu. Vui lòng thử lại.';
      default:
        return 'Thiết bị không hỗ trợ GPS để lưu ảnh nhiên liệu.';
    }
  }
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message
    ? error.message
    : 'Không thể tải ảnh nhiên liệu. Vui lòng thử lại.';
}

export function getLatestMilestoneEvent(
  trip: ReturnType<typeof useDriverTaskProgress>['data'],
  eventType: MilestoneType,
) {
  return [...(trip?.items ?? [])]
    .reverse()
    .find((item) => item.eventType === eventType);
}

export function milestoneActionState(eventFound: boolean, nextMilestoneIndex: number, index: number): MilestoneActionState {
  if (eventFound) return 'done';
  if (nextMilestoneIndex === index) return 'available';
  return 'locked';
}

