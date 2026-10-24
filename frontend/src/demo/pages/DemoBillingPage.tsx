/**
 * /demo/billing — Đối Soát & Công Nợ (SIL-160, spec doc_bb1b74fcfa8b §3).
 *
 * Tab 3.1 — AR khách hàng: chọn khách hàng + kỳ đối soát (month picker),
 * bảng tự tổng hợp chuyến (Ngày | Booking/Bill | Cont & loại | Tuyến |
 * Cước) với hàng tổng cộng sticky, và nút Xuất Bảng Kê (CSV) tải file thật
 * từ dữ liệu đang lọc.
 * Tab 3.2 — AP nhà xe ngoài: chọn vendor + kỳ, bảng cước phải trả với cột
 * UNC công ty chi hộ riêng; dòng có cấn trừ highlight amber + tooltip công
 * thức Thực trả = Cước − UNC.
 *
 * Demo surface: fixtures from `demo/data`, zero API calls. Built from the
 * vendored Untitled UI base primitives (Select, Input, Button, Tooltip) —
 * same family as the SIL-155 shell.
 */
import { useMemo, useState } from 'react';
import { Download01, InfoCircle } from '@untitledui/icons';
import { Focusable } from 'react-aria-components';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { Input } from '@/components/untitled-ui/base/input/input';
import { Select } from '@/components/untitled-ui/base/select/select';
import { Tooltip } from '@/components/untitled-ui/base/tooltip/tooltip';import { cx } from '@/utils/cx';
import {
  apSheetFor,
  arSheetFor,
  demoDefaultMonth,
  type ApSheet,
  type ArSheet,
} from '../billing/aggregations';
import { buildArCsv, downloadCsv } from '../billing/csv';
import { formatDate, formatVnd, monthLabel } from '../billing/format';
import { demoCustomers, demoVendors } from '../data/seed';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/billing');

type BillingTabId = 'ar' | 'ap';

const BILLING_TABS: ReadonlyArray<{ id: BillingTabId; step: string; label: string }> = [
  { id: 'ar', step: '3.1', label: 'Phải thu — Khách hàng' },
  { id: 'ap', step: '3.2', label: 'Phải trả — Nhà xe ngoài' },
];

const TH = 'px-4 py-2.5 text-left text-xs font-semibold text-secondary';
const TD = 'px-4 py-2.5 align-top';
const MONEY_TD = 'whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-primary';

