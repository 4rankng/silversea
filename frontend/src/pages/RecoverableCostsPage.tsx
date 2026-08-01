import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileCheck2, RotateCcw, TriangleAlert } from 'lucide-react';
import { PageHeader, Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination } from '../design-system';
import { formatCurrency, formatDate } from '../lib/format';
import { ApiError } from '../lib/api';
import { customerServiceFinanceClient, type RecoverableCost } from '../api/customerServiceFinanceClient';
import './WorkflowFinance.css';

const ELIGIBILITY_LABELS: Record<RecoverableCost['eligibility']['state'], string> = {
  READY_FOR_REVIEW: 'Chờ kiểm tra', ELIGIBLE: 'Có thể lập Giấy báo nợ', BLOCKED: 'Chưa đủ điều kiện',
  ALREADY_CLAIMED: 'Đã được ghi nhận', ADJUSTMENT_REQUIRED: 'Chỉ điều chỉnh',
};

export default function RecoverableCostsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: RecoverableCost[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoverableCost | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await customerServiceFinanceClient.listRecoverableCosts({ page, limit: 25, approvalStatus: status || undefined })); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Không thể tải chi phí thu hồi.'); }
    finally { setLoading(false); }
  }, [page, status]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!selected || !reason.trim()) return;
    setSaving(true);
    try {
      await customerServiceFinanceClient.requestRecoverableCost(selected.id, {
        decision, reason: reason.trim(), expectedVersion: selected.version,
        evidence: { reviewNote: reason.trim(), attachmentRefs: [] },
      }, crypto.randomUUID());
      setSelected(null); setReason(''); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Không thể gửi yêu cầu kiểm tra.'); }
    finally { setSaving(false); }
  };

  return <div className="workflow-page">
    <Breadcrumbs items={[{ label: 'Lô hàng', to: '/shipments' }, { label: 'Chi phí thu hồi' }]} />
    <PageHeader title="Chi phí thu hồi" iconName="expense" description="Kiểm tra tiền chi hộ, phí dịch vụ và chứng từ trước khi lập Giấy báo nợ." />
    <div className="workflow-toolbar">
      <label>Trạng thái<select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">Tất cả</option><option value="PENDING">Chờ kiểm tra</option><option value="APPROVED">Đã duyệt</option><option value="REJECTED">Đã từ chối</option>
      </select></label>
      <span aria-live="polite">{loading ? 'Đang tải…' : `${data?.total ?? 0} khoản chi phí`}</span>
    </div>
    {error && <div className="workflow-notice workflow-notice--error" role="alert">{error}<button className="btn btn--ghost" onClick={() => void load()}><RotateCcw size={16}/> Thử lại</button></div>}
    {!loading && !error && data?.items.length === 0 ? <EmptyState icon={FileCheck2} title="Không có chi phí phù hợp" description="Thay đổi bộ lọc hoặc kiểm tra lại phạm vi lô hàng được giao." /> :
      <div className="workflow-list" aria-busy={loading}>{data?.items.map((item) => <article className="workflow-row" key={item.id}>
        <div className="workflow-row__primary"><strong>{item.expenseTypeName ?? item.expenseType}</strong><span>{item.customerName} · {item.shipmentCode ?? item.tripCode ?? 'Chưa có mã chứng từ'}</span><small>{formatDate(item.expenseDate)}</small></div>
        <dl className="workflow-money"><div><dt>Chi hộ</dt><dd>{formatCurrency(item.recoverablePrincipalAmount)}</dd></div><div><dt>Phí dịch vụ</dt><dd>{formatCurrency(item.serviceFeeAmount)}</dd></div><div><dt>Thu khách</dt><dd>{formatCurrency(item.sellAmount)}</dd></div></dl>
        <div className="workflow-row__state"><span className={`workflow-pill workflow-pill--${item.eligibility.state.toLowerCase()}`}>{ELIGIBILITY_LABELS[item.eligibility.state]}</span>{item.eligibility.blockedReason && <small>{item.eligibility.blockedReason}</small>}</div>
        {item.eligibility.state === 'READY_FOR_REVIEW' && <button className="btn btn--primary" onClick={() => { setSelected(item); setDecision('APPROVED'); }}>Gửi kiểm tra</button>}
      </article>)}</div>}
    {(data?.total ?? 0) > 25 && <Pagination page={page} totalPages={Math.ceil((data?.total ?? 0) / 25)} totalItems={data?.total ?? 0} pageSize={25} onChange={setPage} />}
    <Modal isOpen={selected != null} title="Gửi yêu cầu kiểm tra chi phí" onClose={() => !saving && setSelected(null)} footer={<><button className="btn btn--ghost" onClick={() => setSelected(null)} disabled={saving}>Hủy</button><button className="btn btn--primary" onClick={() => void submit()} disabled={saving || !reason.trim()}>{saving ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></>}>
      <div className="workflow-form"><div className="workflow-choice"><button type="button" className={decision === 'APPROVED' ? 'is-active' : ''} onClick={() => setDecision('APPROVED')}><CheckCircle2 size={17}/> Đề nghị duyệt</button><button type="button" className={decision === 'REJECTED' ? 'is-active' : ''} onClick={() => setDecision('REJECTED')}><TriangleAlert size={17}/> Trả lại bổ sung</button></div><label htmlFor="recoverable-review-note">Nội dung kiểm tra<textarea id="recoverable-review-note" className="input" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required /></label><small>{reason.length}/1.000 ký tự</small></div>
    </Modal>
  </div>;
}
