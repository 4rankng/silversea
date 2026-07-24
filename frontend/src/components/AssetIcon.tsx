/**
 * AssetIcon — central registry + render component for the project's branded
 * icon set shipped in /public/assets/icons.
 *
 * Every icon lives at `/assets/icons/<slug>.png` (served from
 * `frontend/public/assets/icons/`). The folder is catalogued here so we can
 * render icons anywhere in the UI without having to remember file names.
 *
 * Each entry also carries:
 *   - `label`  : Vietnamese human-readable label
 *   - `group`  : semantic group for documentation / future grouping
 *
 * Use the component with either:
 *   <AssetIcon name="overview" />
 *   <AssetIcon slug="01-overview-tong-quan" />
 */

import React from 'react';

export type AssetIconName =
  | 'overview'
  | 'dispatch'
  | 'trip-log'
  | 'truck'
  | 'driver'
  | 'customer'
  | 'supplier'
  | 'warehouse'
  | 'cargo'
  | 'route'
  | 'location'
  | 'schedule'
  | 'fuel'
  | 'expense'
  | 'receivables'
  | 'payroll'
  | 'attendance'
  | 'analytics'
  | 'alert'
  | 'document'
  | 'notification'
  | 'settings'
  | 'users-hr'
  | 'checklist'
  | 'payables'
  | 'advances'
  | 'profit'
  | 'cashflow'
  | 'overdue'
  | 'paid'
  | 'unpaid'
  | 'settlement'
  | 'gross-margin'
  | 'active-supplier'
  | 'assistant'
  | 'road-allowance'
  | 'route-distance'
  | 'pricing-rate'
  | 'salary-period'
  | 'expense-category'
  | 'forwarder-expense'
  | 'debit-note-template'
  | 'ai-provider'
  | 'faq'
  | 'app-settings'
  | 'company-profile'
  | 'trip-expense-rules'
  | 'equity-ownership'
  | 'tire'
  | 'trailer'
  | 'audit-log'
  | 'active-customer'
  | 'tractor-head'
  | 'tire-position'
  | 'semi-trailer';

export interface AssetIconEntry {
  /** Short semantic name used in <AssetIcon name=...>. */
  name: AssetIconName;
  /** Filename (without path) under /assets/icons/. */
  slug: string;
  /** Vietnamese label for documentation / accessibility. */
  label: string;
  /** Semantic group. */
  group: 'operations' | 'fleet' | 'people' | 'cargo' | 'place' | 'money' | 'system' | 'reporting';
}

