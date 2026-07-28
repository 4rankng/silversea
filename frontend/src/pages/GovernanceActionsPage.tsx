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
import { salaryClient } from '../api/salaryClient';
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
  FUEL_INVOICE_APPROVAL: 'Duyệt hóa đơn nhiên liệu',
  FUEL_INVOICE_CORRECTION: 'Điều chỉnh hóa đơn nhiên liệu',
  DEBT_OFFSET_APPROVAL: 'Duyệt bù trừ công nợ',
  DEBT_OFFSET_CANCEL: 'Hủy bù trừ công nợ',
  ADVANCE_REQUEST_APPROVAL: 'Duyệt tạm ứng',
  ADVANCE_REQUEST_REJECTION: 'Từ chối tạm ứng',
  ADVANCE_SETTLEMENT_CORRECTION: 'Điều chỉnh quyết toán tạm ứng',
  ADVANCE_SETTLEMENT_REVERSAL: 'Hoàn tác quyết toán tạm ứng',
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

export function governanceActionLabel(action: GovernanceActionRecord): string {
  if (action.actionKind === 'SALARY_PERIOD_CLOSE') {
    const operation = action.afterSnapshot?.operation;
    if (operation === 'ISSUE_PAYSLIPS') return 'Phát hành phiếu lương';
    if (operation === 'POST_OFFICIAL') return 'Hạch toán lương chính thức';
  }
  return ACTION_KIND_LABELS[action.actionKind] ?? action.actionKind;
}

function salaryFinalizationOperation(
  action: GovernanceActionRecord,
): 'ISSUE_PAYSLIPS' | 'POST_OFFICIAL' | null {
  if (action.actionKind !== 'SALARY_PERIOD_CLOSE') return null;
  const operation = action.afterSnapshot?.operation;
  return operation === 'ISSUE_PAYSLIPS' || operation === 'POST_OFFICIAL'
    ? operation
    : null;
}

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

export function tripExpenseDecisionSummary(action: GovernanceActionRecord): {
  decision: string;
  reviewNote: string;
  attachmentRefs: string[];
} | null {
  if (action.actionKind !== 'TRIP_EXPENSE_APPROVAL') return null;
  const decision = action.afterSnapshot?.decision === 'REJECTED'
    ? 'Đề nghị từ chối'
    : 'Đề nghị phê duyệt';
  const evidence = action.deltaSnapshot?.evidence as Record<string, unknown> | undefined;
  const reviewNote = typeof evidence?.reviewNote === 'string' ? evidence.reviewNote : '';
  const attachmentRefs = Array.isArray(evidence?.attachmentRefs)
    ? evidence.attachmentRefs.filter((value): value is string => typeof value === 'string')
    : [];
  return { decision, reviewNote, attachmentRefs };
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
  const [salaryDecisionBusy, setSalaryDecisionBusy] = React.useState<{
    actionId: number;
    decision: 'CHECK' | 'APPROVE';
  } | null>(null);
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
    decision: 'CHECK' | 'APPROVE',
    fallbackMessage: string,
  ) {
    setActionErrors((current) => ({ ...current, [action.id]: null }));
    try {
      const operation = salaryFinalizationOperation(action);
      if (operation && action.subjectKey) {
        setSalaryDecisionBusy({ actionId: action.id, decision });
        if (operation === 'ISSUE_PAYSLIPS') {
          await (decision === 'CHECK'
            ? salaryClient.checkIssuePayslips(action.subjectKey, action.id, action.version)
            : salaryClient.approveIssuePayslips(action.subjectKey, action.id, action.version));
        } else {
          await (decision === 'CHECK'
            ? salaryClient.checkPostOfficial(action.subjectKey, action.id, action.version)
            : salaryClient.approvePostOfficial(action.subjectKey, action.id, action.version));
        }
        await queue.refetch();
        return;
      }
      await mutation.mutateAsync({
        id: action.id,
        expectedVersion: action.version,
      });
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [action.id]: error instanceof Error ? error.message : fallbackMessage,
      }));
    } finally {
      setSalaryDecisionBusy((current) => current?.actionId === action.id ? null : current);
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
            const tripExpenseDecision = tripExpenseDecisionSummary(action);
            const canCheck = action.allowedActions.includes('CHECK');
            const canApprove = action.allowedActions.includes('APPROVE');
            const canReject = action.allowedActions.includes('REJECT');
            const checking = mutationBusy(checkMutation, action.id)
              || (salaryDecisionBusy?.actionId === action.id && salaryDecisionBusy.decision === 'CHECK');
            const approving = mutationBusy(approveMutation, action.id)
              || (salaryDecisionBusy?.actionId === action.id && salaryDecisionBusy.decision === 'APPROVE');
            const rejecting = mutationBusy(rejectMutation, action.id);
            const busy = checking || approving || rejecting;
            return (
              <article className="governance-actions__card" key={action.id}>
                <div className="governance-actions__card-header">
                  <div>
                    <div className="governance-actions__kicker">Yêu cầu #{action.id}</div>
                    <h2>{governanceActionLabel(action)}</h2>
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

                {tripExpenseDecision ? (
                  <div className="governance-actions__reason">
                    <span>Quyết định và căn cứ</span>
                    <p>
                      <strong>{tripExpenseDecision.decision}</strong>
                      {' · '}
                      {tripExpenseDecision.reviewNote || 'Chưa có nội dung căn cứ'}
                    </p>
                    {tripExpenseDecision.attachmentRefs.length > 0 ? (
                      <p>Tham chiếu: {tripExpenseDecision.attachmentRefs.join(', ')}</p>
                    ) : null}
                    <p>Chi phí vẫn chờ xử lý; chưa phát sinh hiệu lực tài chính trước phê duyệt cuối.</p>
                  </div>
                ) : null}

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
                        onClick={() => runVersionedMutation(action, checkMutation, 'CHECK', 'Không thể kiểm tra yêu cầu.')}
                      />
                      <ActionButton
                        action="APPROVE"
                        allowed={canApprove}
                        busy={approving}
                        onClick={() => runVersionedMutation(action, approveMutation, 'APPROVE', 'Không thể phê duyệt yêu cầu.')}
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
