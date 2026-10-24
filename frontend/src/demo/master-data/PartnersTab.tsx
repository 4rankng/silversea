/**
 * Tab Đối tác (SIL-161, spec PHÂN HỆ 4.2): ba bảng danh mục searchable —
 * Khách hàng / chủ hàng, Nhà máy / KCN và Nhà xe phụ. Nhà máy/KCN suy ra từ
 * danh mục khách hàng fixtures; số chuyến nhà xe phụ đếm từ fixtures chuyến.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { SearchLg } from '@untitledui/icons';
import { Badge } from '@/components/untitled-ui/base/badges/badges';
import { InputBase } from '@/components/untitled-ui/base/input/input';
import { removeDiacritics } from '@/lib/format';
import {
  demoCustomers,
  demoFactoryDirectory,
  demoTrips,
  demoVendorTripCounts,
  demoVendors,
} from '../data';

function matches(query: string, ...fields: readonly (string | undefined)[]): boolean {
  const needle = removeDiacritics(query.trim().toLowerCase());
  if (needle === '') return true;
  return removeDiacritics(fields.filter(Boolean).join(' ').toLowerCase()).includes(needle);
}

function SearchBox({ label, testId, value, onChange }: {
  label: string;
  testId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="w-full sm:w-64">
      <InputBase
        icon={SearchLg}
        size="sm"
        placeholder="Tìm kiếm…"
        aria-label={label}
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TableShell({ testId, head, children, empty }: {
  testId: string;
  head: readonly string[];
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
      <table className="w-full min-w-[560px] border-collapse text-left" data-testid={testId}>
        <thead>
          <tr className="border-b border-secondary_alt bg-secondary text-tertiary">
            {head.map((label) => (
              <th key={label} className="px-4 py-2.5">{label}</th>
            ))}
          </tr>
        </thead>
        {!empty && <tbody>{children}</tbody>}
        {empty && (
          <tbody>
            <tr>
              <td colSpan={head.length} className="px-4 py-8 text-center text-sm text-tertiary">
                Không có dòng nào khớp tìm kiếm.
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

function CustomerTable() {
  const [query, setQuery] = useState('');
  const filtered = demoCustomers.filter((customer) =>
    matches(query, customer.code, customer.name, customer.factory, customer.factoryArea),
  );
  return (
    <section aria-label="Khách hàng chủ hàng" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-md font-semibold text-primary">Khách hàng / Chủ hàng</h3>
        <span className="text-sm text-tertiary" data-testid="partners-count-customers">
          {filtered.length}/{demoCustomers.length}
        </span>
        <div className="ml-auto">
          <SearchBox label="Tìm khách hàng" testId="partners-search-customers" value={query} onChange={setQuery} />
        </div>
      </div>
      <TableShell
        testId="partners-table-customers"
        head={['Mã', 'Khách hàng', 'Nhà máy giao nhận', 'KCN / Khu vực']}
        empty={filtered.length === 0}
      >
        {filtered.map((customer) => (
          <tr key={customer.id} className="border-b border-secondary_alt last:border-b-0 hover:bg-secondary_hover">
            <td className="px-4 py-2.5"><Badge type="pill-color" color="brand" size="sm">{customer.code}</Badge></td>
            <td className="px-4 py-2.5 font-semibold text-primary">{customer.name}</td>
            <td className="px-4 py-2.5 text-secondary">{customer.factory}</td>
            <td className="px-4 py-2.5 text-secondary">{customer.factoryArea}</td>
          </tr>
        ))}
      </TableShell>
    </section>
  );
}

function FactoryTable() {
  const [query, setQuery] = useState('');
  const directory = useMemo(() => demoFactoryDirectory(), []);
  const customerByCode = useMemo(
    () => new Map(demoCustomers.map((customer) => [customer.code, customer])),
    [],
  );
  const filtered = directory.filter((factory) =>
    matches(query, factory.name, factory.area, ...factory.customerCodes),
  );
  return (
    <section aria-label="Nhà máy khu công nghiệp" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-md font-semibold text-primary">Nhà máy / KCN</h3>
        <span className="text-sm text-tertiary" data-testid="partners-count-factories">
          {filtered.length}/{directory.length}
        </span>
        <div className="ml-auto">
          <SearchBox label="Tìm nhà máy" testId="partners-search-factories" value={query} onChange={setQuery} />
        </div>
      </div>
      <TableShell
        testId="partners-table-factories"
        head={['Nhà máy / KCN', 'Khu vực', 'Chủ hàng gắn']}
        empty={filtered.length === 0}
      >
        {filtered.map((factory) => (
          <tr key={factory.name} className="border-b border-secondary_alt last:border-b-0 hover:bg-secondary_hover">
            <td className="px-4 py-2.5 font-semibold text-primary">{factory.name}</td>
            <td className="px-4 py-2.5 text-secondary">{factory.area}</td>
            <td className="px-4 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {factory.customerCodes.map((code) => (
                  <Badge key={code} type="pill-color" color="gray" size="sm">
                    {code} · {customerByCode.get(code)?.name ?? code}
                  </Badge>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </section>
  );
}

function VendorTable() {
  const [query, setQuery] = useState('');
  const tripCounts = useMemo(() => demoVendorTripCounts(), []);
  const filtered = demoVendors.filter((vendor) => matches(query, vendor.name, vendor.phone));
  return (
    <section aria-label="Nhà xe phụ" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-md font-semibold text-primary">Nhà xe phụ</h3>
        <span className="text-sm text-tertiary" data-testid="partners-count-vendors">
          {filtered.length}/{demoVendors.length}
        </span>
        <div className="ml-auto">
          <SearchBox label="Tìm nhà xe phụ" testId="partners-search-vendors" value={query} onChange={setQuery} />
        </div>
      </div>
      <TableShell
        testId="partners-table-vendors"
        head={['Nhà xe', 'SĐT', 'Chuyến xe ngoài trong fixtures']}
        empty={filtered.length === 0}
      >
        {filtered.map((vendor) => (
          <tr key={vendor.id} className="border-b border-secondary_alt last:border-b-0 hover:bg-secondary_hover">
            <td className="px-4 py-2.5 font-semibold text-primary">{vendor.name}</td>
            <td className="px-4 py-2.5 tabular-nums text-secondary">{vendor.phone}</td>
            <td className="px-4 py-2.5 text-secondary">
              {tripCounts.get(vendor.id) ?? 0} chuyến / {demoTrips.length} chuyến fixtures
            </td>
          </tr>
        ))}
      </TableShell>
    </section>
  );
}

export function PartnersTab() {
  return (
    <div className="flex flex-col gap-8">
      <CustomerTable />
      <FactoryTable />
      <VendorTable />
    </div>
  );
}
