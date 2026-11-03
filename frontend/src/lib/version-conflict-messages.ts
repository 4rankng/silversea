/**
 * Shared user-facing copy for stale-state / version-conflict reload prompts
 * (SIL-675, tech-debt P2-5 dedup). One source of truth so the reload copy
 * stays consistent across the dispatch/CUS/auth/settings surfaces instead of
 * drifting between inline literals. Byte-identical to the previous inline
 * strings — pure dedup, zero behavior change.
 */

/** Dispatch fulfillment row changed under the caller (backend 409). */
export const DISPATCH_VERSION_CONFLICT_MESSAGE = 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.';

/** Generic 409 fallback when the server sent no usable message. */
export const STALE_DATA_RELOAD_MESSAGE = 'Dữ liệu đã thay đổi. Vui lòng tải lại.';

/** Lot-level version conflict — swap-order 409/428 fallback. */
export const SHIPMENT_VERSION_CONFLICT_MESSAGE = 'Lô hàng đã thay đổi. Vui lòng tải lại.';

/** CUS lock action: stored accounting confirmation no longer matches. */
export const CUS_ACCOUNTING_CONFIRMATION_STALE_MESSAGE = 'Xác nhận Kế toán không còn hợp lệ. Vui lòng tải lại dữ liệu.';

/** CUS reopen action: the active lot lock row is gone. */
export const CUS_ACTIVE_LOCK_MISSING_MESSAGE = 'Không tìm thấy khóa lô hiện hành. Vui lòng tải lại dữ liệu.';

/** Login/profile payload without a usable numeric user id. */
export const AUTH_USER_ID_UNRESOLVABLE_MESSAGE = 'Không thể xác định tài khoản. Vui lòng tải lại.';

/** Dispatch branch-create: row arrived without a container id. */
export const DISPATCH_BRANCH_MISSING_CONTAINER_MESSAGE = 'Dòng này không mang mã container — không thể tạo tác vụ. Vui lòng tải lại trang.';

/** Settings policy save: storage API unreachable (404/missing route). */
export const POLICY_SAVE_API_UNREACHABLE_MESSAGE = 'Không kết nối được API lưu chính sách. Vui lòng tải lại trang và thử lại; nếu vẫn lỗi, báo quản trị hệ thống.';
