import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { AssetIcon } from '../components/AssetIcon';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { CONFIG_ITEMS } from '../data/searchRegistry';
import { usePageAnimations } from '../hooks/animations';
import { qk } from '../api/keys';
import { isCompanyInfoConfigured, Role } from '@tingting/shared';
import type { CompanyInfo } from '@tingting/shared';
import './ConfigPage.css';

const CHEVRON = <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;

type ListResponse = { total: number };

function countLabel(n: number | undefined, unit: string): string {
  if (n === undefined) return '—';
  return `${n} ${unit}`;
}

function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export default function ConfigPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { rootRef } = usePageAnimations({ ready: true });
  const { user } = useAuth();
  const isAdmin = user?.role === Role.ADMIN;

  const summaryQueries = useQueries({
    queries: [
      { queryKey: qk.configCounts.penaltyReasons,        queryFn: () => api.get<ListResponse>('/penalty-reasons?limit=1'),    staleTime: 60_000 },
      { queryKey: qk.configCounts.roadAllowances,        queryFn: () => api.get<ListResponse>('/road-allowances?limit=1'),    staleTime: 60_000 },
      { queryKey: qk.configCounts.drivers,               queryFn: () => api.get<ListResponse>('/drivers?limit=1'),            staleTime: 60_000 },
      { queryKey: qk.configCounts.capTable,              queryFn: () => api.get<ListResponse>('/cap-table?limit=1'),          staleTime: 60_000 },
      { queryKey: qk.configCounts.customers,             queryFn: () => api.get<ListResponse>('/customers?limit=1'),          staleTime: 60_000 },
      { queryKey: qk.configCounts.routes,                queryFn: () => api.get<ListResponse>('/routes?limit=1'),             staleTime: 60_000 },
      { queryKey: qk.configCounts.trucks,                queryFn: () => api.get<ListResponse>('/trucks?limit=1'),             staleTime: 60_000 },
      { queryKey: qk.configCounts.tirePositions,         queryFn: () => api.get<ListResponse>('/tire-positions?limit=1'),     staleTime: 60_000 },
      { queryKey: qk.configCounts.trailers,              queryFn: () => api.get<ListResponse>('/trailers?limit=1'),            staleTime: 60_000 },
      { queryKey: qk.configCounts.cargoTypes,            queryFn: () => api.get<ListResponse>('/cargo-types?limit=1'),        staleTime: 60_000 },
      { queryKey: qk.configCounts.pricingTables,         queryFn: () => api.get<ListResponse>('/pricing-tables?limit=1'),     staleTime: 60_000 },
      { queryKey: qk.configCounts.salaryDefault,         queryFn: () => api.get<{ defaultStartDay?: number; defaultEndDay?: number } | null>('/salary-periods/default'), staleTime: 60_000 },
      { queryKey: qk.configCounts.expenseCategories,     queryFn: () => api.get<ListResponse>('/expense-categories?limit=1'), staleTime: 60_000 },
      { queryKey: qk.configCounts.fuelConfig,            queryFn: () => api.get<{ id: number } | null>('/fuel-config'),       staleTime: 60_000 },
      { queryKey: qk.configCounts.companyInfo,           queryFn: () => api.get<CompanyInfo>('/company-info'),                staleTime: 60_000 },
      { queryKey: qk.configCounts.forwarderExpenseTypes, queryFn: () => api.get<ListResponse>('/forwarder-expense-types?limit=1'), staleTime: 60_000 },
      { queryKey: qk.configCounts.debitNoteTemplates,   queryFn: () => api.get<ListResponse>('/debit-note-templates?limit=1'),   staleTime: 60_000 },
      { queryKey: qk.configCounts.fuelPricePeriods,     queryFn: () => api.get<ListResponse>('/fuel-price-periods?limit=1'),     staleTime: 60_000 },
      { queryKey: qk.configCounts.freightRateTerms,     queryFn: () => api.get<ListResponse>('/freight-rate-terms?limit=1'),     staleTime: 60_000 },
    ],
  });

  const [
    penaltyReasons,
    roadAllowances,
    drivers,
    capTable,
    customers,
    routes,
    trucks,
    tirePositions,
    trailers,
    cargoTypes,
    pricingTables,
    salaryDefault,
    expenseCategories,
    fuelConfig,
    companyInfo,
    forwarderExpenseTypes,
    debitNoteTemplates,
    fuelPricePeriods,
    freightRateTerms,
  ] = summaryQueries;

  function salaryStatus(): string {
    if (salaryDefault.isLoading) return '—';
    const d = salaryDefault.data;
    if (!d || d.defaultStartDay == null) return 'Chưa cấu hình';
    const s = d.defaultStartDay;
    const e = d.defaultEndDay;
    if (s != null && e != null && s <= e) {
      // Same-month mode
      const endLabel = e === 31 ? 'cuối tháng' : `ngày ${e}`;
      return `Ngày ${s} → ${endLabel}`;
    }
    return `Ngày ${s} tháng trước → Ngày ${e} tháng này`;
  }

  function fuelStatus(): string {
    if (fuelConfig.isLoading) return '—';
    return fuelConfig.data ? 'Đã cấu hình' : 'Chưa cấu hình';
  }

  function companyInfoStatus(): string {
    if (companyInfo.isLoading) return '—';
    return isCompanyInfoConfigured(companyInfo.data) ? 'Đã cấu hình' : 'Chưa cấu hình';
  }

  const statusInfo: Record<string, { status: string; statusColor?: string }> = {
    'fuel':                     { status: fuelStatus() },
    'company-info':             { status: companyInfoStatus() },
    'road-allowances':          { status: countLabel(roadAllowances.data?.total, 'tuyến') },
    'trip-expense':             { status: '5 mục', statusColor: '#10B981' },
    'penalty-reasons':          { status: countLabel(penaltyReasons.data?.total, 'quy tắc') },
    'drivers':                  { status: countLabel(drivers.data?.total, 'lái xe') },
    'cap-table':                { status: countLabel(capTable.data?.total, 'cổ đông') },
    'customers':                { status: countLabel(customers.data?.total, 'khách hàng') },
    'routes':                   { status: countLabel(routes.data?.total, 'tuyến chặng') },
    'trucks':                   { status: countLabel(trucks.data?.total, 'xe') },
    'tire-positions':           { status: countLabel(tirePositions.data?.total, 'vị trí') },
    'trailers':                 { status: countLabel(trailers.data?.total, 'rơ-moóc') },
    'cargo-types':              { status: countLabel(cargoTypes.data?.total, 'loại hàng') },
    'pricing-tables':           { status: countLabel(pricingTables.data?.total, 'đơn giá') },
    'fuel-price-periods':       { status: countLabel(fuelPricePeriods.data?.total, 'kỳ giá') },
    'freight-rate-terms':       { status: countLabel(freightRateTerms.data?.total, 'điều khoản') },
    'salary-periods':           { status: salaryStatus() },
    'expense-categories':       { status: countLabel(expenseCategories.data?.total, 'hạng mục') },
    'forwarder-expense-types':  { status: countLabel(forwarderExpenseTypes.data?.total, 'loại') },
    'debit-note-templates':     { status: countLabel(debitNoteTemplates.data?.total, 'mẫu') },
  };

  const cardQueries = {
    'fuel': fuelConfig, 'company-info': companyInfo, 'road-allowances': roadAllowances,
    'penalty-reasons': penaltyReasons, 'drivers': drivers, 'cap-table': capTable,
    'customers': customers, 'routes': routes, 'trucks': trucks, 'tire-positions': tirePositions,
    'trailers': trailers, 'cargo-types': cargoTypes, 'pricing-tables': pricingTables,
    'fuel-price-periods': fuelPricePeriods, 'freight-rate-terms': freightRateTerms,
    'salary-periods': salaryDefault, 'expense-categories': expenseCategories,
    'forwarder-expense-types': forwarderExpenseTypes, 'debit-note-templates': debitNoteTemplates,
  };
  const visibleItems = CONFIG_ITEMS.filter(item => !item.adminOnly || isAdmin);
  const failedQueries = visibleItems
    .map(item => cardQueries[item.id as keyof typeof cardQueries])
    .filter(query => query?.isError);
  const retrying = failedQueries.some(query => query.isFetching);

  const cards = visibleItems
    .map(item => {
    const query = cardQueries[item.id as keyof typeof cardQueries];
    return {
      title: item.label,
      desc: item.description ?? '',
      icon: <AssetIcon name={item.iconName} size={26} />,
      path: item.path,
      action: item.action ?? 'Sửa',
      ...(statusInfo[item.id] ?? { status: '—' }),
      ...(query?.isError ? { status: 'Không tải được', statusColor: 'var(--danger)' } : query?.isLoading ? { status: 'Đang tải…' } : {}),
    };
  });

  const filteredCards = cards.filter(card => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    const queryNormalized = removeVietnameseTones(query);
    const titleNormalized = removeVietnameseTones(card.title.toLowerCase());
    const descNormalized = removeVietnameseTones(card.desc.toLowerCase());

    return (
      titleNormalized.includes(queryNormalized) ||
      descNormalized.includes(queryNormalized)
    );
  });

  return (
    <div ref={rootRef}>
      <PageHeader
        title="Cấu hình hệ thống"
        iconName="settings"
        description="Quản lý định mức, quy tắc tính toán, người dùng & tích hợp hệ thống"
      />

      <div className="config-search-toolbar">
        <div className="config-search-field">
          <label htmlFor="config-search" className="sr-only">Tìm cấu hình</label>
          <Search size={15} aria-hidden="true" />
          <input id="config-search" type="search" className="input" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Tìm cấu hình theo tên hoặc chức năng" />
        </div>
        <span className="config-search-count" aria-live="polite">{filteredCards.length} mục</span>
        {searchQuery && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearchQuery('')}>Xóa tìm kiếm</button>}
      </div>
      {failedQueries.length > 0 && <div className="config-read-error" role="alert">
        <span>Một số thông tin tổng hợp chưa tải được. Bạn vẫn có thể mở các mục bên dưới.</span>
        <button type="button" className="btn btn--secondary btn--sm" disabled={retrying} onClick={() => { void Promise.all(failedQueries.map(query => query.refetch())); }}>{retrying ? 'Đang thử lại…' : 'Thử lại'}</button>
      </div>}

      {filteredCards.length === 0 ? (
        <div className="config-search-empty">
          <Search size={32} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
          <h3 style={{ fontSize: 'var(--text-section-size)', fontWeight: 600, color: 'var(--fg-2)', marginBottom: 4 }}>Không tìm thấy cấu hình</h3>
          <p style={{ fontSize: 'var(--text-data-size)' }}>Hãy thử tìm kiếm với từ khóa khác.</p>
          <button type="button" className="btn btn--secondary" onClick={() => setSearchQuery('')}>Hiện tất cả cấu hình</button>
        </div>
      ) : (
        <div className="settings-grid asset-route-grid" data-tour-id="config-grid">
          {filteredCards.map(card => (
            <button key={card.path} className="setting-card" onClick={() => navigate(card.path)}>
              <div className="setting-card__icon">{card.icon}</div>
              <h3 className="setting-card__title">{card.title}</h3>
              <p className="setting-card__desc">{card.desc}</p>
              <div className="setting-card__foot">
                <span className="setting-card__status">
                  <span className="dot" style={card.statusColor ? { background: card.statusColor } : undefined}></span>
                  {card.status}
                </span>
                <span className="setting-card__action">{card.action} {CHEVRON}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
