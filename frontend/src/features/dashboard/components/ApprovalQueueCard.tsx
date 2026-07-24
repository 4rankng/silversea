import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavigateFunction } from 'react-router-dom';
import { Receipt, Wallet, CheckCircle2, FileCheck2, ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';
import { forwarderClient } from '../../../api/forwarderClient';
import type { ApprovalItemType, ApprovalQueueItem, ApprovalQueueResponse } from '../hooks/useApprovalQueue';
import { qk } from '../../../api/keys';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';
import { StatusStrip } from '../../../components/shared/StatusStrip';

const TYPE_LABEL: Partial<Record<ApprovalItemType, string>> = {
  ancillaryFees: 'Phí phụ trợ',
  advances: 'Tạm ứng',
  advanceSettlementsCheck: 'Phiếu thanh toán — kiểm tra',
  advanceSettlementsApprove: 'Phiếu thanh toán — duyệt',
};

const TYPE_ICON: Partial<Record<ApprovalItemType, React.ReactNode>> = {
  ancillaryFees: <Receipt size={14} strokeWidth={2.2} />,
  advances: <Wallet size={14} strokeWidth={2.2} />,
  advanceSettlementsCheck: <FileCheck2 size={14} strokeWidth={2.2} />,
  advanceSettlementsApprove: <CheckCircle2 size={14} strokeWidth={2.2} />,
};

const TYPE_ICON_CLASS: Partial<Record<ApprovalItemType, string>> = {
  ancillaryFees: 'approval-queue__ic--amber',
  advances: 'approval-queue__ic--green',
  advanceSettlementsCheck: 'approval-queue__ic--blue',
  advanceSettlementsApprove: 'approval-queue__ic--green',
};

const fmtVN = (n: number) => Math.round(n).toLocaleString('vi-VN');

const GROUP_ORDER: ApprovalItemType[] = [
  'ancillaryFees',
  'advances',
  'advanceSettlementsCheck',
  'advanceSettlementsApprove',
];
const PAGE_SIZE = 15;

// Tooltip text per type — explains what the tick button does.
const QUICK_ACTION_LABEL: Partial<Record<ApprovalItemType, string>> = {
  ancillaryFees: 'Duyệt phụ phí',
  advances: 'Duyệt tạm ứng',
  advanceSettlementsCheck: 'Kiểm tra phiếu',
  advanceSettlementsApprove: 'Duyệt phiếu thanh toán',
};

interface Props {
  data: ApprovalQueueResponse | undefined;
  loading: boolean;
  navigate: NavigateFunction;
}

export function ApprovalQueueCard({ data, loading, navigate }: Props) {
  const [page, setPage] = useState(0);
  const items = useMemo(
    () => (data?.items ?? []).filter(item => item.type !== 'debtOffsets'),
    [data?.items],
  );
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const visibleItems = useMemo(
    () => items.slice(pageStart, pageStart + PAGE_SIZE),
    [items, pageStart],
  );
  const groupedView = visibleItems.length > 5;
  const canPage = total > PAGE_SIZE;

  // Single-pass groupBy instead of O(n*k) filter per type
  const grouped = useMemo(() => {
    const map = new Map<ApprovalItemType, ApprovalQueueItem[]>();
    for (const item of visibleItems) {
      const group = map.get(item.type) ?? [];
      group.push(item);
      map.set(item.type, group);
    }
    return map;
  }, [visibleItems]);

  const handlePrevPage = () => setPage(value => Math.max(0, value - 1));
  const handleNextPage = () => setPage(value => Math.min(pageCount - 1, value + 1));

  return (
    <div className="d-card d-card-border bg-base-100 wf-card approval-queue">
      <div className="wf-card-h">
        <div>
          <h2 className="ttl">Cần duyệt</h2>
          <div className="sub">
            {loading ? 'Đang tải…' : total > 0 ? `${total} mục đang chờ` : 'Đã xử lý hết'}
          </div>
        </div>
        {total > 0 && (
          <div className="approval-queue__head-actions">
            {canPage && (
              <div className="approval-queue__pager" aria-label="Phân trang cần duyệt">
                <button
                  type="button"
                  className="d-btn d-btn-square d-btn-sm approval-queue__page-btn"
                  onClick={handlePrevPage}
                  disabled={currentPage === 0}
                  aria-label="Trang trước"
                  title="Trang trước"
                >
                  <ChevronLeft size={15} strokeWidth={2.3} />
                </button>
                <span className="approval-queue__page-label">
                  {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, total)} / {total}
                </span>
                <button
                  type="button"
                  className="d-btn d-btn-square d-btn-sm approval-queue__page-btn"
                  onClick={handleNextPage}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="Trang sau"
                  title="Trang sau"
                >
                  <ChevronRight size={15} strokeWidth={2.3} />
                </button>
              </div>
            )}
            <span className="d-badge d-badge-success d-badge-soft approval-queue__count">{total}</span>
          </div>
        )}
      </div>

      {total === 0 ? (
        <div className="approval-queue__empty">
          <img
            src={resolveEmptyIllustration('empty-audit')}
            alt=""
            className="approval-queue__empty-art"
            aria-hidden
          />
          <div className="approval-queue__empty-title">Không có gì cần duyệt</div>
          <div className="approval-queue__empty-sub">Bạn đã xử lý hết.</div>
        </div>
      ) : groupedView ? (
        <div className="approval-queue__body">
          {GROUP_ORDER.map(type => {
            const rows = grouped.get(type);
            if (!rows || rows.length === 0) return null;
            return (
              <React.Fragment key={type}>
                <div className="approval-queue__group-head">{TYPE_LABEL[type]}</div>
                {rows.map(item => (
                  <Row key={item.id} item={item} navigate={navigate} showTypeLabel={false} />
                ))}
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        <div className="approval-queue__body">
          {visibleItems.map(item => (
            <Row key={item.id} item={item} navigate={navigate} showTypeLabel />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  navigate,
  showTypeLabel,
}: {
  item: ApprovalQueueItem;
  navigate: NavigateFunction;
  showTypeLabel: boolean;
}) {
  const queryClient = useQueryClient();
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRowClick = () => {
    if (!approving) navigate(item.href);
  };

  const handleRowKey = (e: React.KeyboardEvent) => {
    if (approving) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(item.href);
    }
  };

  // Only advance requests retain quick approval. Settlements must be opened so
  // the accountant reviews container completion and any corrections first.
  const handleQuickApprove = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();   // don't trigger row navigation
    e.preventDefault();
    if (approving) return;

    const [, numericIdStr] = item.id.split(':');
    const numericId = Number(numericIdStr);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      setError('ID không hợp lệ');
      return;
    }

    setApproving(true);
    setError(null);
    try {
      if (item.type !== 'advances') throw new Error('Cần mở chi tiết để duyệt');
      await forwarderClient.approveAdvanceRequest(numericId);
      // Refresh the queue so the approved item disappears / moves.
      await queryClient.invalidateQueries({ queryKey: qk.dashboard.approvalQueue(undefined, undefined) });
      // Also refresh the underlying data sources that the approve just changed.
      queryClient.invalidateQueries({ queryKey: qk.forwarder.forwarderAdvanceRequestsAll });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi duyệt');
    } finally {
      setApproving(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`approval-queue__row${item.severity === 'urgent' ? ' is-urgent' : ''}${approving ? ' is-approving' : ''}`}
      onClick={handleRowClick}
      onKeyDown={handleRowKey}
      aria-label={item.title}
    >
      {item.severity === 'urgent' ? <StatusStrip color="var(--wf-red)" /> : null}
      <span className={`approval-queue__ic ${TYPE_ICON_CLASS[item.type]}`}>
        {TYPE_ICON[item.type]}
      </span>
      <span className="approval-queue__tx">
        <span className="approval-queue__t" title={item.title}>{item.title}</span>
        <span className="approval-queue__s">
          {showTypeLabel && <span className="approval-queue__tag">{TYPE_LABEL[item.type]}</span>}
          <span>{item.subtitle}</span>
        </span>
      </span>
      <span className="approval-queue__amt">{fmtVN(item.amount)}<i>₫</i></span>
      {item.type === 'advances' && (
        <button
          type="button"
          className="d-btn d-btn-square d-btn-sm approval-queue__quick"
          onClick={handleQuickApprove}
          disabled={approving}
          title={error ? `Lỗi: ${error}` : QUICK_ACTION_LABEL[item.type]}
          aria-label={QUICK_ACTION_LABEL[item.type]}
        >
          {approving ? <Loader2 size={14} className="spin" /> : <Check size={14} strokeWidth={2.6} />}
        </button>
      )}
      <ChevronRight size={14} strokeWidth={2.2} className="approval-queue__caret" />
    </div>
  );
}
