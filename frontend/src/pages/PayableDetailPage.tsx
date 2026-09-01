import { useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DateInput } from '../design-system/forms/DateInput';
import { formatCurrency } from '../lib/format';
import { TxnType, FINANCIAL } from '@tingting/shared';
import type { SupplierStatement as SupplierStatementType, LedgerEntry, VendorPaymentRequest } from '@tingting/shared';
import { AGING_RANGES, normalizeAging, activeAgingIndex } from '../components/debt/aging';
import { AlertTriangle, Phone, Building2, ArrowLeft, CreditCard, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useSupplierStatement } from '../hooks/useQueries';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/shared/Toast';
import { useConfirm, Modal } from '../components/UI';
import BillingDocumentsPanel from '../components/billing/BillingDocumentsPanel';
import { TXN_META, DEFAULT_META, LedgerRow, FuelLedgerRow, FuelLedgerCard, ExpenseLedgerCard, PayableLedgerCard } from '../features/accounting/ledger-rows';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { qk } from '../api/keys';
import { useClickOutside } from '../hooks/useClickOutside';
import { PeriodFilter, resolvePeriodRange, initialPeriodState, applyModeSwitch } from '../components/debt/PeriodFilter';
import { PeriodSummaryCards } from '../components/debt/PeriodSummaryCards';
import { SortHeader } from '../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../lib/table-sort';
import { useMediaQuery } from '../hooks/useMediaQuery';
import './DebtDetailPage.css';
import '../styles/table-sort.css';


type LedgerFilter = 'all' | typeof TxnType.VENDOR_EXPENSE | typeof TxnType.VENDOR_PAYMENT | typeof TxnType.ADJUSTMENT | typeof TxnType.FUEL_EXPENSE | typeof TxnType.EXTERNAL_CARRIER_COST;

/* ─── Client-side ledger column sorts ──────────────────────────────────────── */
// The statement is a full-set, non-paginated fetch, so sorting happens
// in-page; the server's chronological order stays until a header is used.
// Each filter chip renders a different header set, so each view carries its
// own accessors and the sort resets when the chip changes.

const LEDGER_TIEBREAKER = (a: LedgerEntry, b: LedgerEntry) => a.id - b.id;

const ALL_VIEW_ACCESSORS = {
  timestamp: (row: LedgerEntry) => row.timestamp,
  reference: (row: LedgerEntry) => row.receiptId ?? row.tripCode ?? row.note ?? null,
  txnType: (row: LedgerEntry) => (TXN_META[row.txnType] ?? DEFAULT_META).label,
  credit: (row: LedgerEntry) => parseFloat(row.credit) || 0,
  debit: (row: LedgerEntry) => parseFloat(row.debit) || 0,
  balance: (row: LedgerEntry) => parseFloat(row.balance) || 0,
  note: (row: LedgerEntry) => row.note || null,
} as const;

const FUEL_VIEW_ACCESSORS = {
  timestamp: (row: LedgerEntry) => row.fuelDetails?.departureDate ?? row.timestamp,
  truckPlate: (row: LedgerEntry) => row.fuelDetails?.truckPlate ?? null,
  routeName: (row: LedgerEntry) => row.fuelDetails?.routeName ?? null,
  liters: (row: LedgerEntry) => (row.fuelDetails?.liters != null ? Number(row.fuelDetails.liters) : null),
  unitPrice: (row: LedgerEntry) => (row.fuelDetails?.unitPrice != null ? Number(row.fuelDetails.unitPrice) : null),
  amount: (row: LedgerEntry) => Number(row.fuelDetails?.amount ?? row.credit) || null,
  balance: (row: LedgerEntry) => parseFloat(row.balance) || 0,
  reference: (row: LedgerEntry) => row.tripCode ?? row.note ?? null,
} as const;

const EXPENSE_VIEW_ACCESSORS = {
  timestamp: (row: LedgerEntry) => row.expenseDetails?.expenseDate ?? row.timestamp,
  vehiclePlate: (row: LedgerEntry) => row.expenseDetails?.vehiclePlate ?? null,
  categoryName: (row: LedgerEntry) => row.expenseDetails?.categoryName ?? null,
  reference: (row: LedgerEntry) => row.receiptId || row.note || row.expenseDetails?.categoryName || null,
  credit: (row: LedgerEntry) => parseFloat(row.credit) || 0,
  debit: (row: LedgerEntry) => parseFloat(row.debit) || 0,
  balance: (row: LedgerEntry) => parseFloat(row.balance) || 0,
  note: (row: LedgerEntry) => row.note || null,
} as const;

