import { Fragment } from 'react';
import { TxnType } from '@tingting/shared';
import type { LedgerEntry } from '@tingting/shared';
import { formatCurrency, formatDate } from '../lib/format';

const TXN_META: Record<string, { label: string; pill: string }> = {
  [TxnType.TRIP_REVENUE]: { label: 'DOANH THU CHUYẾN', pill: 'dd-txn-pill dd-txn-pill--rev' },
  [TxnType.SERVICE_FEE]: { label: 'PHÍ CHI HỘ', pill: 'dd-txn-pill dd-txn-pill--fee' },
  [TxnType.PAYMENT_RECEIVED]: { label: 'THU TIỀN', pill: 'dd-txn-pill dd-txn-pill--pay' },
  [TxnType.PENALTY]: { label: 'PHẠT', pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.MANAGEMENT_FEE]: { label: 'PHÍ QUẢN LÝ', pill: 'dd-txn-pill dd-txn-pill--other' },
  [TxnType.ADJUSTMENT]: { label: 'ĐIỀU CHỈNH', pill: 'dd-txn-pill dd-txn-pill--adj' },
  [TxnType.DRIVER_SALARY]: { label: 'LƯƠNG LÁI XE', pill: 'dd-txn-pill dd-txn-pill--other' },
  [TxnType.UNLOCK_REVERSAL]: { label: 'HOÀN TÁC', pill: 'dd-txn-pill dd-txn-pill--adj' },
  [TxnType.EXTERNAL_CARRIER_COST]: { label: 'CƯỚC THUÊ NGOÀI', pill: 'dd-txn-pill dd-txn-pill--other' },
};
const DEFAULT_META = { label: 'KHÁC', pill: 'dd-txn-pill dd-txn-pill--other' };

export type LedgerFilter =
  | 'all'
  | typeof TxnType.PAYMENT_RECEIVED
  | typeof TxnType.ADJUSTMENT
  | typeof TxnType.TRIP_REVENUE
  | typeof TxnType.SERVICE_FEE;

export type WorkspaceTab = 'statement' | 'debit-note' | 'payments' | 'ledger';