const ASSET_ICONS: Record<AssetIconName, AssetIconEntry> = {
  overview:     { name: 'overview',     slug: '01-overview-tong-quan',                              label: 'Tổng quan',            group: 'reporting' },
  dispatch:     { name: 'dispatch',     slug: '02-dispatch-dieu-phoi',                               label: 'Điều phối / Phân xe',  group: 'operations' },
  'trip-log':   { name: 'trip-log',     slug: '03-trip-log-so-chuyen-chuyen-xe',                    label: 'Sổ chuyến đi',         group: 'operations' },
  truck:        { name: 'truck',        slug: '04-truck-xe-tai',                                     label: 'Đầu kéo / Xe tải',     group: 'fleet' },
  driver:       { name: 'driver',       slug: '05-driver-tai-xe',                                    label: 'Lái xe / Tài xế',      group: 'people' },
  customer:     { name: 'customer',     slug: '06-customer-khach-hang',                              label: 'Khách hàng',           group: 'people' },
  supplier:     { name: 'supplier',     slug: '07-supplier-nha-cung-cap',                            label: 'Nhà cung cấp',         group: 'people' },
  warehouse:    { name: 'warehouse',    slug: '08-warehouse-kho-hang',                               label: 'Kho hàng',             group: 'place' },
  cargo:        { name: 'cargo',        slug: '09-cargo-hang-hoa',                                   label: 'Hàng hóa',             group: 'cargo' },
  route:        { name: 'route',        slug: '10-route-tuyen-duong',                                label: 'Tuyến đường',          group: 'place' },
  location:     { name: 'location',     slug: '11-location-gps-vi-tri',                              label: 'Vị trí / GPS',         group: 'place' },
  schedule:     { name: 'schedule',     slug: '12-schedule-lich-trinh',                              label: 'Lịch trình',           group: 'operations' },
  fuel:         { name: 'fuel',         slug: '13-fuel-nhien-lieu',                                  label: 'Nhiên liệu',           group: 'fleet' },
  expense:      { name: 'expense',      slug: '14-expense-chi-phi',                                  label: 'Chi phí',              group: 'money' },
  receivables:  { name: 'receivables',  slug: '15-accounts-receivable-cong-no-phai-thu',            label: 'Công nợ phải thu',     group: 'money' },
  payroll:      { name: 'payroll',      slug: '16-payroll-luong-tien-luong',                         label: 'Lương / Tiền lương',   group: 'money' },
  attendance:   { name: 'attendance',   slug: '17-attendance-cham-cong',                             label: 'Chấm công',            group: 'people' },
  analytics:    { name: 'analytics',    slug: '18-analytics-bao-cao-phan-tich',                      label: 'Phân tích / Báo cáo',  group: 'reporting' },
  alert:        { name: 'alert',        slug: '19-alert-canh-bao',                                   label: 'Cảnh báo',             group: 'system' },
  document:     { name: 'document',     slug: '20-document-tai-lieu',                                label: 'Tài liệu',             group: 'system' },
  notification: { name: 'notification', slug: '21-notification-thong-bao',                           label: 'Thông báo',            group: 'system' },
  settings:     { name: 'settings',     slug: '22-settings-system-cai-dat-he-thong',                 label: 'Cài đặt hệ thống',     group: 'system' },
  'users-hr':   { name: 'users-hr',     slug: '23-users-hr-nguoi-dung-nhan-su',                      label: 'Người dùng / Nhân sự', group: 'people' },
  checklist:    { name: 'checklist',    slug: '24-checklist-approval-danh-sach-kiem-tra-phe-duyet',  label: 'Danh sách kiểm tra / Phê duyệt', group: 'operations' },
  payables:     { name: 'payables',     slug: '25-payables-cong-no-phai-tra',                        label: 'Công nợ phải trả',     group: 'money' },
  advances:     { name: 'advances',     slug: '26-advances-tam-ung',                                  label: 'Tạm ứng',              group: 'money' },
  profit:       { name: 'profit',       slug: '27-profit-loi-nhuan',                                  label: 'Lợi nhuận',            group: 'reporting' },
  cashflow:     { name: 'cashflow',     slug: '28-cashflow-dong-tien',                                label: 'Dòng tiền',            group: 'money' },
  overdue:      { name: 'overdue',      slug: '29-overdue-qua-han',                                   label: 'Quá hạn',              group: 'money' },
  paid:         { name: 'paid',         slug: '30-paid-da-thanh-toan',                                label: 'Đã thanh toán',        group: 'money' },
  unpaid:       { name: 'unpaid',       slug: '31-unpaid-chua-thanh-toan',                            label: 'Chưa thanh toán',      group: 'money' },
  settlement:   { name: 'settlement',   slug: '32-settlement-hoan-ung',                               label: 'Hoàn ứng',             group: 'money' },
  'gross-margin': { name: 'gross-margin', slug: '33-gross-margin-bien-loi-nhuan',                     label: 'Biên lợi nhuận gộp',   group: 'reporting' },
  'active-supplier': { name: 'active-supplier', slug: '34-active-supplier-nha-cung-cap-hoat-dong',    label: 'Nhà cung cấp hoạt động', group: 'people' },
  assistant:    { name: 'assistant',    slug: '35-assistant-tro-ly-tingting',                          label: 'Trợ lý TransTing',      group: 'system' },
  'road-allowance': { name: 'road-allowance', slug: '36-road-allowance-toll-phi-duong-bo',            label: 'Tiền đi đường',        group: 'money' },
  'route-distance': { name: 'route-distance', slug: '37-route-distance-tuyen-duong-cu-ly',            label: 'Tuyến đường và cự ly', group: 'place' },
  'pricing-rate': { name: 'pricing-rate', slug: '38-pricing-rate-bang-gia-cuoc',                       label: 'Bảng giá cước',         group: 'money' },
  'salary-period': { name: 'salary-period', slug: '39-salary-period-ky-luong',                         label: 'Kỳ lương',              group: 'money' },
  'expense-category': { name: 'expense-category', slug: '40-expense-category-hang-muc-chi-phi',       label: 'Hạng mục chi phí',      group: 'money' },
  'forwarder-expense': { name: 'forwarder-expense', slug: '41-forwarder-expense-chi-phi-giao-nhan',   label: 'Chi phí giao nhận',     group: 'money' },
  'debit-note-template': { name: 'debit-note-template', slug: '42-debit-note-template-mau-giay-bao-no', label: 'Mẫu giấy báo nợ',     group: 'money' },
  'ai-provider': { name: 'ai-provider', slug: '43-ai-provider-nha-cung-cap-ai',                         label: 'Nhà cung cấp AI',       group: 'system' },
  faq:           { name: 'faq', slug: '44-faq-cau-hoi-thuong-gap',                                    label: 'Câu hỏi thường gặp',    group: 'system' },
  'app-settings': { name: 'app-settings', slug: '45-app-settings-cai-dat-ung-dung',                    label: 'Cài đặt ứng dụng',      group: 'system' },
  'company-profile': { name: 'company-profile', slug: '46-company-profile-thong-tin-cong-ty',         label: 'Thông tin công ty',     group: 'system' },
  'trip-expense-rules': { name: 'trip-expense-rules', slug: '47-trip-expense-rules-chi-phi-chuyen-di', label: 'Chi phí chuyến đi',    group: 'money' },
  'equity-ownership': { name: 'equity-ownership', slug: '48-equity-ownership-co-phan-so-huu',          label: 'Cổ phần và sở hữu',     group: 'money' },
  tire:          { name: 'tire', slug: '49-tire-lop-xe-vi-tri',                                       label: 'Lốp xe và vị trí lốp',  group: 'fleet' },
  trailer:       { name: 'trailer', slug: '50-trailer-ro-mooc',                                       label: 'Rơ-moóc',               group: 'fleet' },
  'audit-log':   { name: 'audit-log', slug: '51-audit-log-nhat-ky-hoat-dong',                          label: 'Nhật ký hoạt động',     group: 'system' },
  'active-customer': { name: 'active-customer', slug: '52-active-customer-khach-hang-hoat-dong',      label: 'Khách hàng hoạt động', group: 'people' },
  'tractor-head': { name: 'tractor-head', slug: '53-tractor-head-xe-dau-keo',                          label: 'Xe đầu kéo',            group: 'fleet' },
  'tire-position': { name: 'tire-position', slug: '54-tire-position-vi-tri-lop',                       label: 'Vị trí lốp',            group: 'fleet' },
  'semi-trailer': { name: 'semi-trailer', slug: '55-semi-trailer-ro-mooc',                             label: 'Rơ-moóc',               group: 'fleet' },
};

