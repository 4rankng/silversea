import React from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type {
  GovernanceActionStatus,
  GovernanceAllowedAction,
} from '@tingting/shared';
import type { GovernanceActionRecord } from '../api/financialClient';
import {
  useApproveGovernanceAction,
  useCheckGovernanceAction,
  useGovernanceActions,
  useRejectGovernanceAction,
} from '../hooks/useFinancialQueries';
import { formatDateTimeVN } from '../lib/format';
import './GovernanceActionsPage.css';

type InboxFilter = 'PENDING' | 'ALL';
type GovernanceMutation = ReturnType<typeof useCheckGovernanceAction>;

const STATUS_LABELS: Record<GovernanceActionStatus, string> = {
  PENDING_CHECK: 'Chờ kiểm tra',
  PENDING_APPROVAL: 'Chờ phê duyệt',
  APPROVED: 'Đã phê duyệt',
  REJECTED: 'Đã từ chối',
  RETURNED_FOR_EVIDENCE: 'Trả bổ sung chứng từ',
  CANCELED: 'Đã hủy',
  SUPERSEDED: 'Đã thay thế',
};

const ACTION_LABELS: Record<GovernanceAllowedAction, string> = {
  CHECK: 'Kiểm tra',
  APPROVE: 'Phê duyệt',
  REJECT: 'Từ chối',
  RETURN_FOR_EVIDENCE: 'Trả bổ sung',
  CANCEL: 'Hủy yêu cầu',
};

const ACTION_KIND_LABELS: Record<string, string> = {
  TRIP_AR_ADJUSTMENT: 'Điều chỉnh công nợ chuyến',
  TRIP_REOPEN: 'Mở lại chuyến',
  TRIP_EXPENSE_APPROVAL: 'Duyệt chi phí chuyến',
  DEBT_OFFSET_APPROVAL: 'Duyệt bù trừ công nợ',
  DEBT_OFFSET_CANCEL: 'Hủy bù trừ công nợ',
  ADVANCE_REQUEST_APPROVAL: 'Duyệt tạm ứng',
  PAYMENT_RECEIPT: 'Thu tiền khách hàng',
  VENDOR_PAYMENT: 'Thanh toán nhà cung cấp',
  CARRIER_PAYMENT: 'Thanh toán đơn vị vận chuyển',
  DRIVER_PAYOUT: 'Chi trả tài xế',
  COMMISSION: 'Chi hoa hồng',
  PENALTY_CREATE: 'Ghi nhận kỷ luật',
  PENALTY_CANCEL: 'Hủy kỷ luật',
  COMPANY_EXPENSE: 'Chi phí công ty',
  PROFIT_DISTRIBUTION: 'Phân chia lợi nhuận',
  TRIP_FINANCIAL_CHANGE: 'Thay đổi tài chính chuyến',
  TRIP_FINANCIAL_CLOSE: 'Chốt tài chính chuyến',
  DEBIT_NOTE_ISSUE: 'Phát hành giấy báo nợ',
  DEBIT_NOTE_ADJUSTMENT: 'Điều chỉnh giấy báo nợ',
  SALARY_CONFIRMATION: 'Xác nhận lương',
  SALARY_REOPEN: 'Mở lại lương',
  SALARY_PERIOD_CLOSE: 'Chốt kỳ lương',
  SALARY_PERIOD_REOPEN: 'Mở lại kỳ lương',
  SALARY_PERIOD_ADJUSTMENT: 'Điều chỉnh sau chốt lương',
  PRICE_CONFIG_CHANGE: 'Thay đổi cấu hình giá',
  ANCILLARY_REVENUE_CHANGE: 'Thay đổi doanh thu bổ sung',
  FINANCIAL_EXCEPTION: 'Ngoại lệ tài chính',
};

function isPending(status: GovernanceActionStatus): boolean {
  return status === 'PENDING_CHECK' || status === 'PENDING_APPROVAL';
}

function statusTone(status: GovernanceActionStatus): string {
  if (status === 'APPROVED') return 'is-approved';
  if (status === 'REJECTED') return 'is-rejected';
  if (status === 'PENDING_CHECK' || status === 'PENDING_APPROVAL') return 'is-pending';
  return 'is-neutral';
}

function mutationBusy(mutation: GovernanceMutation, actionId: number): boolean {
  return mutation.isPending && mutation.variables?.id === actionId;
}

