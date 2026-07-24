import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '../lib/format';
import { TxnType } from '@tingting/shared';
import type { LedgerEntry } from '@tingting/shared';
import { AlertTriangle, Download, Phone, Building2, ArrowLeft, Plus, X, Loader2, Save, Truck } from 'lucide-react';
import { useCustomerStatement, useSupplierStatement } from '../hooks/useQueries';
import { api } from '../lib/api';
import { Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Tooltip } from '../components/shared/Tooltip';
import AssetIcon from '../components/AssetIcon';
import BillingDocumentsPanel from '../components/billing/BillingDocumentsPanel';
import { useToast } from '../components/shared/Toast';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useAgentOpenable } from '../hooks/useAgentOpenable';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { qk } from '../api/keys';
import { onboardingEvents } from '../lib/onboardingEvents';
import './DebtDetailPage.css';
import { normalizeAging, money, rowTypeLabel, FILTER_OPTIONS, type LedgerFilter, type WorkspaceTab } from './debt-detail-ledger';
import { PeriodFilter, resolvePeriodRange, initialPeriodState, applyModeSwitch } from '../components/debt/PeriodFilter';
import { PeriodSummaryCards } from '../components/debt/PeriodSummaryCards';
import { matchLinkedSupplierStatement } from './linked-supplier-statement';

// ── Aging constants ────────────────────────────────────────────────────────

const AGING_RANGES = [
  { label: '0–30 NGÀY',  dotColor: 'var(--accent)',  index: 0 },
  { label: '31–60 NGÀY', dotColor: 'var(--warning)', index: 1 },
  { label: '61–90 NGÀY', dotColor: '#D97706',        index: 2 },
  { label: 'TRÊN 90 NGÀY', dotColor: 'var(--danger)', index: 3 },
] as const;

export function DualEntityLookupError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="dd-ledger dd-ledger--standalone" style={{ marginBottom: 16 }}>
      <div className="dd-table-empty" role="alert">
        Không thể kiểm tra công nợ phải trả liên kết.{' '}
        <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
          Thử lại
        </button>
      </div>
    </section>
  );
}

// ── Ledger filter type ─────────────────────────────────────────────────────

