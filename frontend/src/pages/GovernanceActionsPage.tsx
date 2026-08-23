import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
import { ROLE_LABELS, Role } from '@tingting/shared';
import {
  financialClient,
  type GovernanceActionRecord,
  type GovernanceActionsEnvelope,
} from '../api/financialClient';
import { salaryClient } from '../api/salaryClient';
import {
  governanceActionKeys,
  useApproveGovernanceAction,
  useCheckGovernanceAction,
  useRejectGovernanceAction,
} from '../hooks/useFinancialQueries';
import { formatDateTimeVN } from '../lib/format';
import { useFocusDeepLink } from '../hooks/useFocusDeepLink';
import { Pagination, SummaryRail } from '../design-system';
import { PageHeader } from '../components/UI';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import './GovernanceActionsPage.css';
import '../styles/table-sort.css';

/** Queue scopes map 1:1 onto the server's single-status filter. */
type QueueScope = 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'ALL';
type GovernanceMutation = ReturnType<typeof useCheckGovernanceAction>;

/** Server-side sort vocabulary (backend whitelist keys) paired with the card
 * field labels they sort — the card list's stand-in for column headers. */
type GovernanceSortKey = 'actionKind' | 'status' | 'subjectKey' | 'makerRole' | 'version' | 'createdAt' | 'reason';
const SORT_FIELDS: Array<{ key: GovernanceSortKey; label: string }> = [
  { key: 'createdAt', label: 'Tạo lúc' },
  { key: 'actionKind', label: 'Loại yêu cầu' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'subjectKey', label: 'Đối tượng' },
  { key: 'makerRole', label: 'Người tạo' },
  { key: 'version', label: 'Phiên bản' },
  { key: 'reason', label: 'Lý do' },
];

const SCOPE_TABS: Array<{ scope: QueueScope; label: string }> = [
  { scope: 'PENDING_CHECK', label: 'Chờ kiểm tra' },
  { scope: 'PENDING_APPROVAL', label: 'Chờ phê duyệt' },
  { scope: 'ALL', label: 'Tất cả' },
];

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

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  SALARY_PERIOD: 'Kỳ lương',
  SALARY_CONFIRMATION: 'Phiếu lương',
  TRIP: 'Chuyến đi',
  TRIP_EXPENSE: 'Chi phí chuyến',
  FUEL_INVOICE: 'Hóa đơn nhiên liệu',
  ADVANCE_REQUEST: 'Đề nghị tạm ứng',
  ADVANCE_SETTLEMENT: 'Phiếu thanh toán',
  CREDIT_OVERRIDE: 'Hạn mức công nợ',
  BILLING_DOCUMENT: 'Chứng từ công nợ',
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

