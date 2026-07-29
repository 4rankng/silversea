import React from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useFocusDeepLink } from '../hooks/useFocusDeepLink';
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
  const [searchParams] = useSearchParams();
  useFocusDeepLink('ga');
  const [filter, setFilter] = React.useState<InboxFilter>(
    () => searchParams.get('filter') === 'all' ? 'ALL' : 'PENDING',
  );
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
  const pendingCheckCount = allActions.filter((action) => action.status === 'PENDING_CHECK').length;
  const pendingApprovalCount = allActions.filter((action) => action.status === 'PENDING_APPROVAL').length;
  const actionableCount = allActions.filter((action) => (
    action.allowedActions.includes('CHECK')
    || action.allowedActions.includes('APPROVE')
    || action.allowedActions.includes('REJECT')
  )).length;
  const pendingCount = pendingCheckCount + pendingApprovalCount;
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
          <h1>Trung tâm phê duyệt</h1>
          <p>
            Rà soát các thay đổi tài chính và vận hành theo đúng thẩm quyền
            được hệ thống cấp.
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
        <article className="governance-actions__summary-focus">
          <div>
            <span>Bạn có thể xử lý</span>
            <strong>{actionableCount}</strong>
          </div>
          <p>
            {actionableCount > 0
              ? `${actionableCount} yêu cầu đang chờ quyết định theo quyền của bạn.`
              : 'Hiện không có yêu cầu nào cần bạn xử lý.'}
          </p>
        </article>
        <article>
          <span>Đang chờ</span>
          <strong>{pendingCount}</strong>
        </article>
        <article>
          <span>Chờ kiểm tra</span>
          <strong>{pendingCheckCount}</strong>
        </article>
        <article>
          <span>Chờ phê duyệt</span>
          <strong>{pendingApprovalCount}</strong>
        </article>
      </section>

      <section className="governance-actions__queue" aria-labelledby="governance-queue-heading">
        <div className="governance-actions__queue-header">
          <div>
            <h2 id="governance-queue-heading">Danh sách yêu cầu</h2>
            <p>Ưu tiên các yêu cầu đang chờ, mở lịch sử khi cần đối chiếu.</p>
          </div>
          <div className="governance-actions__filter" role="group" aria-label="Phạm vi yêu cầu">
            <button
              type="button"
              className={filter === 'PENDING' ? 'is-active' : ''}
              aria-pressed={filter === 'PENDING'}
              aria-label="Đang chờ"
              onClick={() => setFilter('PENDING')}
            >
              Đang chờ
              <span>{pendingCount}</span>
            </button>
            <button
              type="button"
              className={filter === 'ALL' ? 'is-active' : ''}
              aria-pressed={filter === 'ALL'}
              aria-label="Tất cả"
              onClick={() => setFilter('ALL')}
            >
              Tất cả
              <span>{allActions.length}</span>
            </button>
          </div>
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
          <div className="governance-actions__state is-empty">
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <strong>Không có yêu cầu nào trong phạm vi này</strong>
              <p>
                {filter === 'PENDING'
                  ? 'Hàng chờ đã được xử lý hết. Mở “Tất cả” để xem lịch sử.'
                  : 'Chưa có yêu cầu quản trị nào được ghi nhận.'}
              </p>
            </div>
          </div>
        ) : null}

        {!queue.isLoading && !queue.isError && actions.length > 0 ? (
          <div className="governance-actions__cards" data-testid="governance-action-card-list">
          {actions.map((action) => {
            const tripExpenseDecision = tripExpenseDecisionSummary(action);
            const canCheck = action.allowedActions.includes('CHECK');
            const canApprove = action.allowedActions.includes('APPROVE');
            const canReject = action.allowedActions.includes('REJECT');
            const hasDecisionActions = canCheck || canApprove || canReject;
            const checking = mutationBusy(checkMutation, action.id)
              || (salaryDecisionBusy?.actionId === action.id && salaryDecisionBusy.decision === 'CHECK');
            const approving = mutationBusy(approveMutation, action.id)
              || (salaryDecisionBusy?.actionId === action.id && salaryDecisionBusy.decision === 'APPROVE');
            const rejecting = mutationBusy(rejectMutation, action.id);
            const busy = checking || approving || rejecting;
            return (
              <article
                className="governance-actions__card"
                id={`ga-${action.id}`}
                key={action.id}
              >
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
                    <dt>Phiên bản</dt>
                    <dd>YC {action.version} · Gốc {action.originalVersion}</dd>
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

                <div className="governance-actions__footer">
                  <div className="governance-actions__permissions">
                    <ShieldCheck size={15} />
                    <span>Quyền xử lý:</span>
                    {action.allowedActions.length > 0
                      ? action.allowedActions.map((allowedAction) => (
                          <strong key={allowedAction}>{ACTION_LABELS[allowedAction]}</strong>
                        ))
                      : <strong>Chỉ xem</strong>}
                  </div>

                  {isPending(action.status) && hasDecisionActions ? (
                    <div className={`governance-actions__decision ${canReject ? 'has-rejection' : ''}`}>
                      {canReject ? (
                        <label>
                          <span>Lý do từ chối</span>
                          <input
                            type="text"
                            value={rejectReasons[action.id] ?? ''}
                            onChange={(event) => setRejectReasons((current) => ({
                              ...current,
                              [action.id]: event.target.value,
                            }))}
                            placeholder="Nhập lý do khi từ chối"
                            disabled={busy}
                          />
                        </label>
                      ) : null}
                      <div className="governance-actions__buttons">
                        {canCheck ? (
                          <ActionButton
                            action="CHECK"
                            allowed
                            busy={checking}
                            onClick={() => runVersionedMutation(action, checkMutation, 'CHECK', 'Không thể kiểm tra yêu cầu.')}
                          />
                        ) : null}
                        {canApprove ? (
                          <ActionButton
                            action="APPROVE"
                            allowed
                            busy={approving}
                            onClick={() => runVersionedMutation(action, approveMutation, 'APPROVE', 'Không thể phê duyệt yêu cầu.')}
                          />
                        ) : null}
                        {canReject ? (
                          <button
                            type="button"
                            className="governance-actions__button is-danger"
                            disabled={busy}
                            onClick={() => handleReject(action)}
                          >
                            {rejecting ? <Loader2 size={15} className="spin" /> : <XCircle size={15} />}
                            Từ chối
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

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
      </section>
    </div>
  );
}
