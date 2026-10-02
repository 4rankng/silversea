import { ROLE_LABELS } from '@tingting/shared';
import type { Role } from '@tingting/shared';
import { AuditEvent } from './audit-types';
import type { AuditPayload } from './audit-types';

const ENTITY_LABELS: Record<string, string> = {
  customers: 'khách hàng',
  trucks: 'xe đầu kéo',
  routes: 'tuyến đường',
  'cargo-types': 'loại hàng hóa',
  'pricing-tables': 'bảng giá',
  quotations: 'báo giá',
  'road-allowances': 'tiền đi đường',
  'fuel-config': 'cấu hình nhiên liệu',
  'penalty-reasons': 'lý do kỷ luật',
  drivers: 'lái xe',
  'management-fees': 'phí quản lý',
  'cap-table': 'cổ đông',
  trips: 'lệnh vận chuyển',
  shipments: 'lô hàng',
  payments: 'thanh toán',
  penalties: 'kỷ luật',
  adjustments: 'điều chỉnh',
  // /api/reports/distribute-profit, /api/reports/pnl → "reports"
  reports: 'báo cáo',
  auth: 'tài khoản',
  users: 'tài khoản',
  expenses: 'khoản chi phí vận hành',
  suppliers: 'nhà cung cấp',
  'expense-categories': 'danh mục chi phí',
  'salary-periods': 'cấu hình kỳ lương',
  upload: 'chứng từ đính kèm',
  trailers: 'rơ moóc',
  'container-types': 'loại container',
  ports: 'cảng/nơi giao nhận',
  'forwarder-expense-types': 'loại phí hộ',
  'road-config': 'cấu hình đi đường',
  'advance-requests': 'yêu cầu tạm ứng',
  'advance-settlements': 'quyết toán tạm ứng',
  'expense-photos': 'hình ảnh chi phí hộ',
  'trip-expenses': 'chi phí hộ',
  'forwarder-expenses': 'chi phí hộ',
  'container-instances': 'thông tin container',
  notifications: 'thông báo',
  forwarder: 'nhân viên điều phối',
  salary: 'lương và chấm công',
  ledger: 'sổ cái',
  finance: 'tài chính',
  driver: 'lái xe',
  photos: 'hình ảnh chứng từ',
  maps: 'bản đồ',
  advances: 'yêu cầu tạm ứng',
  settlements: 'phiếu thanh toán',
  'fuel-price-history': 'lịch sử giá nhiên liệu',
};


interface TemplateContext {
  role: string;
  /** Display name of the actor — human name, never email. */
  actor: string;
  entityLabel: string;
  /**
   * Human-readable identifier of the target entity. Prefers natural keys
   * (trip code, license plate, customer name) over numeric ids. Empty string
   * if nothing is known so the rendered sentence reads naturally.
   */
  entityKey: string;
  ipAddress: string;
}

function ctx(payload: AuditPayload & { ipAddress?: string }): TemplateContext {
  const roleLabel = payload.actorRole
    ? ROLE_LABELS[payload.actorRole as Role] || payload.actorRole
    : 'Hệ thống';
  // Resolve actor display name in priority order:
  //   1) actorName (from JWT.fullName — what users want to see)
  //   2) anything before the @ in the email (legacy fallback so old log rows
  //      with only email still render readably)
  //   3) "Người dùng"
  let actor = (payload.actorName || '').trim();
  if (!actor && payload.actorEmail) actor = payload.actorEmail.split('@')[0];
  if (!actor) actor = 'Người dùng';

  // Avoid awkward duplication when the actor's display name overlaps with
  // the role label (e.g. a user named "Quản trị viên" combined with role
  // label "Quản trị" would read "Quản trị Quản trị viên ..."). Collapse to
  // the actor name alone in any of these cases.
  const actorL = actor.toLowerCase();
  const roleL = roleLabel.toLowerCase();
  // Use word-boundary matching to avoid false positives on Vietnamese names.
  // E.g. role "tài" must not match actor "lái xe lê văn tài" unless the actor
  // IS the role label. Only exact match or prefix-with-space counts.
  const overlaps = actorL === roleL
    || actorL.startsWith(roleL + ' ')
    || actorL.endsWith(' ' + roleL)
    || actorL.includes(' ' + roleL + ' ');
  const role = overlaps ? '' : roleLabel;

  // Prefer the natural key over "#id". Only fall back to the numeric id when
  // the call site couldn't supply a natural key (defensive — every emit
  // should try to pass entityKey).
  const entityKey = (payload.entityKey || '').trim()
    || (payload.entityId ? String(payload.entityId) : '');

  const ipAddress = payload.ipAddress || '';

  return {
    role,
    actor,
    entityLabel: ENTITY_LABELS[payload.entityType] || payload.entityType,
    entityKey,
    ipAddress,
  };
}

/** Compose "<role> <actor>" with single space, collapsed when role is empty. */
function subj(c: TemplateContext): string {
  return c.role ? `${c.role} ${c.actor}` : c.actor;
}

