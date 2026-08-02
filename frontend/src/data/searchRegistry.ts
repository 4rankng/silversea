import type { AssetIconName } from '../components/AssetIcon';

export type SearchItemType = 'page' | 'config' | 'action';

export interface SearchItem {
  id: string;
  type: SearchItemType;
  label: string;
  description?: string;
  path: string;
  /** Semantic icon name from the project's asset icon set (`/assets/icons`). */
  iconName: AssetIconName;
  action?: string;
  /** When true, the item is ADMIN-only and filtered out for other roles. */
  adminOnly?: boolean;
}

function normalise(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function filterItems(items: SearchItem[], query: string): SearchItem[] {
  const q = normalise(query.trim());
  if (!q) return [];
  return items.filter(
    item =>
      normalise(item.label).includes(q) ||
      (item.description ? normalise(item.description).includes(q) : false),
  );
}

const ADMIN_BASE_ITEMS: SearchItem[] = [
  { id: 'dashboard', type: 'page', label: 'Tổng quan',              path: '/dashboard', iconName: 'overview' },
  { id: 'dispatch', type: 'page', label: 'Phân xe',                 path: '/dispatch',  iconName: 'dispatch' },
  { id: 'fleet',    type: 'page', label: 'Đội xe',                  path: '/fleet',     iconName: 'tractor-head' },
  { id: 'trips',    type: 'page', label: 'Sổ chuyến đi',            path: '/trips',     iconName: 'trip-log' },
  { id: 'shipments',type: 'page', label: 'Lô hàng',                  path: '/shipments', iconName: 'cargo' },
  { id: 'salary',   type: 'page', label: 'Lương & Chấm công',       path: '/salary',    iconName: 'payroll' },
  { id: 'penalties',type: 'page', label: 'Kỷ luật',                 path: '/penalties', iconName: 'alert' },
  { id: 'finance',  type: 'page', label: 'Báo cáo lãi lỗ',          path: '/finance',   iconName: 'analytics' },
  { id: 'profit',   type: 'page', label: 'Phân chia lợi nhuận',     path: '/profit',    iconName: 'profit' },
  { id: 'debt',     type: 'page', label: 'Công nợ phải thu',        path: '/debt',      iconName: 'receivables' },
  { id: 'payables', type: 'page', label: 'Công nợ phải trả',        path: '/payables',  iconName: 'payables' },
  { id: 'expenses', type: 'page', label: 'Chi phí phát sinh',       path: '/expenses',  iconName: 'expense' },
  { id: 'treasury', type: 'page', label: 'Sổ quỹ / ngân hàng',      path: '/finance/treasury', iconName: 'cashflow' },
  { id: 'credit-overrides', type: 'page', label: 'Duyệt vượt hạn mức', path: '/credit-overrides', iconName: 'checklist' },
  { id: 'governance-actions', type: 'page', label: 'Trung tâm phê duyệt', path: '/governance-actions', iconName: 'checklist' },
  { id: 'advances', type: 'page', label: 'Tạm ứng & hoàn ứng',      path: '/advances',  iconName: 'advances' },

  { id: 'customers', type: 'page', label: 'Khách hàng',             path: '/customers', iconName: 'customer' },
  { id: 'suppliers', type: 'page', label: 'Nhà cung cấp',           path: '/suppliers', iconName: 'supplier' },
  { id: 'config',    type: 'page', label: 'Cấu hình',               path: '/config',    iconName: 'settings' },
];

export const CONFIG_ITEMS: SearchItem[] = [
  { id: 'master-data-import', type: 'config', label: 'Nạp dữ liệu nền tảng', description: 'Kiểm tra và cập nhật khách hàng, nhà máy, cảng bãi, xe, rơ-moóc và lái xe từ tệp Master Data.', path: '/config/master-data-import', iconName: 'settings', action: 'Nạp dữ liệu', adminOnly: true },
  { id: 'company-info',           type: 'config', label: 'Thông tin công ty',             description: 'Tên pháp lý, địa chỉ, mã số thuế, người đại diện, liên hệ và tài khoản ngân hàng.',           path: '/config/company-info',        iconName: 'company-profile', action: 'Sửa' },
  { id: 'fuel',                   type: 'config', label: 'Định mức nhiên liệu',           description: 'Định mức tiêu hao theo xe, loại tải (vỏ rỗng, <20t, >20t) và loại tuyến (đồng bằng / núi).', path: '/config/fuel',                iconName: 'fuel',         action: 'Sửa' },
  { id: 'road-allowances',        type: 'config', label: 'Tiền đi đường',                 description: 'Tiền chuẩn theo tuyến × loại rơ-mooc. Quy tắc: − vé QL5, + chuyến về có hàng, − phí/trạm.',     path: '/config/road-allowances',     iconName: 'road-allowance', action: 'Sửa' },
  { id: 'trip-expense',           type: 'config', label: 'Chi phí chuyến đi',             description: 'Tiền kết hợp, trả hàng 2 điểm, lưu ca xe, tiền trạm BOT, thưởng chuyến về có hàng.',              path: '/config/trip-expense',        iconName: 'trip-expense-rules', action: 'Sửa' },
  { id: 'penalty-reasons',        type: 'config', label: 'Quy tắc kỷ luật & phạt',        description: 'Thiếu hoá đơn dầu (100K), vi phạm ATGT (500K / sa thải).',                                       path: '/config/penalty-reasons',     iconName: 'alert',        action: 'Sửa' },
  { id: 'drivers',                type: 'config', label: 'Người dùng & lái xe',           description: 'Quản lý tài khoản lái xe, lương cơ bản, xe phụ trách và thông tin hồ sơ liên hệ.',             path: '/users',                      iconName: 'driver',       action: 'Sửa' },
  { id: 'cap-table',              type: 'config', label: 'Cổ phần & vốn góp',             description: 'Tỷ lệ vốn góp giữa các đối tác cổ đông dùng cho phân chia lợi nhuận.',                         path: '/config/cap-table',           iconName: 'equity-ownership', action: 'Xem' },
  { id: 'customers',              type: 'config', label: 'Khách hàng & Đối tác',          description: 'Danh mục đối tác vận chuyển hàng hóa, thông tin liên hệ và mã số thuế phục vụ công nợ.',          path: '/config/customers',           iconName: 'customer',     action: 'Sửa' },
  { id: 'routes',                 type: 'config', label: 'Tuyến đường & Cự ly',           description: 'Danh sách các tuyến chặng, số trạm thu phí BOT, quãng đường di chuyển chuẩn.',                    path: '/config/routes',              iconName: 'route-distance', action: 'Sửa' },
  { id: 'trucks',                 type: 'config', label: 'Xe đầu kéo',                   description: 'Biển số các đầu kéo kéo container đang vận hành, định mức mặc định và lịch bảo dưỡng đầu xe.',     path: '/config/trucks',              iconName: 'tractor-head', action: 'Sửa' },
  { id: 'tire-positions',         type: 'config', label: 'Vị trí lốp',                    description: 'Danh mục vị trí lốp dùng khi thêm hoặc cập nhật lốp trên xe.',                                   path: '/config/tire-positions',      iconName: 'tire-position', action: 'Sửa' },
  { id: 'trailers',               type: 'config', label: 'Rơ-moóc',                      description: 'Danh sách rơ-moóc, loại rơ-moóc và thông tin đăng kiểm.',                                          path: '/config/trailers',            iconName: 'semi-trailer', action: 'Sửa' },
  { id: 'cargo-types',            type: 'config', label: 'Loại hàng hóa',                description: 'Bảng quy chuẩn loại hàng hóa vận chuyển ảnh hưởng đến việc phân xe chặng.',                       path: '/config/cargo-types',         iconName: 'cargo',        action: 'Sửa' },
  { id: 'pricing-tables',         type: 'config', label: 'Bảng giá cước',                 description: 'Bảng giá cước chi tiết thỏa thuận với từng đối tác khách hàng trên mỗi tuyến.',                  path: '/config/pricing-tables',      iconName: 'pricing-rate', action: 'Sửa' },
  { id: 'salary-periods',         type: 'config', label: 'Kỳ lương',                      description: 'Cấu hình kỳ lương hàng tháng. Mặc định: ngày 26 tháng trước đến ngày 25 tháng này.',               path: '/config/salary-periods',      iconName: 'salary-period', action: 'Sửa' },
  { id: 'business-calendar',      type: 'config', label: 'Lịch ngày làm việc',             description: 'Ngày nghỉ lễ và ngày làm việc bù dùng để điều chỉnh hạn thanh toán, quá hạn và lịch nhắc.',        path: '/config/business-calendar',   iconName: 'salary-period', action: 'Sửa', adminOnly: true },
  { id: 'expense-categories',     type: 'config', label: 'Hạng mục chi phí',              description: 'Phân loại chi phí vận hành. Bật định kỳ để theo dõi ngày gia hạn bảo hiểm, đăng kiểm, bảo dưỡng.', path: '/config/expense-categories',  iconName: 'expense-category', action: 'Sửa' },
  { id: 'forwarder-expense-types',type: 'config', label: 'Loại chi phí giao nhận',       description: 'Danh mục các khoản chi phí phát sinh do nhân viên giao nhận nhập (nâng hạ, hải quan, cân xe, kiểm tra…).', path: '/config/forwarder-expense-types', iconName: 'forwarder-expense', action: 'Sửa' },
  { id: 'debit-note-templates',  type: 'config', label: 'Mẫu giấy báo nợ',             description: 'Tạo và chọn mẫu xuất Excel giấy báo nợ theo từng khách hàng — logo, tiêu đề, cột, màu, điều khoản.',     path: '/config/debit-note-templates',  iconName: 'debit-note-template', action: 'Sửa' },
  // ADMIN-only — filtered out for MANAGER/ACCOUNTANT in getSearchItems below.
  { id: 'app-settings',          type: 'config', label: 'Cài đặt ứng dụng',               description: 'Bật/tắt tính năng, chọn nhà cung cấp AI và cấu hình tài khoản định vị Bách Khoa.',                       path: '/config/app-settings',          iconName: 'app-settings', action: 'Sửa', adminOnly: true },
];

const ACTION_ITEMS: SearchItem[] = [
  { id: 'action-new-trip',   type: 'action', label: 'Tạo chuyến mới',           path: '/trips/new',    iconName: 'trip-log' },
  { id: 'action-audit-logs', type: 'action', label: 'Xem nhật ký hoạt động',    path: '/audit-logs',   iconName: 'audit-log' },
  { id: 'action-dispatch',   type: 'action', label: 'Điều vận & Phân xe',       path: '/dispatch',     iconName: 'dispatch' },
  { id: 'action-config',     type: 'action', label: 'Cấu hình hệ thống',        path: '/config',       iconName: 'settings' },
];

const DRIVER_ITEMS: SearchItem[] = [
  { id: 'my-trips',     type: 'page', label: 'Hành trình',  path: '/my-trips',     iconName: 'route' },
  { id: 'my-earnings',  type: 'page', label: 'Thu nhập',     path: '/my-earnings',  iconName: 'payroll' },
  { id: 'my-penalties', type: 'page', label: 'Kỷ luật',     path: '/my-penalties', iconName: 'alert' },
];

const FORWARDER_ITEMS: SearchItem[] = [
  { id: 'my-forwarder-trips', type: 'page', label: 'Chuyến đi',         path: '/my-forwarder-trips', iconName: 'cargo' },
  { id: 'my-advances',        type: 'page', label: 'Tạm ứng',           path: '/my-advances',        iconName: 'advances' },
  { id: 'my-settlements',     type: 'page', label: 'Phiếu thanh toán',  path: '/my-settlements',     iconName: 'settlement' },
];

export function getSearchItems(role: string, capabilities: readonly string[] = []): SearchItem[] {
  const normRole = String(role || '').toUpperCase();
  const hasCapability = (capability: string) => capabilities.includes(capability);
  const officeBaseItems = ADMIN_BASE_ITEMS.filter(
    item => item.id !== 'treasury' || hasCapability('treasury.read'),
  );
  switch (normRole) {
    case 'ADMIN':
      return [
        ...officeBaseItems,
        { id: 'users',      type: 'page', label: 'Người dùng',         path: '/users',      iconName: 'users-hr' },
        { id: 'audit-logs', type: 'page', label: 'Nhật ký người dùng', path: '/audit-logs', iconName: 'audit-log' },
        ...CONFIG_ITEMS,
        ...ACTION_ITEMS,
      ];
    case 'MANAGER':
      // Same office surface as ADMIN, but adminOnly config items (LLM settings,
      // FAQ management) are hidden — the backend route guard (requireRoles ADMIN)
      // would 403 them anyway, so showing the card is misleading UX.
      return [
        ...officeBaseItems,
        { id: 'users',      type: 'page', label: 'Người dùng',         path: '/users',      iconName: 'users-hr' },
        { id: 'audit-logs', type: 'page', label: 'Nhật ký người dùng', path: '/audit-logs', iconName: 'audit-log' },
        ...CONFIG_ITEMS.filter(i => !i.adminOnly),
        ...ACTION_ITEMS,
      ];
    case 'ACCOUNTANT':
      return [
        { id: 'accounting', type: 'page', label: 'Tổng Quan', path: '/accounting', iconName: 'overview' },
        ...officeBaseItems
          .filter(item => item.id !== 'dispatch' && item.id !== 'dashboard'),
        { id: 'users', type: 'page', label: 'Người dùng', path: '/users', iconName: 'users-hr' },
        { id: 'audit-logs', type: 'page', label: 'Nhật ký người dùng', path: '/audit-logs', iconName: 'audit-log' },
        ...CONFIG_ITEMS.filter(i => !i.adminOnly),
      ];
    case 'DRIVER':
      return DRIVER_ITEMS;
    case 'FORWARDER':
      return FORWARDER_ITEMS;
    default:
      return [];
  }
}