export default function DebtDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isCompactLedger = useMediaQuery('(max-width: 1023px)');
  const backPath = location.pathname.startsWith('/customers/') ? '/customers' : '/debt';
  const isCustomerRoute = location.pathname.startsWith('/customers/');
  const parentCrumb = isCustomerRoute
    ? { label: 'Khách hàng', to: '/customers' }
    : { label: 'Công nợ phải thu', to: '/debt' };
  const detailPath = location.pathname.startsWith('/customers/') ? `/customers/${id}` : `/debt/${id}`;
  const billingCreatePath = `${detailPath}/billing/new`;
  const isCreatingBillingDocument = location.pathname === billingCreatePath;

  // ── Period filter (ledger tab only) ──────────────────────────────────────
  // Declared before useCustomerStatement because the resolved range feeds the
  // statement query. Defaults to current month.
  const [period, setPeriod] = useState(() => initialPeriodState());
  const [appliedPeriod, setAppliedPeriod] = useState(period);
  const appliedPeriodRange = useMemo(
    () => resolvePeriodRange(appliedPeriod),
    [appliedPeriod],
  );

  // The customer profile is a current-state view. Keep it independent from
  // the period-scoped statement used by the ledger below.
  const {
    data: profileStatement,
    isLoading: isProfileLoading,
    error: profileQueryError,
  } = useCustomerStatement(id);
  const {
    data: statement,
    isFetching: isStatementFetching,
    refetch,
  } = useCustomerStatement(id, appliedPeriodRange);
  const error = profileQueryError ? (profileQueryError as Error).message : null;
  const { rootRef } = usePageAnimations({ ready: !isProfileLoading && !!profileStatement });

  const handleBack = () => navigate(backPath);
  useBackShortcut(handleBack);

  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() =>
    isCreatingBillingDocument ? 'debit-note' : 'ledger',
  );
  const isPeriodDirty = period.mode !== appliedPeriod.mode
    || period.month !== appliedPeriod.month
    || period.year !== appliedPeriod.year
    || period.dateFrom !== appliedPeriod.dateFrom
    || period.dateTo !== appliedPeriod.dateTo;

  useEffect(() => {
    if (isCreatingBillingDocument) setWorkspaceTab('debit-note');
  }, [isCreatingBillingDocument]);

  // Payment modal state — was missing entirely (BUG: no way to record
  // a payment from the debt detail page even though /api/payments/receive
  // exists on the backend).
  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payReceipt, setPayReceipt] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState('');
  const queryClient = useQueryClient();
  const { toast: showToast } = useToast();

  // Agent "open/prefill" target: the bot can open this payment modal (and
  // prefill the amount) when the user is on this page — the "do it for you"
  // half of guidance. Read-only-safe: the user still reviews + submits.
  useAgentOpenable(
    'debt.record-payment',
    useCallback((d) => {
      const prefill = d.kind === 'prefill' ? d.values : d.prefill;
      const amount = prefill && typeof prefill.amount === 'number' ? prefill.amount : undefined;
      if (amount !== undefined) setPayAmount(String(amount));
      setShowPay(true);
    }, []),
  );

  const downloadExport = async (format: string) => {
    try {
      const blob = await api.getBlob(`/ledger/customers/${id}/statement/export?format=${format}`);
      const url = URL.createObjectURL(blob);
      if (format === 'pdf') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `sao-ke-${profileStatement?.customer.name}-${new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(/\//g, '-')}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi xuất sao kê' });
    }
  };

  // Debit-note export now lives in <BillingDocumentsPanel> below (saved-snapshot
  // Giấy báo nợ). The old stateless /finance/debit-note/export button was removed
  // when the export menu here was collapsed to a single statement-xlsx button.

  // ── Linked supplier data (dual-entity customers) ─────────────────────────
  // The customer statement doesn't expose linkedSupplierId directly, so we
  // carry it via the /finance/dual-entities call. However, to keep this
  // page self-contained we instead read it from the customer-aging cache,
  // or fall back to fetching the supplier statement once we know the id.
  // We derive linkedSupplierId from a lightweight dual-entity check.
  const customerId = id ? Number(id) : undefined;
  const {
    data: dualEntities,
    isError: isDualEntityLookupError,
    refetch: refetchDualEntities,
  } = useQuery<Array<{
    customerId: number; supplierId: number; arBalance: number; apBalance: number;
  }>>({
    queryKey: qk.tripForm.dualEntities,
    queryFn: () => api.get('/finance/dual-entities'),
    staleTime: 2 * 60 * 1000,
  });
  const dualEntity = dualEntities?.find(e => e.customerId === customerId);
  const linkedSupplierId = dualEntity?.supplierId ?? null;

  // Fetch supplier statement only when this customer has a linked supplier
  const {
    data: supplierStatement,
    isLoading: isSupplierStatementLoading,
    isPlaceholderData: isSupplierStatementPlaceholder,
    isError: isSupplierStatementError,
    refetch: refetchSupplierStatement,
  } = useSupplierStatement(linkedSupplierId ?? undefined);
  const matchedSupplierStatement = matchLinkedSupplierStatement(supplierStatement, linkedSupplierId);
  const isLinkedSupplierLoading = isSupplierStatementLoading
    || isSupplierStatementPlaceholder
    || (!!supplierStatement && !matchedSupplierStatement);
  const apBalance = matchedSupplierStatement?.totalOutstanding ?? dualEntity?.apBalance ?? 0;
  const arBalance = profileStatement?.totalOutstanding ?? 0;

  // ── Derived data ────────────────────────────────────────────────────────

  const agingAmounts = useMemo(() =>
    normalizeAging(profileStatement?.agingBuckets ?? []),
    [profileStatement?.agingBuckets]
  );

  const filteredRows = useMemo(() => {
    if (!statement) return [];
    if (ledgerFilter === 'all') return statement.ledgerRows;
    if (ledgerFilter === TxnType.SERVICE_FEE) {
      return statement.ledgerRows.filter(r => r.txnType === TxnType.SERVICE_FEE || Boolean(r.serviceFeeLabel));
    }
    if (ledgerFilter === TxnType.TRIP_REVENUE) {
      return statement.ledgerRows.filter(r => r.txnType === TxnType.TRIP_REVENUE && !r.serviceFeeLabel);
    }
    return statement.ledgerRows.filter(r => r.txnType === ledgerFilter);
  }, [statement, ledgerFilter]);

  const activeAgingIdx = useMemo(() => {
    let max = -1, idx = 0;
    agingAmounts.forEach((a, i) => { if (a > max) { max = a; idx = i; } });
    return max > 0 ? idx : -1;
  }, [agingAmounts]);

  const lastPayment = useMemo(() => {
    if (!profileStatement) return null;
    return [...profileStatement.ledgerRows]
      .filter((row) => row.txnType === TxnType.PAYMENT_RECEIVED)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ?? null;
  }, [profileStatement]);

  const totalOutstanding = profileStatement?.totalOutstanding ?? 0;

  // ── Loading / Error ─────────────────────────────────────────────────────

  if (isProfileLoading && !profileStatement) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>
        Đang tải dữ liệu...
      </div>
    );
  }

  if (!profileStatement) {
    return (
      <div className="debt-detail-page">
        <div className="dd-header">
          <button className="dd-back" aria-label="Quay lại" onClick={handleBack}>
            <ArrowLeft size={20} />
          </button>
          <div className="dd-meta">
            <h1>Sổ kế toán</h1>
          </div>
        </div>
        <div className="dd-summary">
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{error || 'Không tìm thấy dữ liệu'}</p>
        </div>
      </div>
    );
  }

  const { customer, ledgerRows } = profileStatement;
  const hasDebt = totalOutstanding > 0;
  const agingTotal = agingAmounts.reduce((s, a) => s + a, 0) || 1; // avoid /0
  const unpaidTrips = profileStatement.unpaidTrips ?? [];
  const oldestUnpaidTrip = unpaidTrips[0] ?? null;
  const activeAgingRange = activeAgingIdx >= 0 ? AGING_RANGES[activeAgingIdx] : null;
  const activeAgingAmount = activeAgingIdx >= 0 ? agingAmounts[activeAgingIdx] : 0;
  const workspaceTabs: Array<{ key: WorkspaceTab; label: string; meta: string }> = [
    { key: 'ledger', label: 'Chi tiết công nợ', meta: `${statement?.ledgerRows.length ?? 0} khoản phát sinh` },
    { key: 'payments', label: 'Thanh toán', meta: hasDebt ? `${unpaidTrips.length} chuyến chưa thu` : 'Không còn nợ' },
    { key: 'statement', label: 'Bảng kê', meta: 'Lập chứng từ thanh toán' },
    { key: 'debit-note', label: 'Giấy báo nợ', meta: 'Nhắc nợ theo mẫu' },
  ];

  // FIFO-distribute the entered amount across the oldest unpaid trips,
  // then POST. The backend also re-applies FIFO inside the transaction
  // for safety; this just gives the user a clear preview of how their
  // payment will land.
  const openPaymentModal = () => {
    setPayAmount('');
    setPayReceipt('');
    setPayError('');
    setShowPay(true);
  };

  const submitPayment = async () => {
    setPayError('');
    const amount = parseFloat(payAmount.replace(/[.,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError('Số tiền không hợp lệ.');
      return;
    }
    if (!payReceipt.trim()) {
      setPayError('Mã biên lai là bắt buộc.');
      return;
    }
    if (unpaidTrips.length === 0) {
      setPayError('Khách hàng không có công nợ để thanh toán.');
      return;
    }
    // Cap at total outstanding so we don't overpay.
    const capped = Math.min(amount, totalOutstanding);
    let remaining = capped;
    const payments: Array<{ tripId: number; amount: number }> = [];
    for (const t of unpaidTrips) {
      if (remaining <= 0) break;
      const apply = Math.min(t.outstanding, remaining);
      payments.push({ tripId: t.tripId, amount: apply });
      remaining -= apply;
    }
    setPaySubmitting(true);
    try {
      await api.post('/payments/receive', {
        customerId: Number(id),
        receiptId: payReceipt.trim(),
        payments,
      });
      // Onboarding product event: a real receivable payment was recorded. The
      // ACCOUNTANT checklist's "record first receipt" item waits on this.
      onboardingEvents.emit('receivable.payment_recorded', {
        customerId: Number(id),
        amountVnd: capped,
      });
      // Broad prefix — invalidates every customer-statement query regardless
      // of period range, so the AR detail page's month/range-scoped statement
      // refetches alongside any other cached variant.
      await queryClient.invalidateQueries({ queryKey: qk.financial.customerStatementAll });
      await queryClient.invalidateQueries({ queryKey: qk.financial.debt });
      // V1: a payment also changes AR aging + the Dashboard overdue KPI, which
      // live under separate query keys — without these the DebtListPage hero
      // cards and the Dashboard attention chip go stale until staleTime (2m).
      await queryClient.invalidateQueries({ queryKey: qk.financial.customerAgingAll });
      await queryClient.invalidateQueries({ queryKey: qk.dashboard.receivablesSummary });
      await refetch();
      setShowPay(false);
    } catch (e: unknown) {
      setPayError((e as Error)?.message || 'Lỗi khi ghi nhận thanh toán.');
    } finally {
      setPaySubmitting(false);
    }
  };

  return (
    <div ref={rootRef} className="debt-detail-page">
      <Breadcrumbs
        className="debt-detail__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: parentCrumb.label, to: parentCrumb.to },
          { label: customer.name },
        ]}
        renderLink={(to, children) => (
          <a onClick={() => navigate(to)} style={{ cursor: 'pointer' }}>{children}</a>
        )}
      />
      {/* ── Customer Header ─────────────────────────────────────────────── */}
      <div className="dd-header">
        <Tooltip label="Quay lại" side="right">
          <button className="dd-back" aria-label="Quay lại" onClick={handleBack}>
            <ArrowLeft size={20} />
          </button>
        </Tooltip>
        <div className="dd-avatar">
          <AssetIcon
            name="customer"
            size={28}
            alt="Biểu tượng khách hàng"
            className="dd-avatar__icon"
          />
        </div>
        <div className="dd-meta">
          <div className="dd-name-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1>{customer.name}</h1>
            {customer.isCarrier && (
              <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 4, padding: '3px 7px', letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Truck size={12} aria-hidden="true" /> Xe ngoài
              </span>
            )}
          </div>
          <div className="dd-sub">
            {customer.contactInfo && (
              <span>
                <Phone size={15} />
                <span className="dd-mono">{customer.contactInfo}</span>
              </span>
            )}
            <span>
              <Building2 size={15} />
              Khách hàng doanh nghiệp
            </span>
            {hasDebt ? (
              <span className="dd-tag dd-tag--warn dd-tag--dot">Còn nợ trong hạn</span>
            ) : (
              <span className="dd-tag dd-tag--ok dd-tag--dot">Đã thanh toán đủ</span>
            )}
          </div>
        </div>
        <div className="dd-actions">
          {hasDebt && (
            <button
              className="btn btn--primary"
              data-tour-id="debt-record-payment"
              onClick={openPaymentModal}
            >
              <Plus size={14} />
              Ghi nhận thanh toán
            </button>
          )}
          <button
            className="btn btn--secondary"
            onClick={() => downloadExport('xlsx')}
          >
            <Download size={14} />
            Xuất sao kê
          </button>
        </div>
      </div>

      <section className="dd-account-strip" aria-label="Tóm tắt công nợ">
        <article className={`dd-account-card${hasDebt ? ' dd-account-card--debt' : ' dd-account-card--clear'}`}>
          <span>Dư nợ hiện tại</span>
          <strong>{money(totalOutstanding)}</strong>
          <small>{hasDebt ? 'Cần theo dõi thu hồi' : 'Đã tất toán'}</small>
        </article>
        <article className="dd-account-card">
          <span>Chuyến chưa thu</span>
          <strong>{unpaidTrips.length}</strong>
          <small>{oldestUnpaidTrip ? `Cũ nhất ${formatDate(oldestUnpaidTrip.date)}` : 'Không phát sinh'}</small>
        </article>
        <article className="dd-account-card">
          <span>Phiếu thu gần nhất</span>
          <strong>{lastPayment ? money(parseFloat(lastPayment.credit) || 0) : '-'}</strong>
          <small>{lastPayment ? formatDate(lastPayment.timestamp) : 'Chưa có phiếu thu'}</small>
        </article>
        <article className="dd-account-card">
          <span>Nhóm tuổi nợ nổi bật</span>
          <strong>{activeAgingRange ? activeAgingRange.label : 'Không nợ'}</strong>
          <small>{activeAgingRange ? money(activeAgingAmount) : 'Không có số dư'}</small>
        </article>
      </section>

      {/* ── Aging Summary ───────────────────────────────────────────────── */}
      <section className="dd-summary dd-summary--aging">
        <div className="dd-sum-top">
          <div>
            <div className="dd-sum-label">PHÂN BỔ TUỔI NỢ</div>
            <p className="dd-sum-copy">
              {hasDebt
                ? 'Theo dõi phần công nợ nào đang tiến gần hạn hoặc đã quá hạn.'
                : 'Khách hàng không còn công nợ đang mở.'}
            </p>
            {hasDebt && (
              <div className="dd-sum-note">
                <AlertTriangle size={17} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                {activeAgingIdx <= 0
                  ? 'Toàn bộ công nợ đang trong hạn 30 ngày — cần theo dõi thu hồi.'
                  : `Có công nợ quá hạn ${AGING_RANGES[activeAgingIdx].label.toLowerCase()} — cần ưu tiên thu hồi.`
                }
              </div>
            )}
          </div>
          <div className="dd-sum-update">
            Cập nhật lần cuối
            <b>{new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</b>
            {ledgerRows.length} giao dịch trong kỳ
          </div>
        </div>

        {/* Aging bar */}
        <div className="dd-aging-bar">
          {agingAmounts.map((amt, i) => {
            const pct = agingTotal > 0 ? (amt / agingTotal) * 100 : 0;
            return pct > 0
              ? <i key={i} className={`dd-seg-${i}`} style={{ width: `${pct}%` }} />
              : null;
          })}
        </div>

        {/* Aging grid */}
        <div className="dd-aging-grid">
          {AGING_RANGES.map((range, i) => {
            const amt = agingAmounts[i];
            const isActive = i === activeAgingIdx;
            const pct = agingTotal > 0 ? Math.round((amt / agingTotal) * 100) : 0;
            return (
              <div key={i} className={`dd-aging-cell${isActive ? ' dd-aging-cell--active' : ''}`}>
                <div className="dd-ac-head">
                  <span className="dd-ac-dot" style={{ background: range.dotColor }} />
                  {range.label}
                </div>
                <div className={`dd-ac-val${amt === 0 ? ' dd-ac-val--zero' : ''}`}>
                  {formatCurrency(amt).replace(' ₫', '')}đ
                </div>
                <div className="dd-ac-share">
                  {amt > 0 ? `${pct}% tổng công nợ` : 'Không phát sinh'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isDualEntityLookupError && (
        <DualEntityLookupError onRetry={() => { void refetchDualEntities(); }} />
      )}

      {/* ── AP ledger (dual-entity customers) ──────────────────────────── */}
      {linkedSupplierId != null && (
        <LinkedSupplierPayableLedger
          supplierId={linkedSupplierId}
          supplierName={matchedSupplierStatement?.supplier.name ?? 'nhà cung cấp liên kết'}
          rows={matchedSupplierStatement?.ledgerRows ?? []}
          isCompact={isCompactLedger}
          isLoading={isLinkedSupplierLoading}
          isError={isSupplierStatementError}
          onRetry={() => { void refetchSupplierStatement(); }}
          arBalance={arBalance}
          apBalance={apBalance}
        />
      )}

      <section className="dd-workspace" aria-label="Không gian làm việc công nợ">
        <div className="dd-workspace-head">
          <div>
            <span className="dd-panel-eyebrow">Hồ sơ khách hàng</span>
            <h2>Chi tiết & chứng từ công nợ</h2>
          </div>
          <div className="dd-workspace-tabs" role="tablist" aria-label="Chọn nghiệp vụ công nợ">
            {workspaceTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={workspaceTab === tab.key}
                className={`dd-workspace-tab${workspaceTab === tab.key ? ' dd-workspace-tab--active' : ''}`}
                onClick={() => setWorkspaceTab(tab.key)}
              >
                <span>{tab.label}</span>
                <small>{tab.meta}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="dd-workspace-body">
          {workspaceTab === 'statement' && id && (
            <BillingDocumentsPanel
              type="PAYMENT_STATEMENT"
              entityType="CUSTOMER"
              entityId={Number(id)}
              entityName={profileStatement.customer.name}
              buttonLabel="Tạo bảng kê"
            />
          )}

          {workspaceTab === 'debit-note' && id && (
            <BillingDocumentsPanel
              type="DEBIT_NOTE"
              entityType="CUSTOMER"
              entityId={Number(id)}
              entityName={profileStatement.customer.name}
              buttonLabel="Tạo giấy báo nợ"
              createBuilderOpen={isCreatingBillingDocument}
              onOpenCreate={() => navigate(billingCreatePath)}
              onBuilderClose={() => navigate(detailPath, { replace: true })}
            />
          )}

          {workspaceTab === 'payments' && (
            <section className="dd-payment-panel">
              <div className="dd-payment-panel__main">
                <span className="dd-panel-eyebrow">Phiếu thu</span>
                <h2>{hasDebt ? 'Ghi nhận thanh toán khách hàng' : 'Khách hàng đã thanh toán đủ'}</h2>
                <p>
                  {hasDebt
                    ? 'Khoản thu sẽ được phân bổ FIFO vào các chuyến còn nợ, bắt đầu từ chuyến cũ nhất.'
                    : 'Không có chuyến nào đang mở công nợ để ghi nhận thêm thanh toán.'}
                </p>
                <button
                  className="btn btn--primary"
                  data-tour-id="debt-record-payment"
                  type="button"
                  onClick={openPaymentModal}
                  disabled={!hasDebt}
                >
                  <Plus size={14} />
                  Ghi nhận thanh toán
                </button>
              </div>
              <div className="dd-payment-panel__side" aria-label="Tóm tắt thanh toán">
                <div>
                  <span>Còn nợ</span>
                  <strong>{money(totalOutstanding)}</strong>
                </div>
                <div>
                  <span>Chuyến chưa thu</span>
                  <strong>{unpaidTrips.length}</strong>
                </div>
                {oldestUnpaidTrip && (
                  <div>
                    <span>Chuyến cũ nhất</span>
                    <strong>{formatDate(oldestUnpaidTrip.date)}</strong>
                    <small>{money(oldestUnpaidTrip.outstanding)}</small>
                  </div>
                )}
              </div>
            </section>
          )}

          {workspaceTab === 'ledger' && (
            <section className="dd-ledger">
              <div className="dd-ledger-head dd-ledger-head--workspace">
                <div className="dd-ledger-heading">
                  <h2>Chi tiết công nợ phải thu</h2>
                  <p>Toàn bộ cước, phí chi hộ, khoản đã thu và điều chỉnh của khách hàng.</p>
                </div>
                <span className="dd-cnt">{filteredRows.length} giao dịch</span>
                <div className="dd-filters">
                  {FILTER_OPTIONS.map(f => (
                    <button
                      key={f.key}
                      className={`dd-filter-chip${ledgerFilter === f.key ? ' dd-filter-chip--on' : ''}`}
                      onClick={() => setLedgerFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Period filter + period summary (số dư đầu kỳ / phát sinh / cuối kỳ) */}
              <PeriodFilter
                mode={period.mode}
                onModeChange={(m) => setPeriod(p => applyModeSwitch(p, m))}
                month={period.month}
                year={period.year}
                onMonthYearChange={({ month, year }) => setPeriod(p => ({ ...p, month, year }))}
                dateFrom={period.dateFrom}
                dateTo={period.dateTo}
                onRangeChange={(next) => setPeriod(p => ({ ...p, ...next }))}
                onApply={() => setAppliedPeriod(period)}
                isApplying={isStatementFetching}
                isApplyDisabled={!isPeriodDirty || isStatementFetching}
              />
              <PeriodSummaryCards
                summary={statement?.periodSummary}
                isLoading={isStatementFetching}
                entityType="CUSTOMER"
              />

              {isCompactLedger ? (
                <ul className="dd-ledger-mobile d-list" aria-label="Danh sách giao dịch công nợ phải thu">
                  {filteredRows.map(row => (
                    <ReceivableLedgerCard key={row.id} row={row} />
                  ))}
                  {filteredRows.length === 0 && (
                    <li className="dd-ledger-mobile-empty">Không có giao dịch</li>
                  )}
                </ul>
              ) : (
                <div className="table-scroll">
                  <table className="dd-table dd-detail-table">
                    <thead>
                      <tr>
                        <th>NGÀY</th>
                        <th>CHUYẾN / ĐỐI CHIẾU</th>
                        <th>NỘI DUNG</th>
                        <th>LOẠI</th>
                        <th className="dd-r">PHÁT SINH PHẢI THU</th>
                        <th className="dd-r">ĐÃ THU</th>
                        <th className="dd-r">SỐ DƯ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(row => (
                        <ReceivableLedgerRow key={row.id} row={row} />
                      ))}
                      {filteredRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="dd-table-empty">Không có giao dịch</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </section>

      {/* Payment modal — FIFO across unpaid trips */}
      <Modal
        isOpen={showPay}
        title={`Ghi nhận thanh toán — ${customer.name}`}
        onClose={() => setShowPay(false)}
        onConfirm={submitPayment}
        footer={
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowPay(false)}>
              <X size={14} /> Hủy
            </button>
            <button
              className="btn btn--primary btn--sm"
              data-tour-id="debt-payment-submit"
              disabled={paySubmitting || !payAmount.trim() || !payReceipt.trim()}
              onClick={submitPayment}
            >
              {paySubmitting ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Ghi nhận
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {payError && (
            <div style={{ padding: '10px 12px', background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 8, fontSize: 13 }}>
              {payError}
            </div>
          )}
          <div style={{
            padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 8,
            fontSize: 13, color: 'var(--fg-2)',
          }}>
            Còn nợ: <strong style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
              {formatCurrency(totalOutstanding)}
            </strong> ({unpaidTrips.length} chuyến chưa thu)
          </div>
          <div className="field">
            <label htmlFor="pay-amount" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 6 }}>
              Số tiền nhận (đ) <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              id="pay-amount"
              className="input"
              type="number"
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              placeholder="VD: 5000000"
              autoFocus
            />
            <p style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', marginTop: 4 }}>
              Sẽ phân bổ FIFO vào {unpaidTrips.length} chuyến chưa thu, bắt đầu từ chuyến cũ nhất.
            </p>
          </div>
          <div className="field">
            <label htmlFor="pay-receipt" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 6 }}>
              Mã biên lai / phiếu thu <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              id="pay-receipt"
              className="input"
              value={payReceipt}
              onChange={e => setPayReceipt(e.target.value)}
              placeholder="VD: PT-20260601-01"
            />
            <p style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', marginTop: 4 }}>
              Bắt buộc để đối chiếu với sao kê ngân hàng / sổ quỹ.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function receivablePill(txnType: TxnType): string {
  if (txnType === TxnType.PAYMENT_RECEIVED) return 'dd-txn-pill dd-txn-pill--pay';
  if (txnType === TxnType.TRIP_REVENUE) return 'dd-txn-pill dd-txn-pill--rev';
  if (txnType === TxnType.SERVICE_FEE) return 'dd-txn-pill dd-txn-pill--fee';
  if (txnType === TxnType.ADJUSTMENT || txnType === TxnType.UNLOCK_REVERSAL) {
    return 'dd-txn-pill dd-txn-pill--adj';
  }
  return 'dd-txn-pill dd-txn-pill--other';
}

function ReceivableLedgerRow({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const tripId = row.tripId ?? (
    row.txnType === TxnType.TRIP_REVENUE || row.txnType === TxnType.PAYMENT_RECEIVED
      ? row.txnId
      : null
  );
  const containers = row.containerNumbers?.filter(Boolean) ?? [];
  const primaryContent = row.routeName || row.serviceFeeLabel || row.note || 'Không có ghi chú';
  const secondaryContent = row.routeName && row.note && row.note !== row.routeName ? row.note : null;

  return (
    <tr>
      <td className="dd-td-date">{formatDate(row.timestamp)}</td>
      <td className="dd-reference">
        <strong>{row.tripCode || (tripId ? 'Chuyến chưa có mã' : row.receiptId || row.note || 'Giao dịch')}</strong>
        {containers.length > 0 && <small>Container {containers.join(', ')}</small>}
        {row.receiptId && tripId && <small>{row.receiptId}</small>}
      </td>
      <td className="dd-detail-content">
        <strong>{primaryContent}</strong>
        {secondaryContent && <small>{secondaryContent}</small>}
      </td>
      <td><span className={receivablePill(row.txnType)}>{rowTypeLabel(row)}</span></td>
      <td className={`dd-num ${debit > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {debit > 0 ? money(debit) : '–'}
      </td>
      <td className={`dd-num ${credit > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {credit > 0 ? money(credit) : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{money(Math.abs(balance))}
      </td>
    </tr>
  );
}

export function ReceivableLedgerCard({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const tripId = row.tripId ?? (
    row.txnType === TxnType.TRIP_REVENUE || row.txnType === TxnType.PAYMENT_RECEIVED
      ? row.txnId
      : null
  );
  const containers = row.containerNumbers?.filter(Boolean) ?? [];
  const reference = row.tripCode || (tripId ? 'Chuyến chưa có mã' : row.receiptId || row.note || 'Giao dịch');
  const detail = row.routeName || row.serviceFeeLabel || row.note || 'Không có ghi chú';
  const secondaryDetail = row.routeName && row.note && row.note !== row.routeName ? row.note : null;

  return (
    <li className="dd-ledger-mobile-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={row.timestamp}>{formatDate(row.timestamp)}</time>
        <span className={receivablePill(row.txnType)}>{rowTypeLabel(row)}</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{reference}</strong>
        <p>{detail}</p>
        {secondaryDetail && <p>{secondaryDetail}</p>}
        {containers.length > 0 && <small>Container {containers.join(', ')}</small>}
        {row.receiptId && tripId && <small>{row.receiptId}</small>}
      </div>
      <dl className="dd-ledger-mobile-card__amounts">
        <div>
          <dt>Phải thu</dt>
          <dd>{debit > 0 ? money(debit) : '–'}</dd>
        </div>
        <div>
          <dt>Đã thu</dt>
          <dd className={credit > 0 ? 'text-success' : ''}>{credit > 0 ? money(credit) : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd className={balance > 0 ? 'text-error' : balance < 0 ? 'text-success' : ''}>
            {balance < 0 ? '-' : ''}{money(Math.abs(balance))}
          </dd>
        </div>
      </dl>
    </li>
  );
}

const PAYABLE_TXN_META: Record<string, { label: string; pill: string }> = {
  [TxnType.VENDOR_EXPENSE]: { label: 'Ghi nhận chi phí', pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.VENDOR_PAYMENT]: { label: 'Thanh toán công nợ', pill: 'dd-txn-pill dd-txn-pill--pay' },
  [TxnType.ADJUSTMENT]: { label: 'Điều chỉnh', pill: 'dd-txn-pill dd-txn-pill--adj' },
  [TxnType.FUEL_EXPENSE]: { label: 'Chi phí nhiên liệu', pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.COMMISSION]: { label: 'Hoa hồng', pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.UNLOCK_REVERSAL]: { label: 'Hoàn tác', pill: 'dd-txn-pill dd-txn-pill--adj' },
};
const DEFAULT_PAYABLE_TXN_META = {
  label: 'Khác',
  pill: 'dd-txn-pill dd-txn-pill--other',
};

function payableRowDetails(row: LedgerEntry) {
  const meta = PAYABLE_TXN_META[row.txnType] ?? DEFAULT_PAYABLE_TXN_META;
  const reference = row.receiptId
    || (row.txnType === TxnType.FUEL_EXPENSE ? row.tripCode || 'Chuyến chưa có mã' : null)
    || row.note
    || meta.label;

  return {
    meta,
    reference,
    payable: parseFloat(row.credit) || 0,
    paid: parseFloat(row.debit) || 0,
    balance: parseFloat(row.balance) || 0,
  };
}

function LinkedSupplierPayableRow({ row }: { row: LedgerEntry }) {
  const { meta, reference, payable, paid, balance } = payableRowDetails(row);

  return (
    <tr>
      <td className="dd-td-date">{formatDate(row.timestamp)}</td>
      <td className="dd-reference"><strong>{reference}</strong></td>
      <td><span className={meta.pill}>{meta.label}</span></td>
      <td className={`dd-num ${payable > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {payable > 0 ? money(payable) : '–'}
      </td>
      <td className={`dd-num ${paid > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {paid > 0 ? money(paid) : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{money(Math.abs(balance))}
      </td>
      <td className="dd-td-note">{row.note || '–'}</td>
    </tr>
  );
}

function LinkedSupplierPayableCard({ row }: { row: LedgerEntry }) {
  const { meta, reference, payable, paid, balance } = payableRowDetails(row);

  return (
    <li className="dd-ledger-mobile-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={row.timestamp}>{formatDate(row.timestamp)}</time>
        <span className={meta.pill}>{meta.label}</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{reference}</strong>
        <p>{row.note || 'Không có ghi chú'}</p>
      </div>
      <dl className="dd-ledger-mobile-card__amounts">
        <div>
          <dt>Phải trả</dt>
          <dd>{payable > 0 ? money(payable) : '–'}</dd>
        </div>
        <div>
          <dt>Đã trả</dt>
          <dd className={paid > 0 ? 'text-success' : ''}>{paid > 0 ? money(paid) : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd className={balance > 0 ? 'text-error' : balance < 0 ? 'text-success' : ''}>
            {balance < 0 ? '-' : ''}{money(Math.abs(balance))}
          </dd>
        </div>
      </dl>
    </li>
  );
}

interface LinkedSupplierPayableLedgerProps {
  supplierId: number;
  supplierName: string;
  rows: LedgerEntry[];
  isCompact: boolean;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  arBalance: number;
  apBalance: number;
}

export function LinkedSupplierPayableLedger({
  supplierId,
  supplierName,
  rows,
  isCompact,
  isLoading,
  isError = false,
  onRetry = () => undefined,
  arBalance,
  apBalance,
}: LinkedSupplierPayableLedgerProps) {
  const emptyMessage = isLoading
    ? 'Đang tải giao dịch công nợ phải trả...'
    : 'Chưa có giao dịch công nợ phải trả';

  return (
    <section
      className="dd-ledger dd-ledger--standalone"
      aria-label={`Chi tiết công nợ phải trả của ${supplierName}`}
      style={{ marginBottom: 16 }}
    >
      <div className="dd-ledger-head">
        <div className="dd-ledger-heading">
          <span className="dd-panel-eyebrow">Nhà cung cấp liên kết</span>
          <h2>Chi tiết công nợ phải trả</h2>
          <p>
            {supplierName} · Còn phải trả {money(apBalance)} · Số ròng {money(arBalance - apBalance)}
          </p>
        </div>
        <span className="dd-cnt">{rows.length} giao dịch</span>
        <a
          className="btn btn--secondary btn--sm"
          href={`/payables/${supplierId}`}
          aria-label="Mở trang công nợ nhà cung cấp"
        >
          Xem đầy đủ
        </a>
      </div>

      {isError ? (
        <div className="dd-table-empty" role="alert">
          Không thể tải chi tiết công nợ phải trả.{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
            Thử lại
          </button>
        </div>
      ) : isCompact ? (
        <ul className="dd-ledger-mobile d-list" aria-label="Danh sách giao dịch công nợ phải trả">
          {rows.map(row => <LinkedSupplierPayableCard key={row.id} row={row} />)}
          {rows.length === 0 && <li className="dd-ledger-mobile-empty">{emptyMessage}</li>}
        </ul>
      ) : (
        <div className="table-scroll">
          <table className="dd-table dd-detail-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Đối chiếu</th>
                <th>Loại giao dịch</th>
                <th className="dd-r">Phải trả</th>
                <th className="dd-r">Đã trả</th>
                <th className="dd-r">Số dư</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => <LinkedSupplierPayableRow key={row.id} row={row} />)}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="dd-table-empty">{emptyMessage}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