/** Every icon name, exported for iteration / verification. */
export const ASSET_ICON_NAMES: AssetIconName[] = Object.keys(ASSET_ICONS) as AssetIconName[];

const SLUG_TO_NAME: Record<string, AssetIconName> = Object.values(ASSET_ICONS).reduce(
  (acc, entry) => {
    acc[entry.slug] = entry.name;
    return acc;
  },
  {} as Record<string, AssetIconName>,
);

export interface AssetIconProps {
  /** Use either `name` (preferred) or `slug` (the raw filename). */
  name?: AssetIconName;
  slug?: string;
  /** Pixel size for width/height. Defaults to 24. */
  size?: number;
  /** Width override. Defaults to `size`. */
  width?: number | string;
  /** Height override. Defaults to `size`. */
  height?: number | string;
  /** Accessible label. When omitted, the icon is hidden from assistive tech. */
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Optional aria-hidden override; defaults to `true` when `alt` is omitted. */
  'aria-hidden'?: boolean;
}

/**
 * Build the public URL for an icon slug.
 *
 * Files in `frontend/public/assets/icons/` are stored as `.png`. The slug
 * stored on each `ASSET_ICONS` entry is the filename without extension, so
 * we append `.png` here. Without it, Vite serves the SPA `index.html`
 * fallback for unknown paths and the `<img>` element renders the broken
 * placeholder rectangle.
 */
function assetIconUrl(slug: string): string {
  return `/assets/icons/${slug}.png`;
}

/**
 * Renders one of the project's branded icon assets. Falls back to a hidden
 * placeholder if the slug is unknown, so a typo never throws.
 */
export function AssetIcon({
  name,
  slug,
  size = 24,
  width,
  height,
  alt,
  className,
  style,
  'aria-hidden': ariaHidden,
}: AssetIconProps) {
  let entry: AssetIconEntry | undefined;
  if (name) {
    entry = ASSET_ICONS[name];
  } else if (slug) {
    const fromSlug = SLUG_TO_NAME[slug];
    if (fromSlug) entry = ASSET_ICONS[fromSlug];
  }

  if (!entry) {
    if (import.meta.env.DEV) {
      console.warn(`[AssetIcon] Unknown icon ${name ?? slug ?? '(none)'}`);
    }
    return null;
  }

  const ariaProps =
    alt != null
      ? { role: 'img' as const, 'aria-label': alt }
      : { 'aria-hidden': ariaHidden ?? true };

  return (
    <img
      src={assetIconUrl(entry.slug)}
      alt={alt ?? ''}
      {...ariaProps}
      width={width ?? size}
      height={height ?? size}
      className={className}
      style={{ display: 'inline-block', objectFit: 'contain', ...style }}
      draggable={false}
    />
  );
}

export default AssetIcon;
