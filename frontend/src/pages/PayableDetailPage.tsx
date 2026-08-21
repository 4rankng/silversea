import { useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DateInput } from '../design-system/forms/DateInput';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';
import { TxnType, FINANCIAL } from '@tingting/shared';
import type { SupplierStatement as SupplierStatementType, LedgerEntry, AgingBucket, VendorPaymentRequest } from '@tingting/shared';
import { AlertTriangle, Phone, Building2, ArrowLeft, CreditCard, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useSupplierStatement } from '../hooks/useQueries';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/shared/Toast';
import { useConfirm, Modal } from '../components/UI';
import BillingDocumentsPanel from '../components/billing/BillingDocumentsPanel';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { qk } from '../api/keys';
import { useClickOutside } from '../hooks/useClickOutside';
import { PeriodFilter, resolvePeriodRange, initialPeriodState, applyModeSwitch } from '../components/debt/PeriodFilter';
import { PeriodSummaryCards } from '../components/debt/PeriodSummaryCards';
import { useMediaQuery } from '../hooks/useMediaQuery';
import './DebtDetailPage.css';

const TXN_META: Record<string, { label: string; pill: string }> = {
  [TxnType.VENDOR_EXPENSE]:  { label: 'Ghi nhận chi phí',   pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.VENDOR_PAYMENT]:  { label: 'Thanh toán công nợ',  pill: 'dd-txn-pill dd-txn-pill--pay' },
  [TxnType.ADJUSTMENT]:      { label: 'Điều chỉnh',      pill: 'dd-txn-pill dd-txn-pill--adj' },
  [TxnType.FUEL_EXPENSE]:    { label: 'Chi phí nhiên liệu',  pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.EXTERNAL_CARRIER_COST]: { label: 'Cước thuê ngoài', pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.UNLOCK_REVERSAL]: { label: 'Hoàn tác',         pill: 'dd-txn-pill dd-txn-pill--adj' },
};
const DEFAULT_META = { label: 'KHÁC', pill: 'dd-txn-pill dd-txn-pill--other' };

const AGING_RANGES = [
  { label: '0–30 NGÀY',    dotColor: 'var(--accent)',  index: 0 },
  { label: '31–60 NGÀY',   dotColor: 'var(--warning)', index: 1 },
  { label: '61–90 NGÀY',   dotColor: '#D97706',        index: 2 },
  { label: 'TRÊN 90 NGÀY', dotColor: 'var(--danger)',  index: 3 },
] as const;

type LedgerFilter = 'all' | typeof TxnType.VENDOR_EXPENSE | typeof TxnType.VENDOR_PAYMENT | typeof TxnType.ADJUSTMENT | typeof TxnType.FUEL_EXPENSE | typeof TxnType.EXTERNAL_CARRIER_COST;

const FILTER_OPTIONS: { key: LedgerFilter; label: string }[] = [
  { key: 'all',                     label: 'Tất cả' },
  { key: TxnType.VENDOR_EXPENSE,    label: 'Ghi nhận chi phí' },
  { key: TxnType.VENDOR_PAYMENT,    label: 'Thanh toán công nợ' },
  { key: TxnType.FUEL_EXPENSE,      label: 'Chi phí nhiên liệu' },
  { key: TxnType.EXTERNAL_CARRIER_COST, label: 'Cước thuê ngoài' },
  { key: TxnType.ADJUSTMENT,        label: 'Điều chỉnh' },
];

