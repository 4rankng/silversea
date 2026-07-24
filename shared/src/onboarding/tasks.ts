/**
 * Onboarding checklist task catalog (Phase 6).
 *
 * The closed, role-scoped set of activation tasks shown in the floating
 * "Bắt đầu sử dụng NEPO Logistics" panel. Each task completes when its
 * `completionEvent` (a PRODUCT_EVENTS member) fires — NOT when a tooltip is
 * viewed. An item with a `tourId` launches that curated tour on click.
 *
 * Adding a task is a deliberate, PR-visible edit here. The catalog test asserts
 * every completionEvent is a known product event, every tourId is a known tour,
 * no duplicate ids per role, and only office roles appear.
 */
import { Role } from '../constants';
import type { ProductEventName } from './events';
import type { TourId } from '../tours';

export type TaskCompletion =
  | { type: 'event'; event: ProductEventName }
  | { type: 'tour' };

export interface OnboardingTask {
  /** Stable slug, unique within a role. */
  id: string;
  /** Vietnamese title shown in the checklist. */
  title: string;
  /** The role this task belongs to (one task = one role). */
  role: Role.ADMIN | Role.MANAGER | Role.ACCOUNTANT;
  /** Every activation task has a focused curated tour. */
  tourId: TourId;
  /** Event-gated work cannot be completed merely by viewing a guide. */
  completion: TaskCompletion;
  /** Display order within the role's checklist. */
  sortOrder: number;
}

/**
 * Manager activation checklist. Ordered from orientation → real work.
 *
 *   1. Visit the dashboard (orientation)
 *   2. Open the trip list
 *   3. Create the first trip  ← launches the create-trip tour; completes on
 *      trip.created (the canonical interaction step from Phase 3)
 *   4. Lock a trip
 *
 * (A future "fleet awareness" step tied to a live fleet dashboard view is
 * deferred until that dashboard ships; it is intentionally not in the array.)
 *
 * The dashboard and trip-list tasks complete from their respective first-paint
 * events. Each task has its own event so completing one never accidentally
 * completes the other.
 */
export const ONBOARDING_TASKS: readonly OnboardingTask[] = [
  // ── MANAGER ────────────────────────────────────────────────────────────
  {
    id: 'manager-dashboard-overview',
    title: 'Đọc tổng quan vận hành tháng này',
    role: Role.MANAGER,
    tourId: 'manager-dashboard-overview',
    completion: { type: 'tour' },
    sortOrder: 1,
  },
  {
    id: 'manager-create-first-trip',
    title: 'Tạo chuyến vận chuyển đầu tiên',
    role: Role.MANAGER,
    tourId: 'create-trip',
    completion: { type: 'event', event: 'trip.created' },
    sortOrder: 2,
  },
  {
    id: 'manager-dispatch-first-trip',
    title: 'Cho chuyến đầu tiên khởi hành',
    role: Role.MANAGER,
    tourId: 'dispatch-trip',
    completion: { type: 'event', event: 'trip.dispatched' },
    sortOrder: 3,
  },
  {
    id: 'manager-lock-first-trip',
    title: 'Khóa chuyến đầu tiên',
    role: Role.MANAGER,
    tourId: 'lock-trip',
    completion: { type: 'event', event: 'trip.locked' },
    sortOrder: 4,
  },
  {
    id: 'manager-review-pnl',
    title: 'Đọc báo cáo lãi lỗ theo kỳ',
    role: Role.MANAGER,
    tourId: 'review-pnl',
    completion: { type: 'tour' },
    sortOrder: 5,
  },

  // ── ACCOUNTANT ─────────────────────────────────────────────────────────
  {
    id: 'accountant-dashboard-overview',
    title: 'Xem công nợ và việc cần xử lý',
    role: Role.ACCOUNTANT,
    tourId: 'accounting-overview',
    completion: { type: 'tour' },
    sortOrder: 1,
  },
  {
    id: 'accountant-save-trip-figures',
    title: 'Hoàn thiện số liệu tài chính một chuyến',
    role: Role.ACCOUNTANT,
    tourId: 'update-trip-figures',
    completion: { type: 'event', event: 'trip.figures_saved' },
    sortOrder: 2,
  },
  {
    id: 'accountant-record-first-receipt',
    title: 'Ghi nhận thanh toán đầu tiên',
    role: Role.ACCOUNTANT,
    tourId: 'record-receivable-payment',
    completion: { type: 'event', event: 'receivable.payment_recorded' },
    sortOrder: 3,
  },
  {
    id: 'accountant-fuel-config',
    title: 'Nhập định mức nhiên liệu',
    role: Role.ACCOUNTANT,
    tourId: 'fuel-config',
    completion: { type: 'event', event: 'config.fuel_saved' },
    sortOrder: 5,
  },
  {
    id: 'accountant-review-pnl',
    title: 'Đối chiếu báo cáo lãi lỗ theo kỳ',
    role: Role.ACCOUNTANT,
    tourId: 'review-pnl',
    completion: { type: 'tour' },
    sortOrder: 4,
  },

  // ── ADMIN ─────────────────────────────────────────────────────────────
  {
    id: 'admin-system-readiness',
    title: 'Kiểm tra dữ liệu nền sẵn sàng vận hành',
    role: Role.ADMIN,
    tourId: 'system-readiness',
    completion: { type: 'tour' },
    sortOrder: 1,
  },
  {
    id: 'admin-manage-users',
    title: 'Kiểm tra tài khoản và phân quyền',
    role: Role.ADMIN,
    tourId: 'manage-users',
    completion: { type: 'tour' },
    sortOrder: 2,
  },
  {
    id: 'admin-review-audit-log',
    title: 'Kiểm tra nhật ký người dùng',
    role: Role.ADMIN,
    tourId: 'review-audit-log',
    completion: { type: 'tour' },
    sortOrder: 3,
  },
];

/** Tasks visible to a given role, in display order. */
export function tasksForRole(
  role: Role,
): readonly OnboardingTask[] {
  return ONBOARDING_TASKS.filter((t) => t.role === role).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

/** Lookup by id (returns undefined for an unknown id). */
export function getTask(id: string): OnboardingTask | undefined {
  return ONBOARDING_TASKS.find((t) => t.id === id);
}