function ActionButton({
  action,
  allowed,
  busy,
  onClick,
}: {
  action: 'CHECK' | 'APPROVE';
  allowed: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`governance-actions__button ${action === 'APPROVE' ? 'is-primary' : ''}`}
      disabled={!allowed || busy}
      onClick={onClick}
      title={allowed ? undefined : 'Bạn không có quyền thực hiện bước này'}
    >
      {busy ? <Loader2 size={16} className="spin" /> : action === 'CHECK' ? <Check size={16} /> : <CheckCircle2 size={16} />}
      {ACTION_LABELS[action]}
    </button>
  );
}

export default function GovernanceActionsPage() {
  const [filter, setFilter] = React.useState<InboxFilter>('PENDING');
  const [rejectReasons, setRejectReasons] = React.useState<Record<number, string>>({});
  const [actionErrors, setActionErrors] = React.useState<Record<number, string | null>>({});
  const queue = useGovernanceActions({ limit: 100 });
  const checkMutation = useCheckGovernanceAction();
  const approveMutation = useApproveGovernanceAction();
  const rejectMutation = useRejectGovernanceAction();

  const allActions = queue.data ?? [];
  const actions = filter === 'PENDING'
    ? allActions.filter((action) => isPending(action.status))
    : allActions;

  async function runVersionedMutation(
    action: GovernanceActionRecord,
    mutation: GovernanceMutation,
    fallbackMessage: string,
  ) {
    setActionErrors((current) => ({ ...current, [action.id]: null }));
    try {
      await mutation.mutateAsync({
        id: action.id,
        expectedVersion: action.version,
      });
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [action.id]: error instanceof Error ? error.message : fallbackMessage,
      }));
    }
  }

  async function handleReject(action: GovernanceActionRecord) {
    const reason = rejectReasons[action.id]?.trim() ?? '';
    if (!reason) {
      setActionErrors((current) => ({
        ...current,
        [action.id]: 'Cần nhập lý do từ chối trước khi gửi quyết định.',
      }));
      return;
    }
    setActionErrors((current) => ({ ...current, [action.id]: null }));
    try {
      await rejectMutation.mutateAsync({
        id: action.id,
        expectedVersion: action.version,
        reason,
      });
      setRejectReasons((current) => ({ ...current, [action.id]: '' }));
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [action.id]: error instanceof Error ? error.message : 'Không thể từ chối yêu cầu.',
      }));
    }
  }

  return (
    <div className="governance-actions">
      <header className="governance-actions__hero">
        <div>
          <p className="governance-actions__eyebrow">Kiểm soát maker / checker / approver</p>
          <h1>Hàng chờ quản trị</h1>
          <p>
            Kiểm tra và phê duyệt các thay đổi tiền, giá, công nợ, ngoại lệ,
            chốt kỳ và điều chỉnh theo đúng quyền do hệ thống cấp.
          </p>
        </div>
        <button
          type="button"
          className="governance-actions__refresh"
          onClick={() => queue.refetch()}
          disabled={queue.isFetching}
        >
          {queue.isFetching ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
          Tải lại
        </button>
      </header>

      <section className="governance-actions__summary" aria-label="Tổng quan hàng chờ">
        <article>
          <span>Tổng yêu cầu</span>
          <strong>{allActions.length}</strong>
        </article>
        <article>
          <span>Chờ kiểm tra</span>
          <strong>{allActions.filter((action) => action.status === 'PENDING_CHECK').length}</strong>
        </article>
        <article>
          <span>Chờ phê duyệt</span>
          <strong>{allActions.filter((action) => action.status === 'PENDING_APPROVAL').length}</strong>
        </article>
        <article>
          <span>Bạn có thể xử lý</span>
          <strong>{allActions.filter((action) => action.allowedActions.length > 0).length}</strong>
        </article>
      </section>

      <div className="governance-actions__filter" role="group" aria-label="Phạm vi yêu cầu">
        <button type="button" className={filter === 'PENDING' ? 'is-active' : ''} onClick={() => setFilter('PENDING')}>
          Đang chờ
        </button>
        <button type="button" className={filter === 'ALL' ? 'is-active' : ''} onClick={() => setFilter('ALL')}>
          Tất cả
        </button>
      </div>

      {queue.isLoading ? (
        <div className="governance-actions__state">
          <Loader2 size={18} className="spin" />
          Đang tải hàng chờ…
        </div>
      ) : null}

      {queue.isError ? (
        <div className="governance-actions__state is-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Không tải được hàng chờ quản trị.</strong>
            <p>{queue.error instanceof Error ? queue.error.message : 'Vui lòng thử lại.'}</p>
          </div>
        </div>
      ) : null}

      {!queue.isLoading && !queue.isError && actions.length === 0 ? (
        <div className="governance-actions__state">
          <Clock3 size={18} />
          Không có yêu cầu nào trong phạm vi này.
        </div>
      ) : null}

      {!queue.isLoading && !queue.isError && actions.length > 0 ? (
        <div className="governance-actions__cards" data-testid="governance-action-card-list">
          {actions.map((action) => {
            const canCheck = action.allowedActions.includes('CHECK');
            const canApprove = action.allowedActions.includes('APPROVE');
            const canReject = action.allowedActions.includes('REJECT');
            const checking = mutationBusy(checkMutation, action.id);
            const approving = mutationBusy(approveMutation, action.id);
            const rejecting = mutationBusy(rejectMutation, action.id);
            const busy = checking || approving || rejecting;
            return (
              <article className="governance-actions__card" key={action.id}>
                <div className="governance-actions__card-header">
                  <div>
                    <div className="governance-actions__kicker">Yêu cầu #{action.id}</div>
                    <h2>{ACTION_KIND_LABELS[action.actionKind] ?? action.actionKind}</h2>
                  </div>
                  <span className={`governance-actions__status ${statusTone(action.status)}`}>
                    {STATUS_LABELS[action.status]}
                  </span>
                </div>

                <dl className="governance-actions__facts">
                  <div>
                    <dt>Đối tượng</dt>
                    <dd>{action.subjectType} · {action.subjectId != null ? `#${action.subjectId}` : action.subjectKey ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Người tạo</dt>
                    <dd>{action.makerRole ?? '—'} · #{action.makerId}</dd>
                  </div>
                  <div>
                    <dt>Phiên bản yêu cầu</dt>
                    <dd>{action.version}</dd>
                  </div>
                  <div>
                    <dt>Phiên bản dữ liệu gốc</dt>
                    <dd>{action.originalVersion}</dd>
                  </div>
                  <div>
                    <dt>Tạo lúc</dt>
                    <dd>{formatDateTimeVN(action.createdAt)}</dd>
                  </div>
                </dl>

                <div className="governance-actions__reason">
                  <span>Lý do đề nghị</span>
                  <p>{action.reason}</p>
                </div>

                <div className="governance-actions__permissions">
                  <ShieldCheck size={16} />
                  <span>Quyền xử lý từ máy chủ:</span>
                  {action.allowedActions.length > 0
                    ? action.allowedActions.map((allowedAction) => (
                        <strong key={allowedAction}>{ACTION_LABELS[allowedAction]}</strong>
                      ))
                    : <strong>Chỉ xem</strong>}
                </div>

                {isPending(action.status) ? (
                  <div className="governance-actions__decision">
                    <div className="governance-actions__buttons">
                      <ActionButton
                        action="CHECK"
                        allowed={canCheck}
                        busy={checking}
                        onClick={() => runVersionedMutation(action, checkMutation, 'Không thể kiểm tra yêu cầu.')}
                      />
                      <ActionButton
                        action="APPROVE"
                        allowed={canApprove}
                        busy={approving}
                        onClick={() => runVersionedMutation(action, approveMutation, 'Không thể phê duyệt yêu cầu.')}
                      />
                    </div>
                    <label>
                      <span>Lý do từ chối</span>
                      <textarea
                        rows={3}
                        value={rejectReasons[action.id] ?? ''}
                        onChange={(event) => setRejectReasons((current) => ({
                          ...current,
                          [action.id]: event.target.value,
                        }))}
                        placeholder="Bắt buộc khi từ chối yêu cầu."
                        disabled={!canReject || busy}
                      />
                    </label>
                    <button
                      type="button"
                      className="governance-actions__button is-danger"
                      disabled={!canReject || busy}
                      onClick={() => handleReject(action)}
                      title={canReject ? undefined : 'Bạn không có quyền từ chối yêu cầu này'}
                    >
                      {rejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
                      Từ chối
                    </button>
                  </div>
                ) : null}

                {actionErrors[action.id] ? (
                  <div className="governance-actions__action-error" role="alert">
                    <AlertTriangle size={16} />
                    {actionErrors[action.id]}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
