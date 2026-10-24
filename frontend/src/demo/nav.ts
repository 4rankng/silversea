/**
 * Demo tree navigation (SIL-155, spec 2026.10.24_Demo_layout.docx §2).
 *
 * The demo shell is a self-contained surface for the 5 lanes that follow:
 * every path, label and description lives here instead of `PAGE_CATALOG`
 * (`shared/src/navigation/pageCatalog.ts`) so the production sidebar, the
 * page catalog and the nav-sweep stay untouched by demo work. Demo pages
 * render fixtures only and never call the API.
 *
 * Labels are the spec's own Vietnamese names — they are contract, not copy.
 */
import type { FC } from 'react';
import { Anchor, Compass01, Home01, List, Phone01, ReceiptCheck } from '@untitledui/icons';

export const DEMO_BASE_PATH = '/demo';

export interface DemoNavItem {
  /** Route path, always under /demo. */
  path: string;
  /** Sidebar label — spec §2 wording. */
  label: string;
  /** Placeholder page H1 (defaults to the label). */
  heading: string;
  /** One-line scope summary from the spec, reused by the placeholder page. */
  description: string;
  /** What the next lane builds here (placeholder bullets). */
  upcoming: readonly string[];
  icon: FC<{ className?: string }>;
}

export const DEMO_NAV_ITEMS: readonly DemoNavItem[] = [
  {
    path: '/demo/dashboard',
    label: 'Tổng quan',
    heading: 'Tổng quan Đội xe',
    description:
      'Control Tower — thống kê sản lượng, hiệu suất khai thác đội xe và báo cáo Lãi/Lỗ theo đầu xe.',
    upcoming: [
      'Thẻ chỉ số sản lượng ngày / tháng theo kích cỡ cont',
      'Hiệu suất khai thác từng đầu kéo (chuyến / ngày, tải trọng)',
      'Báo cáo Lãi/Lỗ theo đầu xe',
    ],
    icon: Home01,
  },
  {
    path: '/demo/dispatch',
    label: 'Bàn Điều Vận',
    heading: 'Bàn Điều Vận',
    description:
      'Dispatch Center — tiếp nhận yêu cầu vận chuyển, lập kế hoạch chuyến, phân bổ xe nhà / xe ngoài và giám sát thông số container.',
    upcoming: [
      'Thanh ngày (Hôm qua | Hôm nay | Ngày mai | Date picker) + 4 thẻ KPI',
      'Lưới điều hành 6 cột (multi-line) và chế độ Lịch trình đầu xe (timeline)',
      'Slide-over drawer chi tiết chuyến: phân bổ xe, thông số cont, cấu hình phí nâng/hạ',
    ],
    icon: Compass01,
  },
  {
    path: '/demo/port-payments',
    label: 'Duyệt Chi Cảng',
    heading: 'Duyệt Chi Cảng & Hoàn Ứng',
    description:
      'Port Expenses & Cash Advance — hàng đợi kế toán chuyển khoản phí nâng/hạ (UNC) và sổ hoàn ứng cho tài xế tự chi trả tiền mặt.',
    upcoming: [
      'Hàng đợi duyệt UNC theo cảng/bãi, duyệt theo lô bằng checkbox',
      'Sổ quyết toán lái xe chi hộ: số dư theo tài xế + bảng chi tiết',
      'Tín hiệu Đã UNC đồng bộ về Bàn Điều Vận và Ứng dụng Lái xe',
    ],
    icon: Anchor,
  },
  {
    path: '/demo/billing',
    label: 'Đối Soát & Công Nợ',
    heading: 'Đối Soát & Công Nợ',
    description:
      'AR/AP Billing — tổng hợp bảng kê phải thu khách hàng và bảng kê phải trả nhà xe phụ, tích hợp logic cấn trừ chi hộ.',
    upcoming: [
      'Bảng kê phải thu theo khách hàng + kỳ đối soát, xuất Excel/PDF',
      'Bảng kê phải trả nhà xe ngoài với công thức bù trừ UNC hộ',
      'Cấn trừ công nợ hiển thị rõ trên từng dòng',
    ],
    icon: ReceiptCheck,
  },
  {
    path: '/demo/master-data',
    label: 'Danh Mục',
    heading: 'Quản lý Đội Xe & Danh Mục',
    description:
      'Fleet & Master Data — danh mục Đầu kéo / Rơ moóc / Tài xế, đối tác (khách hàng, nhà xe phụ) và ma trận biểu phí cảng, bảng giá cước.',
    upcoming: [
      'Đội xe nội bộ: ghép cặp mặc định Đầu kéo + Rơ moóc + Tài xế',
      'Đối tác: chủ hàng, nhà máy/KCN, nhà thầu phụ vận tải',
      'Ma trận phí nâng/hạ (cảng × kích cỡ × xuất/nhập) và bảng giá cước theo tuyến',
    ],
    icon: List,
  },
  {
    path: '/demo/driver-app',
    label: 'Lái Xe',
    heading: 'Ứng dụng Lái Xe',
    description:
      'Driver Mobile App — nhận lệnh, cập nhật thông số vỏ container (chụp cửa cont AI OCR) và tải lên chứng từ E-POD / Phiếu EIR.',
    upcoming: [
      'Khung giả lập điện thoại trên web + thanh chọn tài xế (chế độ demo)',
      'Thẻ lệnh trong ngày, nhãn CHẠY KẸP cho 2 vỏ 20′, khung cảnh báo đỏ',
      'Nhập Số cont / Số chì / Max gross / Tare, chỉ dẫn tài chính tại cảng, trả chứng từ',
    ],
    icon: Phone01,
  },
];

/** Resolve the nav item for a pathname; undefined outside the demo tree. */
export function demoNavItemForPath(pathname: string): DemoNavItem | undefined {
  if (pathname === DEMO_BASE_PATH) return DEMO_NAV_ITEMS[0];
  if (!pathname.startsWith(`${DEMO_BASE_PATH}/`)) return undefined;
  // Longest-path first so future nested demo routes (e.g. /demo/dispatch/timeline)
  // still resolve to their parent entry.
  return [...DEMO_NAV_ITEMS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}

/** Route payload lookup — a missing entry is a wiring bug, fail loudly. */
export function demoNavItemRequired(path: string): DemoNavItem {
  const item = DEMO_NAV_ITEMS.find((entry) => entry.path === path);
  if (!item) throw new Error(`Demo nav item not found for ${path}`);
  return item;
}