const templates: Record<string, (c: TemplateContext) => string> = {
  [AuditEvent.TRIP_CREATED]: (c) => `${subj(c)} đã tạo mới lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_DISPATCHED]: (c) => `${subj(c)} đã cho xe xuất phát cho lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_UPDATED_PRE_DEPARTURE]: (c) => `${subj(c)} đã cập nhật các thông tin trước xuất phát cho lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_UPDATED_ACTUALS]: (c) => `${subj(c)} đã cập nhật các số liệu thực tế sau chuyến đi cho lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_COMPLETED]: (c) => `${subj(c)} đã xác nhận hoàn thành lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''} (công nợ đã được ghi nhận vào sổ cái)`,
  [AuditEvent.TRIP_CANCELED]: (c) => `${subj(c)} đã hủy bỏ lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_DEPARTURE_DATE_CHANGED]: (c) => `${subj(c)} đã thay đổi ngày khởi hành của lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_FINANCIAL_CLOSE_REQUESTED]: (c) => `${subj(c)} đã đề nghị hoàn thành lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_FINANCIAL_CHANGE_REQUESTED]: (c) => `${subj(c)} đã đề nghị thay đổi số liệu tài chính của lệnh vận chuyển${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_FINANCIAL_CANCEL_REQUESTED]: (c) => `${subj(c)} đã đề nghị hủy lệnh vận chuyển đã hoàn thành${c.entityKey ? ` ${c.entityKey}` : ''}`,

  // ─── Shipment (lô hàng) lifecycle — Wave 0 ──────────────────────────────
  // Mirrors the TRIP_* shape: each line names the actor, the verb, the
  // entity ("lô hàng"), and the shipmentCode as the human-readable key.
  [AuditEvent.SHIPMENT_CREATED]: (c) => `${subj(c)} đã tạo mới lô hàng${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.SHIPMENT_UPDATED]: (c) => `${subj(c)} đã cập nhật thông tin lô hàng${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.SHIPMENT_STATUS_CHANGED]: (c) => `${subj(c)} đã chuyển trạng thái lô hàng${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.SHIPMENT_DISPATCHED]: (c) => `${subj(c)} đã điều vận lô hàng sang chuyến đi${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.SHIPMENT_DOCUMENT_UPLOADED]: (c) => `${subj(c)} đã đính kèm tài liệu cho lô hàng${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.SHIPMENT_CONTAINERS_UPDATED]: (c) => `${subj(c)} đã cập nhật danh sách container của lô hàng${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.SHIPMENT_DELETED]: (c) => `${subj(c)} đã xóa lô hàng${c.entityKey ? ` ${c.entityKey}` : ''}`,

  [AuditEvent.PAYMENT_RECEIVED]: (c) => `${subj(c)} đã ghi nhận thanh toán${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.ADJUSTMENT_CREATED]: (c) => `${subj(c)} đã tạo bút toán điều chỉnh công nợ${c.entityKey ? ` ${c.entityKey}` : ''}`,
  [AuditEvent.PENALTY_CREATED]: (c) => `${subj(c)} đã ghi nhận quyết định kỷ luật${c.entityKey ? `: ${c.entityKey}` : ''}`,
  [AuditEvent.PENALTY_CANCELED]: (c) => `${subj(c)} đã hủy bỏ quyết định kỷ luật${c.entityKey ? `: ${c.entityKey}` : ''}`,
  [AuditEvent.DRIVER_SALARY_RECORDED]: (c) => `${subj(c)} đã ghi nhận bảng tính lương cho lái xe${c.entityKey ? `: ${c.entityKey}` : ''}`,
  [AuditEvent.PROFIT_DISTRIBUTION_REQUESTED]: (c) => `${subj(c)} đã gửi yêu cầu phân chia lợi nhuận của ${c.entityKey || 'hệ thống'} để kiểm tra và phê duyệt`,

  [AuditEvent.TRIP_EXPENSE_APPROVED]: (c) => `${subj(c)} đã phê duyệt ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`,
  [AuditEvent.TRIP_EXPENSE_REJECTED]: (c) => `${subj(c)} đã từ chối ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`,

  [AuditEvent.ENTITY_CREATED]: (c) => `${subj(c)} đã tạo mới ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`,
  [AuditEvent.ENTITY_UPDATED]: (c) => `${subj(c)} đã cập nhật thông tin ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`,
  [AuditEvent.ENTITY_DELETED]: (c) => `${subj(c)} đã xóa ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`,

  [AuditEvent.USER_LOGIN]: (c) => `${subj(c)} đã đăng nhập vào hệ thống`,
  [AuditEvent.USER_LOGOUT]: (c) => `${subj(c)} đã đăng xuất khỏi hệ thống`,
  [AuditEvent.LOGIN_FAILED]: (c) => `Phát hiện nỗ lực đăng nhập thất bại${c.entityKey ? ` cho tài khoản ${c.entityKey}` : ''}${c.ipAddress ? ` từ địa chỉ IP ${c.ipAddress}` : ''}`,
  [AuditEvent.ACCESS_DENIED]: (c) => `Từ chối truy cập của ${subj(c)} vào tài nguyên ${c.entityLabel}${c.entityKey ? ` (${c.entityKey})` : ''}`,
  [AuditEvent.MUTATION_REJECTED]: (c) => `Từ chối thao tác của ${subj(c)} trên ${c.entityLabel}${c.entityKey ? ` (${c.entityKey})` : ''}`,
  [AuditEvent.MUTATION_CONFLICT]: (c) => `Phát hiện xung đột khi ${subj(c)} thao tác trên ${c.entityLabel}${c.entityKey ? ` (${c.entityKey})` : ''}`,
  [AuditEvent.STORAGE_CLEANUP_PENDING]: (c) => `${subj(c)} có tệp cần đối soát dọn dẹp lưu trữ cho ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`,

  [AuditEvent.PROFIT_DISTRIBUTED]: (c) => `${subj(c)} đã thực hiện phân phối lợi nhuận cho các cổ đông của ${c.entityKey || 'hệ thống'}`,
};

export function renderAuditMessage(payload: AuditPayload & { ipAddress?: string }): string {
  const template = templates[payload.event];
  if (template) return template(ctx(payload));
  const c = ctx(payload);
  return `${subj(c)} đã thực hiện hành động ${payload.event} trên ${c.entityLabel}${c.entityKey ? `: ${c.entityKey}` : ''}`;
}