function normalizeAging(buckets: AgingBucket[]): number[] {
  const amounts = [0, 0, 0, 0];
  buckets.forEach((b, i) => {
    if (i < 4) amounts[i] = b.amount;
  });
  return amounts;
}

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

  const activeAgingIdx = useMemo(() => {
    let max = -1, idx = 0;
    agingAmounts.forEach((a, i) => { if (a > max) { max = a; idx = i; } });
    return max > 0 ? idx : -1;
  }, [agingAmounts]);

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
            <h1>Công nợ phải trả</h1>
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
        <div className="dd-avatar" style={{ background: 'var(--warning)', color: '#fff' }}>
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
                    <FileSpreadsheet size={14} style={{ color: '#16a34a' }} />
                    Excel (.xlsx)
                  </button>
                  <button className="dd-export-btn" onClick={() => downloadExport('pdf')}>
                    <FileText size={14} style={{ color: '#dc2626' }} />
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
                    <th>NGÀY</th>
                    <th>BIỂN SỐ XE</th>
                    <th>TUYẾN VẬN CHUYỂN</th>
                    <th className="dd-r">SỐ LÍT DẦU</th>
                    <th className="dd-r">ĐƠN GIÁ</th>
                    <th className="dd-r">THÀNH TIỀN</th>
                    <th className="dd-r">SỐ DƯ</th>
                    <th>ĐỐI CHIẾU</th>
                  </tr>
                ) : ledgerFilter === TxnType.VENDOR_EXPENSE ? (
                  <tr>
                    <th>NGÀY</th>
                    <th>BIỂN SỐ XE</th>
                    <th>HẠNG MỤC</th>
                    <th>ĐỐI CHIẾU</th>
                    <th className="dd-r">PHÁT SINH PHẢI TRẢ</th>
                    <th className="dd-r">ĐÃ THANH TOÁN</th>
                    <th className="dd-r">SỐ DƯ</th>
                    <th>GHI CHÚ</th>
                  </tr>
                ) : (
                  <tr>
                    <th>NGÀY</th>
                    <th>ĐỐI CHIẾU</th>
                    <th>LOẠI GIAO DỊCH</th>
                    <th className="dd-r">PHÁT SINH PHẢI TRẢ</th>
                    <th className="dd-r">ĐÃ THANH TOÁN</th>
                    <th className="dd-r">SỐ DƯ</th>
                    <th>GHI CHÚ</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {filteredRows.map((row: LedgerEntry) => (
                  ledgerFilter === TxnType.FUEL_EXPENSE
                    ? <FuelLedgerRow key={row.id} row={row} />
                    : ledgerFilter === TxnType.VENDOR_EXPENSE
                      ? <ExpenseLedgerRow key={row.id} row={row} />
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

function LedgerRow({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const meta = TXN_META[row.txnType] ?? DEFAULT_META;
  const reference = row.receiptId
    || (row.txnType === TxnType.FUEL_EXPENSE ? row.tripCode || 'Chuyến chưa có mã' : null)
    || row.note
    || meta.label;

  return (
    <tr>
      <td className="dd-td-date">{formatDate(row.timestamp)}</td>
      <td className="dd-reference">
        <strong>{reference}</strong>
        {row.expenseDetails?.vehiclePlate && <small>{row.expenseDetails.vehiclePlate}</small>}
      </td>
      <td><span className={meta.pill}>{meta.label}</span></td>
      <td className={`dd-num ${credit > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {credit > 0 ? formatCurrency(credit).replace(' ₫', '') + 'đ' : '–'}
      </td>
      <td className={`dd-num ${debit > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {debit > 0 ? formatCurrency(debit).replace(' ₫', '') + 'đ' : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance)).replace(' ₫', '')}đ
      </td>
      <td className="dd-td-note">{row.note || ''}</td>
    </tr>
  );
}

export function FuelLedgerRow({ row }: { row: LedgerEntry }) {
  const detail = row.fuelDetails;
  const balance = parseFloat(row.balance) || 0;
  const amount = Number(detail?.amount ?? row.credit) || 0;
  const reference = row.tripCode || row.note || 'Chuyến chưa có mã';

  return (
    <tr className="dd-fuel-row">
      <td className="dd-td-date">{formatDate(detail?.departureDate ?? row.timestamp)}</td>
      <td className="dd-fuel-vehicle">{detail?.truckPlate || '—'}</td>
      <td className="dd-fuel-route">{detail?.routeName || '—'}</td>
      <td className="dd-num">{detail?.liters ? `${formatNumber(Number(detail.liters))} lít` : '—'}</td>
      <td className="dd-num">{detail?.unitPrice ? formatCurrency(Number(detail.unitPrice)) : '—'}</td>
      <td className="dd-num dd-num--debit">{formatCurrency(amount)}</td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance))}
      </td>
      <td className="dd-reference">
        <strong>{reference}</strong>
        {row.note && row.note !== reference && <small>{row.note}</small>}
      </td>
    </tr>
  );
}

export function ExpenseLedgerRow({ row }: { row: LedgerEntry }) {
  const detail = row.expenseDetails;
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const reference = row.receiptId || row.note || detail?.categoryName || 'Chi phí nhà cung cấp';

  return (
    <tr className="dd-expense-row">
      <td className="dd-td-date">{formatDate(detail?.expenseDate ?? row.timestamp)}</td>
      <td className="dd-expense-vehicle">{detail?.vehiclePlate || '—'}</td>
      <td className="dd-expense-category">{detail?.categoryName || 'Ghi nhận chi phí'}</td>
      <td className="dd-reference"><strong>{reference}</strong></td>
      <td className={`dd-num ${credit > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {credit > 0 ? formatCurrency(credit) : '–'}
      </td>
      <td className={`dd-num ${debit > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {debit > 0 ? formatCurrency(debit) : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance))}
      </td>
      <td className="dd-td-note">{row.note || ''}</td>
    </tr>
  );
}

export function PayableLedgerCard({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const meta = TXN_META[row.txnType] ?? DEFAULT_META;
  const reference = row.receiptId
    || (row.txnType === TxnType.FUEL_EXPENSE ? row.tripCode || 'Chuyến chưa có mã' : null)
    || row.note
    || meta.label;

  return (
    <li className="dd-ledger-mobile-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={row.timestamp}>{formatDate(row.timestamp)}</time>
        <span className={meta.pill}>{meta.label}</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{reference}</strong>
        {row.note && row.note !== reference && <p>{row.note}</p>}
      </div>
      <dl className="dd-ledger-mobile-card__amounts">
        <div>
          <dt>Phải trả</dt>
          <dd>{credit > 0 ? formatCurrency(credit).replace(' ₫', '') + 'đ' : '–'}</dd>
        </div>
        <div>
          <dt>Đã trả</dt>
          <dd className={debit > 0 ? 'text-success' : ''}>{debit > 0 ? formatCurrency(debit).replace(' ₫', '') + 'đ' : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd className={balance > 0 ? 'text-error' : balance < 0 ? 'text-success' : ''}>
            {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance)).replace(' ₫', '')}đ
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function FuelLedgerCard({ row }: { row: LedgerEntry }) {
  const detail = row.fuelDetails;
  const amount = Number(detail?.amount ?? row.credit) || 0;
  const reference = row.tripCode || row.note || 'Chuyến chưa có mã';

  return (
    <li className="dd-ledger-mobile-card dd-fuel-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={detail?.departureDate ?? row.timestamp}>
          {formatDate(detail?.departureDate ?? row.timestamp)}
        </time>
        <span className={TXN_META[TxnType.FUEL_EXPENSE].pill}>Chi phí nhiên liệu</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{detail?.truckPlate || 'Chưa có biển số xe'}</strong>
        <p>{detail?.routeName || 'Chưa có tuyến vận chuyển'}</p>
        <small>{reference}</small>
      </div>
      <dl className="dd-ledger-mobile-card__amounts dd-fuel-card__amounts">
        <div>
          <dt>Số lít dầu</dt>
          <dd>{detail?.liters ? `${formatNumber(Number(detail.liters))} lít` : '—'}</dd>
        </div>
        <div>
          <dt>Đơn giá</dt>
          <dd>{detail?.unitPrice ? formatCurrency(Number(detail.unitPrice)) : '—'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Thành tiền</dt>
          <dd>{formatCurrency(amount)}</dd>
        </div>
      </dl>
    </li>
  );
}

export function ExpenseLedgerCard({ row }: { row: LedgerEntry }) {
  const detail = row.expenseDetails;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const reference = row.receiptId || row.note || detail?.categoryName || 'Chi phí nhà cung cấp';

  return (
    <li className="dd-ledger-mobile-card dd-expense-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={detail?.expenseDate ?? row.timestamp}>
          {formatDate(detail?.expenseDate ?? row.timestamp)}
        </time>
        <span className={TXN_META[TxnType.VENDOR_EXPENSE].pill}>Ghi nhận chi phí</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{detail?.vehiclePlate || 'Chưa gắn biển số xe'}</strong>
        <p>{detail?.categoryName || reference}</p>
        {reference !== detail?.categoryName && <small>{reference}</small>}
      </div>
      <dl className="dd-ledger-mobile-card__amounts dd-expense-card__amounts">
        <div>
          <dt>Phải trả</dt>
          <dd>{credit > 0 ? formatCurrency(credit) : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd>{balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance))}</dd>
        </div>
      </dl>
    </li>
  );
}