const FILTER_OPTIONS: { key: LedgerFilter; label: string }[] = [
  { key: 'all',                     label: 'Tất cả' },
  { key: TxnType.VENDOR_EXPENSE,    label: 'Ghi nhận chi phí' },
  { key: TxnType.VENDOR_PAYMENT,    label: 'Thanh toán công nợ' },
  { key: TxnType.FUEL_EXPENSE,      label: 'Chi phí nhiên liệu' },
  { key: TxnType.EXTERNAL_CARRIER_COST, label: 'Cước thuê ngoài' },
  { key: TxnType.ADJUSTMENT,        label: 'Điều chỉnh' },
];

export default function PayableDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isCompactLedger = useMediaQuery('(max-width: 1023px)');
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCarrierPayable = searchParams.get('kind') === 'carrier';
  const backPath = location.pathname.startsWith('/suppliers/') ? '/suppliers' : '/payables';
  const queryClient = useQueryClient();

  // ── Period filter (ledger section) ───────────────────────────────────────
  // Declared before useSupplierStatement because the resolved range feeds the
  // statement query. Defaults to current month.
  const [period, setPeriod] = useState(() => initialPeriodState());
  const [appliedPeriod, setAppliedPeriod] = useState(period);
  const appliedPeriodRange = useMemo(
    () => resolvePeriodRange(appliedPeriod),
    [appliedPeriod],
  );

  const {
    data: statement,
    isLoading: loading,
    isFetching: isStatementFetching,
    error: queryError,
  } = useSupplierStatement(
    id ? Number(id) : undefined,
    appliedPeriodRange,
    isCarrierPayable ? 'carrier' : 'vendor',
  );
  const typedStatement = statement as SupplierStatementType | undefined;
  const error = queryError ? (queryError as Error).message : null;
  const { toast: showToast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { rootRef } = usePageAnimations({ ready: !loading });

  const handleBack = () => navigate(backPath);
  useBackShortcut(handleBack);

  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [ledgerSort, setLedgerSort] = useState<TableSortState | null>(null);
  const handleLedgerSort = (key: string) => setLedgerSort(current => nextTableSort(current, key));
  // Header sets differ per chip view — dropping the sort on switch keeps the
  // active header and the visible column set in sync.
  const changeLedgerFilter = (filter: LedgerFilter) => {
    setLedgerFilter(filter);
    setLedgerSort(null);
  };
  const isPeriodDirty = period.mode !== appliedPeriod.mode
    || period.month !== appliedPeriod.month
    || period.year !== appliedPeriod.year
    || period.dateFrom !== appliedPeriod.dateFrom
    || period.dateTo !== appliedPeriod.dateTo;
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(exportMenuRef, () => setShowExportMenu(false), { escapeKey: true, enabled: showExportMenu });
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentReceiptId, setPaymentReceiptId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const downloadExport = async (format: string) => {
    setShowExportMenu(false);
    try {
      const blob = await api.getBlob(`${FINANCIAL.SUPPLIER_STATEMENT_EXPORT(Number(id))}?format=${format}`);
      const url = URL.createObjectURL(blob);
      if (format === 'pdf') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        const supplierName = typedStatement?.supplier.name || 'nha-cung-cap';
        const safeSupplierName = supplierName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
        a.download = `sao-ke-${safeSupplierName || 'nha-cung-cap'}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi xuất sao kê' });
    }
  };

  const agingAmounts = useMemo(() =>
    normalizeAging(typedStatement?.agingBuckets ?? []),
    [typedStatement?.agingBuckets]
  );

  const filteredRows = useMemo(() => {
    if (!typedStatement) return [];
    if (ledgerFilter === 'all') return typedStatement.ledgerRows;
    return typedStatement.ledgerRows.filter((r: LedgerEntry) => r.txnType === ledgerFilter);
  }, [typedStatement, ledgerFilter]);

  const ledgerAccessors = ledgerFilter === TxnType.FUEL_EXPENSE
    ? FUEL_VIEW_ACCESSORS
    : ledgerFilter === TxnType.VENDOR_EXPENSE
      ? EXPENSE_VIEW_ACCESSORS
      : ALL_VIEW_ACCESSORS;
  const sortedLedgerRows = useMemo(
    () => sortClientSide(filteredRows, ledgerSort, ledgerAccessors, LEDGER_TIEBREAKER),
    [filteredRows, ledgerSort, ledgerAccessors],
  );

  const activeAgingIdx = useMemo(() => activeAgingIndex(agingAmounts), [agingAmounts]);

  const totalOutstanding = typedStatement?.totalOutstanding ?? 0;

  async function handlePaymentSubmit(confirmOverpay = false) {
    if (!id || !paymentAmount) return;
    setSubmitting(true);
    try {
      const body: VendorPaymentRequest & { confirmOverpay?: boolean } = {
        supplierId: Number(id),
        amount: Number(paymentAmount),
        date: paymentDate,
        receiptId: paymentReceiptId,
        confirmOverpay,
      };
      // Backend returns `{ ...ledgerEntry, warning?, overpayment? }`. If the
      // payment exceeds outstanding debt, the backend throws a 422 unless confirmOverpay: true is sent.
      const resp = await api.post<{ warning?: string; overpayment?: number }>(
        isCarrierPayable ? FINANCIAL.PAYMENTS_CARRIER : FINANCIAL.PAYMENTS_VENDOR,
        body,
      );
      if (resp?.warning) {
        showToast({ kind: 'warning', message: resp.warning });
      } else {
        showToast({ kind: 'success', message: `Đã ghi thanh toán ${formatCurrency(body.amount)}` });
      }
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentReceiptId('');
      // Broad prefix — invalidates every supplier-statement query regardless
      // of period range, so the AP detail page's month/range-scoped statement
      // refetches alongside any other cached variant.
      queryClient.invalidateQueries({ queryKey: qk.financial.supplierStatementAll });
      queryClient.invalidateQueries({ queryKey: qk.financial.carrierPayableStatement(undefined) });
      queryClient.invalidateQueries({ queryKey: qk.financial.payablesSummaryAll });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422) {
        setSubmitting(false);
        const isConfirmed = await confirm(err.message, {
          confirmLabel: 'Xác nhận',
          cancelLabel: 'Hủy',
          variant: 'warning',
        });
        if (isConfirmed) {
          await handlePaymentSubmit(true);
        }
      } else {
        showToast({ kind: 'error', message: (err as Error).message || 'Lỗi ghi thanh toán' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !typedStatement) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>
        Đang tải dữ liệu...
      </div>
    );
  }

  if (!typedStatement) {
    return (
      <div className="debt-detail-page">
        <div className="dd-header">
          <button className="dd-back" aria-label="Quay lại" onClick={handleBack}>
            <ArrowLeft size={20} />
          </button>
          <div className="dd-meta">
            <h1 className="sr-only">Công nợ phải trả</h1>
          </div>
        </div>
        <div className="dd-summary">
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{error || 'Không tìm thấy dữ liệu'}</p>
        </div>
      </div>
    );
  }

  const { supplier, ledgerRows } = typedStatement;
  const hasDebt = totalOutstanding > 0;
  const lastLedgerRow = ledgerRows[0];
  const actualBalance = lastLedgerRow ? parseFloat(lastLedgerRow.balance) : 0;
  const hasCredit = actualBalance < 0;
  const overpaymentAmount = hasCredit ? Math.abs(actualBalance) : 0;
  const effectiveAging = totalOutstanding > 0 ? agingAmounts : [0, 0, 0, 0];
  const agingTotal = totalOutstanding || 1;

  return (
    <div ref={rootRef} className="debt-detail-page">
      {/* Supplier Header */}
      <div className="dd-header">
        <button className="dd-back" aria-label="Quay lại" onClick={handleBack}>
          <ArrowLeft size={20} />
        </button>
        <div className="dd-avatar" style={{ background: 'var(--warning)', color: 'var(--white, #fff)' }}>
          {supplier.name.charAt(0)}
        </div>
        <div className="dd-meta">
          <h1>{supplier.name}</h1>
          <div className="dd-sub">
            {supplier.phone && (
              <span>
                <Phone size={15} />
                <span className="dd-mono">{supplier.phone}</span>
              </span>
            )}
            {supplier.contactPerson && (
              <span>
                <Building2 size={15} />
                {supplier.contactPerson}
              </span>
            )}
            {hasDebt ? (
              <span className="dd-tag dd-tag--warn dd-tag--dot">Còn nợ</span>
            ) : hasCredit ? (
              <span className="dd-tag dd-tag--warn dd-tag--dot">Đã trả thừa {formatCurrency(overpaymentAmount).replace(' ₫', '')}đ</span>
            ) : (
              <span className="dd-tag dd-tag--ok dd-tag--dot">Đã thanh toán đủ</span>
            )}
          </div>
        </div>
        <div className="dd-actions">
          {!isCarrierPayable && (
            <div ref={exportMenuRef} style={{ position: 'relative' }}>
              <button
                className="btn btn--secondary"
                onClick={() => setShowExportMenu(v => !v)}
              >
                <Download size={14} />
                Xuất sao kê
              </button>
              {showExportMenu && (
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: 4,
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 8, boxShadow: 'var(--sh-lg)',
                  zIndex: 50, minWidth: 180, overflow: 'hidden',
                }}>
                  <button className="dd-export-btn" onClick={() => downloadExport('xlsx')}>
                    <FileSpreadsheet size={14} style={{ color: 'var(--success, #16a34a)' }} />
                    Excel (.xlsx)
                  </button>
                  <button className="dd-export-btn" onClick={() => downloadExport('pdf')}>
                    <FileText size={14} style={{ color: 'var(--danger, #dc2626)' }} />
                    PDF (In)
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            className="btn btn--primary"
            onClick={() => setShowPaymentModal(true)}
          >
            <CreditCard size={14} />
            Ghi thanh toán
          </button>
        </div>
      </div>

      {/* Summary Card */}
      <section className="dd-summary">
        <div className="dd-sum-top">
          <div>
            <div className="dd-sum-label">TỔNG CỘNG NỢ</div>
            <div className={`dd-sum-total ${hasDebt ? '' : ' dd-sum-total--clear'}`}>
              {hasDebt
                ? <>{formatCurrency(totalOutstanding).replace(' ₫', '')}<span className="dd-cur">đ</span></>
                : <>0<span className="dd-cur">đ</span></>
              }
            </div>
            {hasDebt && (
              <div className="dd-sum-note">
                <AlertTriangle size={17} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                {activeAgingIdx <= 0
                  ? 'Toàn bộ công nợ đang trong hạn 30 ngày.'
                  : `Có công nợ quá hạn ${AGING_RANGES[activeAgingIdx].label.toLowerCase()} — cần ưu tiên thanh toán.`
                }
              </div>
            )}
            {hasCredit && (
              <div className="dd-sum-note" style={{ marginTop: 4 }}>
                <AlertTriangle size={17} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                Đã trả thừa {formatCurrency(overpaymentAmount).replace(' ₫', '')}đ — nhà cung cấp đang nợ lại công ty
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
          {effectiveAging.map((amt, i) => {
            const pct = agingTotal > 0 ? (amt / agingTotal) * 100 : 0;
            return pct > 0
              ? <i key={i} className={`dd-seg-${i}`} style={{ width: `${pct}%` }} />
              : null;
          })}
        </div>

        {/* Aging grid */}
        <div className="dd-aging-grid">
          {AGING_RANGES.map((range, i) => {
            const amt = effectiveAging[i];
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

      {/* Ledger Card */}
      <section className="dd-ledger dd-ledger--standalone">
        <div className="dd-ledger-head">
          <div className="dd-ledger-heading">
            <h2>{isCarrierPayable ? 'Chi tiết cước vận chuyển thuê ngoài' : 'Chi tiết công nợ phải trả'}</h2>
            <p>{isCarrierPayable
              ? 'Cước theo chuyến và các khoản đã thanh toán cho nhà vận chuyển.'
              : 'Toàn bộ chi phí, khoản đã thanh toán và điều chỉnh với nhà cung cấp.'}</p>
          </div>
          <span className="dd-cnt">{filteredRows.length} giao dịch</span>
          <div className="dd-filters">
            {FILTER_OPTIONS.map(f => (
              <button
                key={f.key}
                className={`dd-filter-chip${ledgerFilter === f.key ? ' dd-filter-chip--on' : ''}`}
                onClick={() => changeLedgerFilter(f.key)}
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
          summary={typedStatement.periodSummary}
          isLoading={isStatementFetching}
          entityType="VENDOR"
        />

        {isCompactLedger ? (
          <ul className="dd-ledger-mobile d-list" aria-label="Danh sách giao dịch công nợ phải trả">
            {filteredRows.map((row: LedgerEntry) => (
              row.txnType === TxnType.FUEL_EXPENSE
                ? <FuelLedgerCard key={row.id} row={row} />
                : row.txnType === TxnType.VENDOR_EXPENSE
                  ? <ExpenseLedgerCard key={row.id} row={row} />
                  : <PayableLedgerCard key={row.id} row={row} />
            ))}
            {filteredRows.length === 0 && (
              <li className="dd-ledger-mobile-empty">Không có giao dịch</li>
            )}
          </ul>
        ) : (
          <div className="table-scroll">
            <table className="dd-table dd-detail-table">
              <thead>
                {ledgerFilter === TxnType.FUEL_EXPENSE ? (
                  <tr>
                    <SortHeader label="NGÀY" sortKey="timestamp" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="BIỂN SỐ XE" sortKey="truckPlate" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="TUYẾN VẬN CHUYỂN" sortKey="routeName" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="SỐ LÍT DẦU" sortKey="liters" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="ĐƠN GIÁ" sortKey="unitPrice" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="THÀNH TIỀN" sortKey="amount" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="SỐ DƯ" sortKey="balance" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="ĐỐI CHIẾU" sortKey="reference" sort={ledgerSort} onSortChange={handleLedgerSort} />
                  </tr>
                ) : ledgerFilter === TxnType.VENDOR_EXPENSE ? (
                  <tr>
                    <SortHeader label="NGÀY" sortKey="timestamp" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="BIỂN SỐ XE" sortKey="vehiclePlate" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="HẠNG MỤC" sortKey="categoryName" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="ĐỐI CHIẾU" sortKey="reference" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="PHÁT SINH PHẢI TRẢ" sortKey="credit" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="ĐÃ THANH TOÁN" sortKey="debit" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="SỐ DƯ" sortKey="balance" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="GHI CHÚ" sortKey="note" sort={ledgerSort} onSortChange={handleLedgerSort} />
                  </tr>
                ) : (
                  <tr>
                    <SortHeader label="NGÀY" sortKey="timestamp" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="ĐỐI CHIẾU" sortKey="reference" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="LOẠI GIAO DỊCH" sortKey="txnType" sort={ledgerSort} onSortChange={handleLedgerSort} />
                    <SortHeader label="PHÁT SINH PHẢI TRẢ" sortKey="credit" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="ĐÃ THANH TOÁN" sortKey="debit" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="SỐ DƯ" sortKey="balance" sort={ledgerSort} onSortChange={handleLedgerSort} className="dd-r" />
                    <SortHeader label="GHI CHÚ" sortKey="note" sort={ledgerSort} onSortChange={handleLedgerSort} />
                  </tr>
                )}
              </thead>
              <tbody>
                {sortedLedgerRows.map((row: LedgerEntry) => (
                  ledgerFilter === TxnType.FUEL_EXPENSE
                    ? <FuelLedgerRow key={row.id} row={row} />
                    : ledgerFilter === TxnType.VENDOR_EXPENSE
                      ? <ExpenseLedgerCard key={row.id} row={row} />
                      : <LedgerRow key={row.id} row={row} />
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={ledgerFilter === 'all' ? 7 : 8} className="dd-table-empty">
                      Không có giao dịch
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payment-statement builder (AP snapshot documents) */}
      {id && !isCarrierPayable && (
        <section className="dd-documents-section" aria-label="Chứng từ công nợ phải trả">
          <div className="dd-documents-section__head">
            <span className="dd-panel-eyebrow">Chứng từ công nợ</span>
            <h2>Bảng kê thanh toán</h2>
            <p>Tạo hoặc mở lại bảng kê khi cần gửi nhà cung cấp.</p>
          </div>
          <BillingDocumentsPanel
            type="PAYMENT_STATEMENT"
            entityType="VENDOR"
            entityId={Number(id)}
            entityName={typedStatement?.supplier.name ?? ''}
            buttonLabel="Tạo bảng kê"
          />
        </section>
      )}

      {/* Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        title="Ghi thanh toán"
        onClose={() => setShowPaymentModal(false)}
        onConfirm={() => handlePaymentSubmit(false)}
        maxWidth={440}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setShowPaymentModal(false)} disabled={submitting}>
              Hủy
            </button>
            <button
              className="btn btn--primary"
              onClick={() => handlePaymentSubmit(false)}
              disabled={submitting || !paymentAmount || !paymentDate || !paymentReceiptId.trim()}
            >
              {submitting ? 'Đang ghi…' : 'Xác nhận'}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="payment-amount">Số tiền (đ) *</label>
          <input
            id="payment-amount"
            type="number"
            className="input"
            value={paymentAmount}
            onChange={e => setPaymentAmount(e.target.value)}
            placeholder="Nhập số tiền"
          />
        </div>
        <div className="field">
          <label htmlFor="payment-date">Ngày *</label>
          <DateInput
            id="payment-date"
            className="input"
            value={paymentDate}
            onChange={setPaymentDate}
          />
        </div>
        <div className="field">
          <label htmlFor="payment-receipt-id">Mã biên lai *</label>
          <input
            id="payment-receipt-id"
            type="text"
            className="input"
            value={paymentReceiptId}
            onChange={e => setPaymentReceiptId(e.target.value)}
            placeholder="Ví dụ: PT-20260531-01"
          />
          <p style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', marginTop: 4 }}>
            Bắt buộc để đối chiếu sao kê ngân hàng / phiếu chi.
          </p>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}

