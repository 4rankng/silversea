import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AccountingTransportOwnership,
  AccountingTransportReadiness,
} from '@tingting/shared';
import type {
  AccountingTransportFilterKey,
  AccountingView,
  AccountingWorkspaceUrlState,
} from './accountingWorkspaceTypes';
import {
  buildAccountingViewHref,
  updateAccountingSearchParams,
  vietnamBusinessDate,
} from './accountingWorkspaceUtils';

const OWNERSHIP_OPTIONS = new Set<AccountingTransportOwnership>(['OWN', 'EXTERNAL']);
const READINESS_OPTIONS = new Set<AccountingTransportReadiness>([
  'READY',
  'MISSING_PROFITABILITY_SNAPSHOT',
]);

function readOwnership(value: string | null): AccountingTransportOwnership | undefined {
  return value != null && OWNERSHIP_OPTIONS.has(value as AccountingTransportOwnership)
    ? (value as AccountingTransportOwnership)
    : undefined;
}

function readReadiness(value: string | null): AccountingTransportReadiness | undefined {
  return value != null && READINESS_OPTIONS.has(value as AccountingTransportReadiness)
    ? (value as AccountingTransportReadiness)
    : undefined;
}

function readPositiveId(value: string | null): number | undefined {
  if (value == null || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function useAccountingWorkspaceUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => vietnamBusinessDate(), []);
  const appliedTransportSearch = searchParams.get('search') ?? '';
  const [transportSearch, setTransportSearch] = useState(appliedTransportSearch);

  useEffect(() => {
    setTransportSearch(appliedTransportSearch);
  }, [appliedTransportSearch]);

  const activeView: AccountingView =
    searchParams.get('view') === 'transport' ? 'transport' : 'overview';
  const from = searchParams.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = searchParams.get('to') ?? today;
  const transportPage = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const customerId = readPositiveId(searchParams.get('customerId'));
  const carrierId = readPositiveId(searchParams.get('carrierId'));
  const ownership = readOwnership(searchParams.get('ownership'));
  const readiness = readReadiness(searchParams.get('readiness'));

  const state: AccountingWorkspaceUrlState = {
    activeView,
    today,
    from,
    to,
    month: Number(to.slice(5, 7)),
    year: Number(to.slice(0, 4)),
    transportPage,
    transportSearch,
    appliedTransportSearch,
    customerId,
    carrierId,
    ownership,
    readiness,
  };

  const applyUrlState = (updates: Record<string, string | null>) => {
    setSearchParams(updateAccountingSearchParams(searchParams, updates));
  };

  return {
    state,
    setFrom: (value: string) => applyUrlState({ from: value, page: null }),
    setTo: (value: string) => applyUrlState({ to: value, page: null }),
    viewHref: (view: AccountingView) => buildAccountingViewHref(searchParams, view),
    setTransportSearch,
    setTransportFilter: (key: AccountingTransportFilterKey, value: string) =>
      applyUrlState({ [key]: value || null, page: null }),
    applyTransportSearch: () => {
      const nextSearch = transportSearch.trim();
      applyUrlState({ search: nextSearch || null, page: null });
    },
    setTransportPage: (page: number) => {
      applyUrlState({ page: page === 1 ? null : String(page) });
    },
    resetTransportSearch: () => {
      setTransportSearch('');
      applyUrlState({ search: null, page: null });
    },
  };
}
