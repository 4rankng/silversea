// Pure milestone/fuel-evidence helpers for the driver trip detail surface.
// Split from pages/DriverTripDetailPage.tsx in the 2026-09-01 structural wave (move-only).
import { DriverProgressEventType } from '@tingting/shared';
import { ApiError } from '../../lib/api';
import { formatDateTime24 } from '../../lib/format';
import { formatVietnamDateTimeInput } from '../../lib/shipment-operations';
import { getLocationPermissionIssue, isGeolocationError } from '../../lib/gps/geolocation';
import { useDriverTaskProgress } from '../../hooks/useDriverQueries';
import type { DriverTaskDetail, DriverJourneyCard } from '../../api/driverClient';

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
  ANOMALY: 'Số liệu OCR cần đối chiếu',
} as const;

export const FUEL_EVIDENCE_REVIEW_LABELS = {
  PENDING: 'OCR chưa xác minh',
  CONFIRMED: 'Đã đối chiếu trước đây',
  REJECTED: 'Không sử dụng (lịch sử)',
} as const;

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  // Editor drafts already use Vietnam wall-clock time; only instants need conversion.
  const localValue = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(value)
    ? formatVietnamDateTimeInput(value)
    : value;
  return formatDateTime24(localValue) || '—';
};

export function valueOrDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

export const PAIR_LOCKED_MESSAGE = 'Cần hoàn thành trả hàng lệnh trước để mở khóa';

export function isTripPairLocked(card?: { pairLocked?: boolean } | null): boolean {
  return Boolean(card?.pairLocked);
}

/**
 * Spec tag taxonomy: ĐƠN/KẸP/KẾT HỢP (+ LCL's LẺ). DOUBLE and COMBINED carry
 * their own label; a SINGLE-classified fulfillment riding a linked sibling
 * pair (the isCombined "kẹp" case — see driver-journey-board.service.ts)
 * reads as KẸP; an unlinked SINGLE is ĐƠN.
 *
 * Shared by the journey LIST (DriverTripsPage) and the trip DETAIL screen
 * (DriverTripDetailPage, SIL-636 QA round-3b): both surfaces must resolve the
 * ghép-chuyến tag from the same source — an ACTIVE pair (pairKind) first, the
 * dispatch classification only as the fallback — so a card tagged KẸP/KẾT HỢP
 * on the list never loses its tag when the driver opens the detail.
 */
export function tagLabelFor(card?: Pick<DriverJourneyCard, 'pairKind' | 'classification' | 'linked'> | null): string {
  // An ACTIVE trip pair is the authoritative source for the tag (PRD §3.2:
  // tags are derived from the pair, not entered by hand); the shipment
  // classification only fills in when no pair stands.
  if (card?.pairKind === 'KEP') return 'KẸP';
  if (card?.pairKind === 'KET_HOP') return 'KẾT HỢP';
  if (card?.classification === 'DOUBLE') return 'KẸP';
  if (card?.classification === 'COMBINED') return 'KẾT HỢP';
  if (card?.classification === 'LCL') return 'LẺ';
  // Lấy Lẻ must beat the `linked` fallback below: an LCL row is never a kẹp
  // member, so without its own branch it would read as KẸP on the driver app.
  if (card?.classification === 'LCL_PICKUP') return 'LẤY LẺ';
  return card?.linked ? 'KẸP' : 'ĐƠN';
}

/**
 * Trip-DETAIL completion CTA (DRV-DET-06, PRD §4.3, SIL-638 TC9).
 * Completes the transport order (e-POD photos are optional per owner ruling 31/10).
 * It must not read as an actionable "HOÀN THÀNH CHUYẾN" while disabled: only
 * IN_TRANSIT trips can proceed, COMPLETED is already done, and every other
 * status gets a neutral not-yet label.
 */
export function completeCtaLabel(status: DriverTaskDetail['status']): string {
  if (status === 'IN_TRANSIT') return 'Hoàn tất';
  if (status === 'COMPLETED') return 'Đã hoàn thành chuyến';
  return 'Chưa thể hoàn thành chuyến';
}

/**
 * e-POD footer completion CTA (DRV-DET-06, PRD §4.3): the ONE surface allowed
 * to render the uppercase `HOÀN THÀNH CHUYẾN` literal. It submits the e-POD
 * and closes the trip in a single action, so every other state keeps the
 * neutral/affirmative labels — the uppercase command is never shown while the
 * action cannot run.
 */
export function podCompleteCtaLabel(status: DriverTaskDetail['status']): string {
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
