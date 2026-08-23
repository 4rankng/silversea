import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileText,
  RefreshCw,
  Scale,
  TriangleAlert,
} from 'lucide-react';
import { Btn, Modal, StatusPill, type PillVariant } from '../../components/UI';
import { NativeSelect } from '../../components/untitled-ui/base/select/select-native';
import { RadioButton, RadioGroup } from '../../components/untitled-ui/base/radio-buttons/radio-buttons';
import { TextAreaBase } from '../../components/untitled-ui/base/textarea/textarea';
import { EmptyState, Pagination } from '../../design-system';
import { ApiError } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import {
  customerServiceFinanceClient,
  type RecoverableCost,
  type RecoverableEligibilityState,
} from '../../api/customerServiceFinanceClient';
import './RecoverableCostsWorkspace.css';
import './RecoverableCostsPagination.css';

const PAGE_SIZE = 25;

const ELIGIBILITY_LABELS: Record<RecoverableEligibilityState, string> = {
  READY_FOR_REVIEW: 'Chờ kiểm tra',
  ELIGIBLE: 'Đủ điều kiện lập Giấy báo nợ',
  BLOCKED: 'Chưa đủ điều kiện',
  ALREADY_CLAIMED: 'Đã ghi nhận vào Giấy báo nợ',
  ADJUSTMENT_REQUIRED: 'Cần lập điều chỉnh',
};

const APPROVAL_LABELS: Record<RecoverableCost['approvalStatus'], string> = {
  PENDING: 'Chờ kiểm tra',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
};

function eligibilityTone(state: RecoverableEligibilityState): PillVariant {
  if (state === 'ELIGIBLE' || state === 'ALREADY_CLAIMED') return 'success';
  if (state === 'BLOCKED') return 'danger';
  return 'warn';
}

function variance(item: RecoverableCost): number {
  return item.sellAmount - item.buyAmount;
}

function evidenceLabel(item: RecoverableCost): string {
  if (item.invoiceNumber) return `Hóa đơn ${item.invoiceNumber}`;
  if (item.noInvoiceEvidenceTypes.length > 0) {
    return `${item.noInvoiceEvidenceTypes.length} chứng từ thay thế`;
  }
  return 'Chưa có chứng từ';
}

function expenseLabel(item: RecoverableCost): string {
  return item.expenseTypeName?.trim()
    || OPS_EXPENSE_TYPE_DEFAULTS[item.expenseType]?.name
    || 'Khoản chi khác';
}

function Money({ value, tone }: { value: number | null; tone?: 'positive' | 'negative' }) {
  return <span className={`recoverable-costs__money${tone ? ` is-${tone}` : ''}`}>{formatCurrency(value)}</span>;
}

function Eligibility({ item }: { item: RecoverableCost }) {
  return (
    <div className="recoverable-costs__eligibility">
      <StatusPill variant={eligibilityTone(item.eligibility.state)}>
        {ELIGIBILITY_LABELS[item.eligibility.state]}
      </StatusPill>
      {item.eligibility.blockedReason && <small>{item.eligibility.blockedReason}</small>}
    </div>
  );
}

function Evidence({ item }: { item: RecoverableCost }) {
  return (
    <div className="recoverable-costs__evidence">
      <FileText size={15} aria-hidden="true" />
      <span>{evidenceLabel(item)}</span>
      {item.invoiceDate && <small>{formatDate(item.invoiceDate)}</small>}
    </div>
  );
}

interface ReviewActionProps {
  item: RecoverableCost;
  onReview: (item: RecoverableCost) => void;
}

function ReviewAction({ item, onReview }: ReviewActionProps) {
  if (item.eligibility.state !== 'READY_FOR_REVIEW') {
    return <span className="recoverable-costs__no-action">Không cần thao tác</span>;
  }
  return <Btn variant="primary" size="sm" onClick={() => onReview(item)}>Kiểm tra</Btn>;
}

