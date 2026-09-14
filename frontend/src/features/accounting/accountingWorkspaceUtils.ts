import type { AccountingTransportRegisterRow } from '@tingting/shared';
import type { AccountingView, AccountingWorkspaceUrlState } from './accountingWorkspaceTypes';
import { routes } from '../../lib/routes';

export function vietnamBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function displayBusinessDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function updateAccountingSearchParams(
  searchParams: URLSearchParams,
  updates: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);

  Object.entries(updates).forEach(([key, value]) => {
    if (value == null || value === '') {
      next.delete(key);
      return;
    }

    next.set(key, value);
  });

  return next;
}

export function buildAccountingViewHref(
  searchParams: URLSearchParams,
  view: AccountingView,
): string {
  const next = new URLSearchParams(searchParams);
  next.set('view', view);
  next.delete('page');
  return `?${next}`;
}

export function buildTransportSelectionScopeKey(
  state: Pick<
    AccountingWorkspaceUrlState,
    'from' | 'to' | 'transportPage' | 'appliedTransportSearch' | 'ownership' | 'readiness'
  >,
): string {
  return [
    state.from,
    state.to,
    state.transportPage,
    state.appliedTransportSearch,
    state.ownership ?? '',
    state.readiness ?? '',
  ].join(':');
}

export function buildTransportDraftUrl(
  selectedRows: AccountingTransportRegisterRow[],
): string | null {
  const [firstRow] = selectedRows;

  if (!firstRow) {
    return null;
  }

  const range = selectedRows.reduce(
    (currentRange, row) => ({
      from: row.completionDate < currentRange.from ? row.completionDate : currentRange.from,
      to: row.completionDate > currentRange.to ? row.completionDate : currentRange.to,
    }),
    { from: firstRow.completionDate, to: firstRow.completionDate },
  );

  return `${routes.debtDetail(firstRow.customerId)}/billing/new?${new URLSearchParams({
    selectedTripIds: selectedRows.map((row) => row.tripId).join(','),
    from: range.from,
    to: range.to,
  })}`;
}

export function transportReadinessLabel(row: AccountingTransportRegisterRow): string {
  if (row.readiness.status === 'MISSING_ACCEPTED_POD') return 'Chờ POD';
  return row.readiness.status === 'READY'
    ? 'Sẵn sàng'
    : 'Thiếu dữ liệu lợi nhuận';
}