export function governanceSeparationGuidance(
  action: GovernanceActionRecord,
): string | null {
  const canCancel = action.allowedActions.includes('CANCEL');
  if (
    action.status === 'PENDING_CHECK'
    && canCancel
    && !action.allowedActions.includes('CHECK')
    && !action.allowedActions.includes('APPROVE')
  ) {
    return 'Bạn là người tạo nên không thể tự kiểm tra. Yêu cầu cần một người đủ thẩm quyền khác kiểm tra trước khi chuyển sang phê duyệt.';
  }
  if (
    action.status === 'PENDING_APPROVAL'
    && canCancel
    && !action.allowedActions.includes('APPROVE')
  ) {
    return 'Bạn là người tạo nên không thể tự phê duyệt. Yêu cầu đang chờ một người đủ thẩm quyền khác phê duyệt.';
  }
  return null;
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
  // `?filter=all` deep-link opens the full history; the inbox default is the
  // check stage. Read on first render only — afterwards the scope lives in
  // the table query state.
  const initialScope: QueueScope = searchParams.get('filter') === 'all'
    ? 'ALL'
    : 'PENDING_CHECK';
  const [rejectReasons, setRejectReasons] = React.useState<Record<number, string>>({});
  const [actionErrors, setActionErrors] = React.useState<Record<number, string | null>>({});
  const [salaryDecisionBusy, setSalaryDecisionBusy] = React.useState<{
    actionId: number;
    decision: 'CHECK' | 'APPROVE';
  } | null>(null);
  const queue = useTableQueryState<
    GovernanceActionRecord,
    { status?: GovernanceActionStatus; sortBy?: GovernanceSortKey; sortDir?: 'asc' | 'desc' },
    GovernanceActionsEnvelope
  >({
    endpoint: (params) => financialClient.getGovernanceActions(params),
    queryKey: governanceActionKeys.list(),
    initialFilters: initialScope === 'ALL' ? {} : { status: initialScope },
  });
  const checkMutation = useCheckGovernanceAction();
  const approveMutation = useApproveGovernanceAction();
  const rejectMutation = useRejectGovernanceAction();

  // Server-side card sort: state rides the filters bag so every sort change
  // resets the page alongside the scope switches.
  const sort: TableSortState | null = queue.filters.sortBy
    ? { by: queue.filters.sortBy, dir: queue.filters.sortDir ?? 'asc' }
    : null;
  const handleSort = (key: string) => {
    const next = nextTableSort(sort, key);
    queue.setFilters({
      ...queue.filters,
      sortBy: next.by as GovernanceSortKey,
      sortDir: next.dir,
    });
  };

  const actions = queue.rows;
  const statusScope = queue.filters.status;
  const scope: QueueScope = statusScope === 'PENDING_CHECK' || statusScope === 'PENDING_APPROVAL'
    ? statusScope
    : 'ALL';
  const statusCounts = queue.query.data?.statusCounts ?? {};
  // statusCounts covers the same filters as total: when a status filter is
  // active only that status's count is knowable from this response.
  const unfiltered = scope === 'ALL';
  const pendingCheckCount = statusCounts.PENDING_CHECK ?? 0;
  const pendingApprovalCount = statusCounts.PENDING_APPROVAL ?? 0;
  const pendingCount = unfiltered ? pendingCheckCount + pendingApprovalCount : queue.total;
  const checkCount: number | '—' = scope === 'PENDING_APPROVAL' ? '—' : pendingCheckCount;
  const approvalCount: number | '—' = scope === 'PENDING_CHECK' ? '—' : pendingApprovalCount;
  // allowedActions is page-scoped, so the actionable count is page-scoped too.
  const actionableCount = actions.filter((action) => (
    action.allowedActions.includes('CHECK')
    || action.allowedActions.includes('APPROVE')
    || action.allowedActions.includes('REJECT')
  )).length;

  function tabCount(tabScope: QueueScope): number | null {
    if (tabScope === 'ALL') return unfiltered ? queue.total : null;
    if (tabScope === scope) return queue.total;
    return unfiltered ? statusCounts[tabScope] ?? 0 : null;
  }

  function setScope(next: QueueScope) {
    // setFilter drops the key for undefined and resets the page to 1.
    queue.setFilter('status', next === 'ALL' ? undefined : next);
  }

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
        await queue.query.refetch();
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
      <PageHeader
        title="Trung tâm phê duyệt"
        action={
          <button
            type="button"
            className="governance-actions__refresh"
            onClick={() => queue.query.refetch()}
            disabled={queue.isFetching}
          >
            {queue.isFetching ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
            Tải lại
          </button>
        }
      />

      <SummaryRail
        ariaLabel="Tổng quan hàng chờ"
        items={[
          { label: 'Bạn có thể xử lý', value: actionableCount, tone: actionableCount > 0 ? 'warning' : undefined },
          { label: 'Đang chờ', value: pendingCount },
          { label: 'Chờ kiểm tra', value: checkCount },
          { label: 'Chờ phê duyệt', value: approvalCount },
        ]}
      />

      <section className="governance-actions__queue" aria-labelledby="governance-queue-heading">
        <div className="governance-actions__queue-header">
          <div>
            <h2 id="governance-queue-heading">Danh sách yêu cầu</h2>
            <p>Ưu tiên các yêu cầu đang chờ, mở lịch sử khi cần đối chiếu.</p>
          </div>
          <div className="governance-actions__filter" role="group" aria-label="Phạm vi yêu cầu">
            {SCOPE_TABS.map(({ scope: tabScope, label }) => {
              const count = tabCount(tabScope);
              return (
                <button
                  key={tabScope}
                  type="button"
                  className={scope === tabScope ? 'is-active' : ''}
                  aria-pressed={scope === tabScope}
                  onClick={() => setScope(tabScope)}
                >
                  {label}
                  {count !== null ? <span>{count}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Card list's sort stand-in for column headers — same button contract
            as the record-table/DataTable sort headers (table-sort.css). */}
        <div className="governance-actions__sort" role="group" aria-label="Sắp xếp theo">
          <span>Sắp xếp</span>
          {SORT_FIELDS.map(({ key, label }) => {
            const active = sort?.by === key;
            return (
              <button
                key={key}
                type="button"
                className={active ? 'is-active' : ''}
                onClick={() => handleSort(key)}
              >
                {label}
                {active
                  ? (sort!.dir === 'asc'
                    ? <ArrowUp size={13} aria-hidden="true" />
                    : <ArrowDown size={13} aria-hidden="true" />)
                  : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
              </button>
            );
          })}
        </div>

        {queue.isLoading ? (
          <div className="governance-actions__state">
            <Loader2 size={18} className="spin" />
            Đang tải hàng chờ…
          </div>
        ) : null}

        {queue.error ? (
          <div className="governance-actions__state is-error" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>Không tải được hàng chờ quản trị.</strong>
              <p>{queue.error instanceof Error ? queue.error.message : 'Vui lòng thử lại.'}</p>
            </div>
          </div>
        ) : null}

        {!queue.isLoading && !queue.error && actions.length === 0 ? (
          <div className="governance-actions__state is-empty">
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <strong>Không có yêu cầu nào trong phạm vi này</strong>
              <p>
                {scope === 'ALL'
                  ? 'Chưa có yêu cầu quản trị nào được ghi nhận.'
                  : 'Không còn yêu cầu nào ở giai đoạn này. Mở “Tất cả” để xem lịch sử.'}
              </p>
            </div>
          </div>
        ) : null}

        {!queue.isLoading && !queue.error && actions.length > 0 ? (
          <div className="governance-actions__cards" data-testid="governance-action-card-list">
          {actions.map((action) => {
            const tripExpenseDecision = tripExpenseDecisionSummary(action);
            const separationGuidance = governanceSeparationGuidance(action);
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
                    <div className="governance-actions__kicker">Yêu cầu phê duyệt</div>
                    <h2>{governanceActionLabel(action)}</h2>
                  </div>
                  <span className={`governance-actions__status ${statusTone(action.status)}`}>
                    {STATUS_LABELS[action.status]}
                  </span>
                </div>

                <dl className="governance-actions__facts">
                  <div>
                    <dt>Đối tượng</dt>
                    <dd>{action.subjectKey || SUBJECT_TYPE_LABELS[action.subjectType] || 'Nghiệp vụ liên quan'}</dd>
                  </div>
                  <div>
                    <dt>Người tạo</dt>
                    <dd>{action.makerRole ? ROLE_LABELS[action.makerRole as Role] ?? 'Người dùng không xác định' : 'Người dùng không xác định'}</dd>
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

                  {separationGuidance ? (
                    <p className="governance-actions__separation-guidance">
                      {separationGuidance}
                    </p>
                  ) : null}

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

        <div className="governance-actions__pagination">
          <Pagination
            page={queue.page}
            totalPages={queue.totalPages}
            totalItems={queue.total}
            pageSize={queue.pageSize}
            onChange={queue.setPage}
            disabled={queue.isFetching}
          />
        </div>
      </section>
    </div>
  );
}