function BillingTabs({ tab, onSelect }: { tab: BillingTabId; onSelect: (id: BillingTabId) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Loại bảng kê"
      className="inline-flex items-center gap-1 rounded-lg bg-secondary p-1"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onSelect(tab === 'ar' ? 'ap' : 'ar');
        }
      }}
    >
      {BILLING_TABS.map((entry) => {
        const selected = tab === entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`billing-tab-${entry.id}`}
            aria-selected={selected}
            aria-controls={`billing-panel-${entry.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(entry.id)}
            className={cx(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              selected ? 'bg-primary text-primary shadow-xs' : 'text-tertiary hover:text-primary',
            )}
          >
            <span className="mr-1.5 text-quaternary">{entry.step}</span>
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function ArPanel({
  sheet,
  customerName,
  month,
  onMonthChange,
  onCustomerChange,
}: {
  sheet: ArSheet;
  customerName: string;
  month: string;
  onMonthChange: (month: string) => void;
  onCustomerChange: (customerId: string) => void;
}) {
  const handleExport = () => {
    downloadCsv(`bang-ke-phai-thu_${sheet.customerId}_${sheet.month}.csv`, buildArCsv(sheet));
  };

  return (
    <div
      role="tabpanel"
      id="billing-panel-ar"
      aria-labelledby="billing-tab-ar"
      data-testid="billing-panel-ar"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Khách hàng"
          className="w-72"
          placeholder="Chọn khách hàng"
          selectedKey={sheet.customerId}
          onSelectionChange={(key) => onCustomerChange(String(key))}
        >
          {demoCustomers.map((customer) => (
            <Select.Item key={customer.id} id={customer.id} label={customer.name} supportingText={customer.code} />
          ))}
        </Select>
        <Input
          label="Kỳ đối soát"
          type="month"
          className="w-44"
          inputProps={{
            value: month,
            onChange: (e) => onMonthChange(e.currentTarget.value),
          }}
        />
        <div className="ml-auto">
          <Button color="secondary" iconLeading={Download01} onPress={handleExport} data-testid="billing-csv-button">
            Xuất Bảng Kê (CSV)
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">
          Bảng kê phải thu — {customerName}, {monthLabel(sheet.month)}
        </h2>
        <div className="max-h-[460px] overflow-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
          <table data-testid="billing-ar-table" className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Bảng kê phải thu {customerName}, {monthLabel(sheet.month)}
            </caption>
            <thead className="sticky top-0 z-10 bg-primary">
              <tr className="border-b border-secondary_alt">
                <th scope="col" className={TH}>Ngày</th>
                <th scope="col" className={TH}>Booking/Bill</th>
                <th scope="col" className={TH}>Cont &amp; loại</th>
                <th scope="col" className={TH}>Tuyến (NM–Cảng)</th>
                <th scope="col" className={cx(TH, 'text-right')}>Cước (VND)</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-tertiary">
                    Không có chuyến nào của khách hàng này trong kỳ đối soát.
                  </td>
                </tr>
              )}
              {sheet.rows.map((row) => (
                <tr key={row.tripId} className="border-b border-secondary_alt last:border-b-0">
                  <td className={cx(TD, 'whitespace-nowrap text-secondary')}>{formatDate(row.date)}</td>
                  <td className={TD}>
                    <span className="font-medium text-primary">{row.bookingNo}</span>
                    {row.billNo && <span className="block text-xs text-tertiary">Bill {row.billNo}</span>}
                  </td>
                  <td className={TD}>
                    <span className="font-medium text-primary">{row.contNo}</span>
                    <span className="block text-xs text-tertiary">{row.kindLabel}</span>
                  </td>
                  <td className={cx(TD, 'text-secondary')}>{row.routeText}</td>
                  <td className={MONEY_TD}>{formatVnd(row.freightVnd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="sticky bottom-0 border-t border-secondary_alt bg-primary">
                <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-primary">
                  Tổng cộng — {sheet.tripCount} chuyến
                </td>
                <td data-testid="billing-ar-total" className={cx(MONEY_TD, 'font-semibold')}>
                  {formatVnd(sheet.totalVnd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function ApNetCell({ freightVnd, uncVnd, netVnd }: { freightVnd: number; uncVnd: number; netVnd: number }) {
  if (uncVnd <= 0) return <span className="tabular-nums">{formatVnd(netVnd)}</span>;
  return (
    <Tooltip
      title="Cấn trừ UNC chi hộ"
      description={`${formatVnd(freightVnd)} cước − ${formatVnd(uncVnd)} UNC = ${formatVnd(netVnd)} thực trả`}
      placement="left"
    >
      <Focusable>
        <span
          tabIndex={0}
          className="inline-flex cursor-help items-center justify-end gap-1.5 tabular-nums"
          aria-label={`Cấn trừ chi hộ: ${formatVnd(freightVnd)} cước − ${formatVnd(uncVnd)} UNC = ${formatVnd(netVnd)} thực trả`}
          data-testid="billing-ap-deduction-trigger"
        >
          {formatVnd(netVnd)}
          <InfoCircle className="size-3.5 text-amber-600" />
        </span>
      </Focusable>
    </Tooltip>
  );
}

function ApPanel({
  sheet,
  vendorName,
  month,
  onMonthChange,
  onVendorChange,
}: {
  sheet: ApSheet;
  vendorName: string;
  month: string;
  onMonthChange: (month: string) => void;
  onVendorChange: (vendorId: string) => void;
}) {
  return (
    <div
      role="tabpanel"
      id="billing-panel-ap"
      aria-labelledby="billing-tab-ap"
      data-testid="billing-panel-ap"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Nhà xe ngoài"
          className="w-72"
          placeholder="Chọn nhà xe"
          selectedKey={sheet.vendorId}
          onSelectionChange={(key) => onVendorChange(String(key))}
        >
          {demoVendors.map((vendor) => (
            <Select.Item key={vendor.id} id={vendor.id} label={vendor.name} supportingText={vendor.phone} />
          ))}
        </Select>
        <Input
          label="Kỳ đối soát"
          type="month"
          className="w-44"
          inputProps={{
            value: month,
            onChange: (e) => onMonthChange(e.currentTarget.value),
          }}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">
          Bảng kê phải trả — {vendorName}, {monthLabel(sheet.month)}
        </h2>
        <div className="max-h-[460px] overflow-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
          <table data-testid="billing-ap-table" className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Bảng kê phải trả {vendorName}, {monthLabel(sheet.month)}
            </caption>
            <thead className="sticky top-0 z-10 bg-primary">
              <tr className="border-b border-secondary_alt">
                <th scope="col" className={TH}>Ngày</th>
                <th scope="col" className={TH}>Chuyến/Cont</th>
                <th scope="col" className={cx(TH, 'text-right')}>Cước phải trả (VND)</th>
                <th scope="col" className={cx(TH, 'text-right')}>UNC công ty chi hộ (VND)</th>
                <th scope="col" className={cx(TH, 'text-right')}>Thực trả (VND)</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-tertiary">
                    Không có chuyến nào của nhà xe này trong kỳ đối soát.
                  </td>
                </tr>
              )}
              {sheet.rows.map((row) => (
                <tr
                  key={row.tripId}
                  data-testid="billing-ap-row"
                  data-deduction={row.uncVnd > 0 ? 'true' : 'false'}
                  className={cx(
                    'border-b border-secondary_alt last:border-b-0',
                    // `!` beats the unlayered global `tbody tr { background }`
                    // from components/Table.css — token utility, not raw hex.
                    row.uncVnd > 0 && 'bg-amber-50!',
                  )}
                >
                  <td className={cx(TD, 'whitespace-nowrap text-secondary')}>{formatDate(row.date)}</td>
                  <td className={TD}>
                    <span className="font-medium text-primary">{row.code}</span>
                    <span className="block text-xs text-tertiary">{row.contNo}</span>
                  </td>
                  <td className={MONEY_TD}>{formatVnd(row.freightVnd)}</td>
                  <td className={MONEY_TD}>{formatVnd(row.uncVnd)}</td>
                  <td className={cx(MONEY_TD, 'font-medium')}>
                    <ApNetCell freightVnd={row.freightVnd} uncVnd={row.uncVnd} netVnd={row.netVnd} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="sticky bottom-0 border-t border-secondary_alt bg-primary">
                <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-primary">
                  Tổng cộng — {sheet.tripCount} chuyến
                </td>
                <td data-testid="billing-ap-total-freight" className={cx(MONEY_TD, 'font-semibold')}>
                  {formatVnd(sheet.totalFreightVnd)}
                </td>
                <td data-testid="billing-ap-total-unc" className={cx(MONEY_TD, 'font-semibold')}>
                  {formatVnd(sheet.totalUncVnd)}
                </td>
                <td data-testid="billing-ap-total-net" className={cx(MONEY_TD, 'font-semibold')}>
                  {formatVnd(sheet.totalNetVnd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

/** /demo/billing — Đối Soát & Công Nợ (AR/AP Billing). */
export default function DemoBillingPage() {
  const defaultMonth = demoDefaultMonth();
  const [tab, setTab] = useState<BillingTabId>('ar');
  const [month, setMonth] = useState(defaultMonth);
  const [customerId, setCustomerId] = useState(
    () => demoCustomers.find((c) => arSheetFor(c.id, defaultMonth).tripCount > 0)?.id ?? demoCustomers[0].id,
  );
  const [vendorId, setVendorId] = useState(
    () => demoVendors.find((v) => apSheetFor(v.id, defaultMonth).tripCount > 0)?.id ?? demoVendors[0].id,
  );

  const arSheet = useMemo(() => arSheetFor(customerId, month), [customerId, month]);
  const apSheet = useMemo(() => apSheetFor(vendorId, month), [vendorId, month]);

  return (
    <div className="flex flex-col gap-6" data-testid="demo-billing-page">
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-brand-700">
          <item.icon className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display-xs font-semibold text-primary">{item.heading}</h1>
          <p className="max-w-[72ch] text-md text-tertiary">{item.description}</p>
        </div>
      </header>

      <BillingTabs tab={tab} onSelect={setTab} />

      {tab === 'ar' ? (
        <ArPanel
          sheet={arSheet}
          customerName={demoCustomers.find((c) => c.id === customerId)?.name ?? customerId}
          month={month}
          onMonthChange={setMonth}
          onCustomerChange={setCustomerId}
        />
      ) : (
        <ApPanel
          vendorName={demoVendors.find((v) => v.id === vendorId)?.name ?? vendorId}
          sheet={apSheet}
          month={month}
          onMonthChange={setMonth}
          onVendorChange={setVendorId}
        />
      )}

      <p className="text-sm text-quaternary">
        Trang demo — dữ liệu tĩnh từ <code>frontend/src/demo/data</code>, không gọi API.
      </p>
    </div>
  );
}