function DesktopLedger({ items, onReview, footer }: { items: RecoverableCost[]; onReview: ReviewActionProps['onReview']; footer?: ReactNode }) {
  return (
    <div className="recoverable-costs__ledger" data-testid="recoverable-cost-ledger">
      <table>
        <thead>
          <tr className="recoverable-costs__group-head">
            <th colSpan={4}>Lô hàng và chi phí</th>
            <th colSpan={5}>Đối soát thu hồi</th>
            <th>Chứng từ</th>
            <th colSpan={2}>Kiểm tra</th>
          </tr>
          <tr>
            <th>Khách hàng</th>
            <th>Lô hàng</th>
            <th>Chuyến</th>
            <th>Khoản chi</th>
            <th className="num">Chi thực tế</th>
            <th className="num">Chi hộ</th>
            <th className="num">Phí dịch vụ</th>
            <th className="num">Thu khách</th>
            <th className="num">Chênh lệch thu/chi</th>
            <th>Hóa đơn / chứng từ</th>
            <th>Trạng thái</th>
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const difference = variance(item);
            return (
              <tr key={item.id}>
                <td className="recoverable-costs__customer"><strong>{item.customerName}</strong></td>
                <td><strong>{item.shipmentCode ?? 'Chưa có mã lô'}</strong></td>
                <td>{item.tripCode ?? 'Chưa có mã chuyến'}</td>
                <td>
                  <div className="recoverable-costs__expense">
                    <strong>{expenseLabel(item)}</strong>
                    <small>{formatDate(item.expenseDate)} · {APPROVAL_LABELS[item.approvalStatus]}</small>
                  </div>
                </td>
                <td className="num"><Money value={item.buyAmount} /></td>
                <td className="num"><Money value={item.recoverablePrincipalAmount} /></td>
                <td className="num"><Money value={item.serviceFeeAmount} /></td>
                <td className="num"><Money value={item.sellAmount} /></td>
                <td className="num"><Money value={difference} tone={difference < 0 ? 'negative' : 'positive'} /></td>
                <td><Evidence item={item} /></td>
                <td><Eligibility item={item} /></td>
                <td className="recoverable-costs__action"><ReviewAction item={item} onReview={onReview} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

function MobileRecords({ items, onReview, footer }: { items: RecoverableCost[]; onReview: ReviewActionProps['onReview']; footer?: ReactNode }) {
  return (
    <div className="recoverable-costs__records" data-testid="recoverable-cost-records">
      {items.map((item) => {
        const difference = variance(item);
        return (
          <article className="recoverable-costs__record" key={item.id}>
            <header>
              <div>
                <p>{item.customerName}</p>
                <h2>{item.shipmentCode ?? item.tripCode ?? 'Chưa có mã lô hàng'}</h2>
                <span>{item.tripCode && item.shipmentCode ? item.tripCode : expenseLabel(item)}</span>
              </div>
              <Eligibility item={item} />
            </header>
            <div className="recoverable-costs__record-context">
              <strong>{expenseLabel(item)}</strong>
              <span>{formatDate(item.expenseDate)} · {APPROVAL_LABELS[item.approvalStatus]}</span>
              <Evidence item={item} />
            </div>
            <dl>
              <div><dt>Chi thực tế</dt><dd><Money value={item.buyAmount} /></dd></div>
              <div><dt>Chi hộ</dt><dd><Money value={item.recoverablePrincipalAmount} /></dd></div>
              <div><dt>Phí dịch vụ</dt><dd><Money value={item.serviceFeeAmount} /></dd></div>
              <div><dt>Thu khách</dt><dd><Money value={item.sellAmount} /></dd></div>
              <div className="recoverable-costs__record-variance"><dt>Chênh lệch thu/chi</dt><dd><Money value={difference} tone={difference < 0 ? 'negative' : 'positive'} /></dd></div>
            </dl>
            <ReviewAction item={item} onReview={onReview} />
          </article>
        );
      })}
      {footer}
    </div>
  );
}

export function RecoverableCostsWorkspace() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: RecoverableCost[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoverableCost | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await customerServiceFinanceClient.listRecoverableCosts({
        page,
        limit: PAGE_SIZE,
        approvalStatus: status || undefined,
      }));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : 'Không thể tải danh sách chi phí cần kiểm tra.');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  const pageTotals = useMemo(() => (data?.items ?? []).reduce((totals, item) => ({
    buy: totals.buy + item.buyAmount,
    sell: totals.sell + item.sellAmount,
    variance: totals.variance + variance(item),
  }), { buy: 0, sell: 0, variance: 0 }), [data?.items]);

  const pagination = data && data.total > PAGE_SIZE ? (
    <Pagination
      page={page}
      totalPages={Math.ceil(data.total / PAGE_SIZE)}
      totalItems={data.total}
      pageSize={PAGE_SIZE}
      onChange={setPage}
    />
  ) : null;

  const openReview = (item: RecoverableCost) => {
    setSelected(item);
    setDecision('APPROVED');
    setReason('');
    setReviewError(null);
  };

  const closeReview = () => {
    if (!saving) {
      setSelected(null);
      setReviewError(null);
    }
  };

  const submit = async () => {
    if (!selected || !reason.trim() || saving) return;
    setSaving(true);
    setReviewError(null);
    try {
      await customerServiceFinanceClient.requestRecoverableCost(selected.id, {
        decision,
        reason: reason.trim(),
        expectedVersion: selected.version,
        evidence: { reviewNote: reason.trim(), attachmentRefs: [] },
      }, crypto.randomUUID());
      setSelected(null);
      setReason('');
      await load();
    } catch (submitError) {
      setReviewError(submitError instanceof ApiError ? submitError.message : 'Không thể gửi yêu cầu kiểm tra. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="recoverable-costs" aria-labelledby="recoverable-costs-title">
      <header className="recoverable-costs__header">
        <div>
          <p className="recoverable-costs__eyebrow">Đối soát chi phí lô hàng</p>
          <h1 id="recoverable-costs-title">Chi phí cần kiểm tra</h1>
          <p>Kiểm tra tiền chi hộ, phí dịch vụ và chứng từ trước khi lập Giấy báo nợ.</p>
        </div>
        <Btn
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Đang tải' : 'Tải lại'}
        </Btn>
      </header>

      <section className="recoverable-costs__summary" aria-label="Tổng hợp trang hiện tại">
        <div><span>Khoản phù hợp</span><strong>{data?.total ?? 0}</strong><small>Theo bộ lọc hiện tại</small></div>
        <div><span>Chi thực tế</span><strong>{formatCurrency(pageTotals.buy)}</strong><small>Trang hiện tại</small></div>
        <div><span>Thu khách</span><strong>{formatCurrency(pageTotals.sell)}</strong><small>Trang hiện tại</small></div>
        <div className={pageTotals.variance < 0 ? 'is-negative' : 'is-positive'}>
          <span>Chênh lệch thu/chi</span><strong>{formatCurrency(pageTotals.variance)}</strong><small>Trang hiện tại</small>
        </div>
      </section>

      <section className="recoverable-costs__toolbar" aria-label="Bộ lọc chi phí">
        <NativeSelect
          label="Trạng thái phê duyệt"
          size="sm"
          value={status}
          options={[
            { value: '', label: 'Tất cả trạng thái' },
            { value: 'PENDING', label: 'Chờ kiểm tra' },
            { value: 'APPROVED', label: 'Đã duyệt' },
            { value: 'REJECTED', label: 'Đã từ chối' },
          ]}
          onChange={(event) => { setStatus(event.target.value); setPage(1); }}
        />
        <div className="recoverable-costs__toolbar-meta" aria-live="polite">
          <Scale size={17} aria-hidden="true" />
          <span>{loading ? 'Đang cập nhật dữ liệu…' : `${data?.total ?? 0} khoản chi phí`}</span>
        </div>
      </section>

      {error && (
        <div className="recoverable-costs__notice" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          <Btn variant="ghost" size="sm" onClick={() => void load()}>Thử lại</Btn>
        </div>
      )}

      {loading && !data ? (
        <div className="recoverable-costs__loading" role="status" aria-live="polite">
          <RefreshCw size={18} className="spin" aria-hidden="true" />
          <span>Đang tải danh sách chi phí cần kiểm tra…</span>
        </div>
      ) : !error && data?.items.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="Không có chi phí phù hợp"
          description={status ? 'Xóa hoặc thay đổi bộ lọc để xem các khoản chi phí khác.' : 'Các khoản chi phí cần kiểm tra sẽ xuất hiện tại đây.'}
        />
      ) : data && data.items.length > 0 ? (
        <section className="recoverable-costs__workspace" aria-busy={loading}>
          <MobileRecords items={data.items} onReview={openReview} footer={pagination} />
          <DesktopLedger items={data.items} onReview={openReview} footer={pagination} />
        </section>
      ) : null}

      <Modal
        isOpen={selected != null}
        title="Gửi yêu cầu kiểm tra chi phí"
        onClose={closeReview}
        maxWidth={620}
        footer={(
          <>
            <Btn variant="secondary" onClick={closeReview} disabled={saving}>Hủy</Btn>
            <Btn variant="primary" onClick={() => void submit()} disabled={saving || !reason.trim()}>
              {saving ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </Btn>
          </>
        )}
      >
        {selected && (
          <div className="recoverable-costs__review-form">
            <div className="recoverable-costs__review-record">
              <div><span>Khách hàng</span><strong>{selected.customerName}</strong></div>
              <div><span>Lô hàng</span><strong>{selected.shipmentCode ?? selected.tripCode ?? 'Chưa có mã'}</strong></div>
              <div><span>Thu khách</span><strong>{formatCurrency(selected.sellAmount)}</strong></div>
            </div>
            <RadioGroup
              aria-label="Kết quả đề nghị"
              value={decision}
              onChange={(value) => setDecision(value as 'APPROVED' | 'REJECTED')}
              className="recoverable-costs__decision-group"
            >
              <RadioButton value="APPROVED" size="md" label="Đề nghị duyệt" hint="Khoản chi đủ căn cứ để tiếp tục xử lý." />
              <RadioButton value="REJECTED" size="md" label="Trả lại bổ sung" hint="Cần bổ sung hoặc sửa thông tin trước khi duyệt." />
            </RadioGroup>
            <div className="recoverable-costs__reason-field">
              <label htmlFor="recoverable-review-note">Nội dung kiểm tra <span aria-hidden="true">*</span></label>
              <TextAreaBase
                id="recoverable-review-note"
                aria-label="Nội dung kiểm tra"
                rows={4}
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={saving}
                required
              />
              <small>{reason.length.toLocaleString('vi-VN')}/1.000 ký tự</small>
            </div>
            <div className="recoverable-costs__review-note">
              {decision === 'APPROVED' ? <CheckCircle2 size={17} aria-hidden="true" /> : <TriangleAlert size={17} aria-hidden="true" />}
              <span>Yêu cầu sẽ được ghi nhận theo đúng luồng phê duyệt và phiên bản hiện tại của khoản chi.</span>
            </div>
            {reviewError && (
              <div className="recoverable-costs__notice recoverable-costs__review-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{reviewError}</span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