export const FILTER_OPTIONS: { key: LedgerFilter; label: string }[] = [
  { key: 'all',              label: 'Tất cả' },
  { key: TxnType.PAYMENT_RECEIVED, label: 'Thu tiền' },
  { key: TxnType.ADJUSTMENT,       label: 'Điều chỉnh' },
  { key: TxnType.TRIP_REVENUE,     label: 'Doanh thu' },
  { key: TxnType.SERVICE_FEE,      label: 'Phí chi hộ' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

export type LedgerDisplayRow =
  | { kind: 'single'; key: string; row: LedgerEntry }
  | {
      kind: 'group';
      key: string;
      rows: LedgerEntry[];
      date: string;
      routeName: string | null;
      containerNumbers: string[];
      labels: string[];
      debit: number;
      credit: number;
      balance: number;
      note: string;
    };

export type LedgerSectionKey = 'service-fees' | 'freight' | 'payments' | 'adjustments' | 'other';

export interface LedgerSection {
  key: LedgerSectionKey;
  title: string;
  countLabel: string;
  items: LedgerDisplayRow[];
  debit: number;
  credit: number;
}

export interface LedgerContainerGroup {
  key: string;
  label: string;
  items: LedgerDisplayRow[];
  itemCount: number;
  debit: number;
  credit: number;
}

export interface LedgerAccountingLine {
  key: string;
  date: string;
  label: string;
  typeLabel: string;
  debit: number;
  credit: number;
}

export interface LedgerRouteGroup {
  key: string;
  title: string;
  items: LedgerDisplayRow[];
  debit: number;
  credit: number;
}

export function rowDisplayLabel(row: LedgerEntry): string {
  if (row.serviceFeeLabel?.trim()) {
    return row.serviceFeeLabel.trim();
  }
  return (TXN_META[row.txnType] ?? DEFAULT_META).label;
}

export function rowGroupKey(row: LedgerEntry): string | null {
  if (row.txnType !== TxnType.TRIP_REVENUE && row.txnType !== TxnType.SERVICE_FEE) return null;
  const day = String(row.timestamp).slice(0, 10);
  const family = row.serviceFeeLabel || row.txnType === TxnType.SERVICE_FEE ? 'fees' : row.txnType;
  const tripKey = row.tripId ?? (row.txnType === TxnType.TRIP_REVENUE ? row.txnId : null);
  if (tripKey) return `${day}|${family}|trip:${tripKey}`;
  const routeKey = row.routeName?.trim() || '';
  const containerKey = (row.containerNumbers ?? []).join(',');
  if (!routeKey && !containerKey) return null;
  return `${day}|${family}|${routeKey}|${containerKey}`;
}

export function groupLedgerRows(rows: LedgerEntry[]): LedgerDisplayRow[] {
  const displayRows: LedgerDisplayRow[] = [];
  const groups = new Map<string, Extract<LedgerDisplayRow, { kind: 'group' }>>();

  for (const row of rows) {
    const key = rowGroupKey(row);
    if (!key) {
      displayRows.push({ kind: 'single', key: `row:${row.id}`, row });
      continue;
    }

    let group = groups.get(key);
    if (!group) {
      group = {
        kind: 'group',
        key,
        rows: [],
        date: row.timestamp,
        routeName: row.routeName ?? null,
        containerNumbers: row.containerNumbers ?? [],
        labels: [],
        debit: 0,
        credit: 0,
        balance: parseFloat(row.balance) || 0,
        note: '',
      };
      groups.set(key, group);
      displayRows.push(group);
    }

    group.rows.push(row);
    group.debit += parseFloat(row.debit) || 0;
    group.credit += parseFloat(row.credit) || 0;
    if (!group.labels.includes(rowDisplayLabel(row))) {
      group.labels.push(rowDisplayLabel(row));
    }
    if (!group.routeName && row.routeName) group.routeName = row.routeName;
    if (group.containerNumbers.length === 0 && row.containerNumbers?.length) {
      group.containerNumbers = row.containerNumbers;
    }
  }

  for (const group of groups.values()) {
    const notes = Array.from(new Set(group.rows.map((row) => row.note?.trim()).filter(Boolean) as string[]));
    group.note = group.rows.length > 1
      ? `${group.rows.length} khoản${notes[0] ? ` - ${notes[0]}` : ''}`
      : notes[0] ?? '';
  }

  return displayRows.map((item) => {
    if (item.kind !== 'group' || item.rows.length > 1) return item;
    return { kind: 'single', key: `row:${item.rows[0].id}`, row: item.rows[0] };
  });
}

export function displayRowAmounts(item: LedgerDisplayRow): { debit: number; credit: number } {
  if (item.kind === 'group') return { debit: item.debit, credit: item.credit };
  return {
    debit: parseFloat(item.row.debit) || 0,
    credit: parseFloat(item.row.credit) || 0,
  };
}

export function displayRowRouteTitle(item: LedgerDisplayRow): string {
  if (item.kind === 'group') return item.routeName || 'Chưa có tuyến';
  return item.row.routeName || item.row.note || 'Chưa có tuyến';
}

export function displayRowContainers(item: LedgerDisplayRow): string[] {
  return item.kind === 'group'
    ? item.containerNumbers
    : item.row.containerNumbers ?? [];
}

export function displayRowFallbackLabel(item: LedgerDisplayRow): string {
  if (item.kind === 'group') return 'Không có container';
  return item.row.receiptId || 'Không có container';
}

export function displayRowItemCount(item: LedgerDisplayRow): number {
  return item.kind === 'group' ? item.rows.length : 1;
}

export function displayRowSectionKey(item: LedgerDisplayRow): LedgerSectionKey {
  const firstRow = item.kind === 'group' ? item.rows[0] : item.row;
  if (!firstRow) return 'other';
  if (item.kind === 'group' && item.rows.some(row => row.serviceFeeLabel || row.txnType === TxnType.SERVICE_FEE)) {
    return 'service-fees';
  }
  if (firstRow.serviceFeeLabel || firstRow.txnType === TxnType.SERVICE_FEE) return 'service-fees';
  if (firstRow.txnType === TxnType.TRIP_REVENUE) return 'freight';
  if (firstRow.txnType === TxnType.PAYMENT_RECEIVED) return 'payments';
  if (firstRow.txnType === TxnType.ADJUSTMENT || firstRow.txnType === TxnType.UNLOCK_REVERSAL) return 'adjustments';
  return 'other';
}

export function ledgerSectionMeta(key: LedgerSectionKey): { title: string; countUnit: string } {
  switch (key) {
    case 'service-fees':
      return { title: 'Phí chi hộ theo container', countUnit: 'nhóm' };
    case 'freight':
      return { title: 'Doanh thu chuyến', countUnit: 'chuyến' };
    case 'payments':
      return { title: 'Thanh toán đã thu', countUnit: 'phiếu' };
    case 'adjustments':
      return { title: 'Điều chỉnh', countUnit: 'dòng' };
    default:
      return { title: 'Giao dịch khác', countUnit: 'dòng' };
  }
}

export function groupLedgerSections(items: LedgerDisplayRow[]): LedgerSection[] {
  const order: LedgerSectionKey[] = ['service-fees', 'freight', 'payments', 'adjustments', 'other'];
  const sectionMap = new Map<LedgerSectionKey, LedgerSection>();

  for (const item of items) {
    const key = displayRowSectionKey(item);
    const meta = ledgerSectionMeta(key);
    let section = sectionMap.get(key);
    if (!section) {
      section = {
        key,
        title: meta.title,
        countLabel: '',
        items: [],
        debit: 0,
        credit: 0,
      };
      sectionMap.set(key, section);
    }
    const amounts = displayRowAmounts(item);
    section.items.push(item);
    section.debit += amounts.debit;
    section.credit += amounts.credit;
  }

  return order
    .map(key => {
      const section = sectionMap.get(key);
      if (!section) return null;
      const meta = ledgerSectionMeta(key);
      section.countLabel = `${section.items.length} ${meta.countUnit}`;
      return section;
    })
    .filter(Boolean) as LedgerSection[];
}

export function groupDisplayRowsByRoute(items: LedgerDisplayRow[]): LedgerRouteGroup[] {
  const routeGroups: LedgerRouteGroup[] = [];
  const byRoute = new Map<string, LedgerRouteGroup>();

  for (const item of items) {
    const title = displayRowRouteTitle(item);
    const key = title.trim().toLowerCase();
    let group = byRoute.get(key);
    if (!group) {
      group = { key, title, items: [], debit: 0, credit: 0 };
      byRoute.set(key, group);
      routeGroups.push(group);
    }
    const amounts = displayRowAmounts(item);
    group.items.push(item);
    group.debit += amounts.debit;
    group.credit += amounts.credit;
  }

  return routeGroups;
}

export function groupItemsByContainer(items: LedgerDisplayRow[]): LedgerContainerGroup[] {
  const groups: LedgerContainerGroup[] = [];
  const byContainer = new Map<string, LedgerContainerGroup>();

  for (const item of items) {
    const containers = displayRowContainers(item);
    const label = containers.length > 0 ? containers.join(', ') : displayRowFallbackLabel(item);
    const key = label.trim().toLowerCase();
    let group = byContainer.get(key);
    if (!group) {
      group = { key, label, items: [], itemCount: 0, debit: 0, credit: 0 };
      byContainer.set(key, group);
      groups.push(group);
    }

    const amounts = displayRowAmounts(item);
    group.items.push(item);
    group.itemCount += displayRowItemCount(item);
    group.debit += amounts.debit;
    group.credit += amounts.credit;
  }

  return groups;
}

export function rowTypeLabel(row: LedgerEntry): string {
  if (row.serviceFeeLabel || row.txnType === TxnType.SERVICE_FEE) return 'Phí chi hộ';
  if (row.txnType === TxnType.TRIP_REVENUE) return 'Doanh thu';
  return (TXN_META[row.txnType] ?? DEFAULT_META).label;
}

export function accountingLinesForItem(item: LedgerDisplayRow): LedgerAccountingLine[] {
  if (item.kind === 'group') {
    return item.rows.map(row => ({
      key: `row:${row.id}`,
      date: row.timestamp,
      label: rowDisplayLabel(row),
      typeLabel: rowTypeLabel(row),
      debit: parseFloat(row.debit) || 0,
      credit: parseFloat(row.credit) || 0,
    }));
  }

  return [{
    key: `row:${item.row.id}`,
    date: item.row.timestamp,
    label: rowDisplayLabel(item.row),
    typeLabel: rowTypeLabel(item.row),
    debit: parseFloat(item.row.debit) || 0,
    credit: parseFloat(item.row.credit) || 0,
  }];
}

export function splitRouteTitle(title: string): { origin: string; destination: string } | null {
  const normalized = title.replace(/\s+/g, ' ').trim();
  const separator = normalized.match(/\s[-–—]\s/);
  if (!separator || separator.index === undefined) return null;
  const origin = normalized.slice(0, separator.index).trim();
  const destination = normalized.slice(separator.index + separator[0].length).trim();
  if (!origin || !destination) return null;
  return { origin, destination };
}

// ── Component ──────────────────────────────────────────────────────────────

export function money(value: number): string {
  return formatCurrency(value).replace(' ₫', '') + 'đ';
}

export function routeContainers(items: LedgerDisplayRow[]): string[] {
  const containers = new Set<string>();
  for (const item of items) {
    const numbers = item.kind === 'group'
      ? item.containerNumbers
      : item.row.containerNumbers ?? [];
    numbers.forEach((number) => containers.add(number));
  }
  return Array.from(containers);
}

export function LedgerRouteCard({ routeGroup }: { routeGroup: LedgerRouteGroup }) {
  const sections = groupLedgerSections(routeGroup.items);
  const freight = sections.find(section => section.key === 'freight');
  const serviceFees = sections.find(section => section.key === 'service-fees');
  const containers = routeContainers(routeGroup.items);
  const containerGroups = groupItemsByContainer(routeGroup.items);
  const routeParts = splitRouteTitle(routeGroup.title);

  return (
    <article className="dd-route-card">
      <div className="dd-route-card-head">
        <div className="dd-route-title">
          {routeParts ? (
            <div className="dd-route-endpoints" aria-label={routeGroup.title}>
              <div className="dd-route-endpoint">
                <span>Điểm đi</span>
                <strong>{routeParts.origin}</strong>
              </div>
              <div className="dd-route-endpoint">
                <span>Điểm đến</span>
                <strong>{routeParts.destination}</strong>
              </div>
            </div>
          ) : (
            <h3>{routeGroup.title}</h3>
          )}
          <div className="dd-route-metrics">
            <span>{routeGroup.items.length} mục</span>
            <span>{containers.length} container</span>
            {freight && <span>Doanh thu {money(freight.debit)}</span>}
            {serviceFees && <span>Phí chi hộ {money(serviceFees.debit)}</span>}
          </div>
        </div>
        <div className="dd-route-card-total">
          <span>Tổng phải thu</span>
          {routeGroup.debit > 0 && <b>{money(routeGroup.debit)}</b>}
          {routeGroup.credit > 0 && <em>{money(routeGroup.credit)} đã thu</em>}
        </div>
      </div>
      <div className="dd-route-containers">
        <LedgerAccountingLines groups={containerGroups} />
      </div>
    </article>
  );
}

export function LedgerAccountingLines({ groups }: { groups: LedgerContainerGroup[] }) {
  return (
    <div className="dd-accounting-ledger">
      <div className="dd-accounting-row dd-accounting-row--head">
        <span>Ngày</span>
        <span>Container / khoản mục</span>
        <span>Loại</span>
        <span>Nợ</span>
        <span>Có</span>
      </div>
      {groups.map(group => {
        const lines = group.items.flatMap(accountingLinesForItem);
        return (
          <Fragment key={group.key}>
            <div className="dd-accounting-row dd-accounting-row--container">
              <span />
              <span>
                <b>{group.label}</b>
                <em>{group.itemCount} khoản</em>
              </span>
              <span>Tổng container</span>
              <strong>{group.debit > 0 ? money(group.debit) : '-'}</strong>
              <strong>{group.credit > 0 ? money(group.credit) : '-'}</strong>
            </div>
            {lines.map(line => (
              <div key={line.key} className="dd-accounting-row dd-accounting-row--entry">
                <span>{formatDate(line.date)}</span>
                <span>{line.label}</span>
                <span>{line.typeLabel}</span>
                <strong>{line.debit > 0 ? money(line.debit) : '-'}</strong>
                <strong>{line.credit > 0 ? money(line.credit) : '-'}</strong>
              </div>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
