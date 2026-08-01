import React from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  ListChecks,
  Loader2,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import { ROLE_LABELS, Role } from '@tingting/shared';
import type { CreditOverrideRequestRecord, CreditOverrideStatus } from '../api/creditOverrideClient';
import {
  useApproveCreditOverrideRequest,
  useCheckCreditOverrideRequest,
  useCreditOverrideQueue,
  useRejectCreditOverrideRequest,
} from '../hooks/useCreditOverrideQueries';
import { useAuth } from '../hooks/useAuth';
import { canCheckCreditOverride, canDecideCreditOverride } from '../lib/credit-override-permissions';
import { formatCurrency, formatDateTimeVN } from '../lib/format';
import './CreditOverrideQueuePage.css';

const STATUS_LABELS: Record<CreditOverrideStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  CANCELED: 'Đã hủy',
};

const TIER_LABELS = {
  FINANCE_TIER_1: 'Trưởng phòng Tài chính/Kế toán',
  DIRECTOR: 'Giám đốc',
} as const;

const SCOPE_LABELS = {
  SHIPMENT: 'Theo lô hàng',
  EXPIRY: 'Đến ngày hết hạn',
} as const;

const WORKFLOW_LABELS = {
  PENDING_CHECK: 'Chờ kiểm tra',
  PENDING_APPROVAL: 'Chờ phê duyệt',
  APPROVED: 'Đã phê duyệt',
  REJECTED: 'Đã từ chối',
  RETURNED_FOR_EVIDENCE: 'Cần bổ sung',
  CANCELED: 'Đã hủy',
  SUPERSEDED: 'Đã thay thế',
} as const;

type QueueFilterStatus = CreditOverrideStatus | 'ALL';

function displayRole(role: string | null): string {
  if (!role) return 'Không xác định';
  return ROLE_LABELS[role as Role] ?? 'Không xác định';
}

function statusTone(status: CreditOverrideStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'is-approved';
    case 'REJECTED':
      return 'is-rejected';
    case 'CANCELED':
      return 'is-canceled';
    default:
      return 'is-pending';
  }
}

function decisionMessage(
  request: CreditOverrideRequestRecord,
  user: { userId: number; role: Role } | null,
): string | null {
  if (!user || request.status !== 'PENDING') return null;
  if (request.requestedBy === user.userId) {
    return 'Bạn là người tạo đề nghị này nên không thể tự kiểm tra, phê duyệt hoặc từ chối.';
  }
  if (request.workflowStatus === 'PENDING_CHECK') {
    return canCheckCreditOverride(user.role)
      ? null
      : 'Đề nghị đang chờ bộ phận có thẩm quyền kiểm tra.';
  }
  if (request.workflowStatus !== 'PENDING_APPROVAL') {
    return 'Đề nghị chưa ở bước phê duyệt.';
  }
  if (request.checkedBy === user.userId) {
    return 'Bạn đã kiểm tra đề nghị này nên người khác phải phê duyệt hoặc từ chối.';
  }
  if (!canDecideCreditOverride(user.role, request.requiredTier)) {
    return `Đang chờ ${TIER_LABELS[request.requiredTier]} xử lý theo đúng phân cấp phê duyệt.`;
  }
  return null;
}

function canActOnRequest(
  request: CreditOverrideRequestRecord,
  user: { userId: number; role: Role } | null,
): boolean {
  if (!user || request.status !== 'PENDING' || request.requestedBy === user.userId) return false;
  if (request.workflowStatus === 'PENDING_CHECK') {
    return canCheckCreditOverride(user.role);
  }
  if (request.workflowStatus !== 'PENDING_APPROVAL' || request.checkedBy === user.userId) {
    return false;
  }
  return canDecideCreditOverride(user.role, request.requiredTier);
}

function DecisionSummary({ request }: { request: CreditOverrideRequestRecord }) {
  if (request.status === 'APPROVED') {
    return (
      <div className="credit-override-queue__decision-summary is-approved">
        <CheckCircle2 size={16} />
        <span>
          Đã duyệt bởi {displayRole(request.approvedRole)} lúc {formatDateTimeVN(request.approvedAt)}.
        </span>
      </div>
    );
  }
  if (request.status === 'REJECTED') {
    return (
      <div className="credit-override-queue__decision-summary is-rejected">
        <XCircle size={16} />
        <span>
          Đã từ chối bởi {displayRole(request.rejectedRole)} lúc {formatDateTimeVN(request.rejectedAt)}.
        </span>
      </div>
    );
  }
  if (request.status === 'CANCELED') {
    return (
      <div className="credit-override-queue__decision-summary is-canceled">
        <AlertTriangle size={16} />
        <span>Đề nghị đã bị hủy và không còn hiệu lực để sử dụng.</span>
      </div>
    );
  }
  return null;
}

export default function CreditOverrideQueuePage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = React.useState<QueueFilterStatus>('PENDING');
  const [selectedCustomerId, setSelectedCustomerId] = React.useState('');
  const [rejectReasons, setRejectReasons] = React.useState<Record<number, string>>({});
  const [actionErrors, setActionErrors] = React.useState<Record<number, string | null>>({});

  const filters = React.useMemo(
    () => ({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      limit: 50,
    }),
    [statusFilter],
  );

  const queue = useCreditOverrideQueue(filters, true);
  const checkMutation = useCheckCreditOverrideRequest([filters]);
  const approveMutation = useApproveCreditOverrideRequest([filters]);
  const rejectMutation = useRejectCreditOverrideRequest([filters]);

  const allRequests = queue.data ?? [];
  const customerOptions = React.useMemo(() => {
    const names = new Map<number, string>();
    for (const request of allRequests) {
      names.set(request.customerId, request.customerName || 'Khách hàng chưa có tên');
    }
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [allRequests]);
  const requests = selectedCustomerId
    ? allRequests.filter((request) => request.customerId === Number(selectedCustomerId))
    : allRequests;
  const actionableCount = requests.filter((request) => canActOnRequest(request, user ?? null)).length;
  const pendingCount = requests.filter((request) => request.status === 'PENDING').length;
  const totalProposed = requests.reduce((sum, request) => sum + Number(request.proposedAmount || 0), 0);
  const hasCustomFilters = statusFilter !== 'PENDING' || selectedCustomerId.length > 0;

  function clearFilters() {
    setStatusFilter('PENDING');
    setSelectedCustomerId('');
  }

  async function handleCheck(request: CreditOverrideRequestRecord) {
    setActionErrors((current) => ({ ...current, [request.id]: null }));
    try {
      await checkMutation.mutateAsync({
        id: request.id,
        expectedVersion: request.version,
      });
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [request.id]: error instanceof Error ? error.message : 'Không thể xác nhận kiểm tra đề nghị.',
      }));
    }
  }

  async function handleApprove(request: CreditOverrideRequestRecord) {
    setActionErrors((current) => ({ ...current, [request.id]: null }));
    try {
      await approveMutation.mutateAsync({
        id: request.id,
        expectedVersion: request.version,
      });
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [request.id]: error instanceof Error ? error.message : 'Không thể duyệt đề nghị vượt hạn mức.',
      }));
    }
  }

  async function handleReject(request: CreditOverrideRequestRecord) {
    const reason = rejectReasons[request.id]?.trim() ?? '';
    if (!reason) {
      setActionErrors((current) => ({
        ...current,
        [request.id]: 'Cần nhập lý do từ chối trước khi gửi quyết định.',
      }));
      return;
    }
    setActionErrors((current) => ({ ...current, [request.id]: null }));
    try {
      await rejectMutation.mutateAsync({
        id: request.id,
        body: {
          expectedVersion: request.version,
          reason,
        },
      });
      setRejectReasons((current) => ({ ...current, [request.id]: '' }));
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [request.id]: error instanceof Error ? error.message : 'Không thể từ chối đề nghị vượt hạn mức.',
      }));
    }
  }

  return (
    <div className="credit-override-queue">
      <header className="credit-override-queue__header">
        <div className="credit-override-queue__heading">
          <span className="credit-override-queue__heading-icon" aria-hidden="true">
            <ShieldCheck size={24} />
          </span>
          <div>
            <p className="credit-override-queue__eyebrow">Phê duyệt công nợ</p>
            <h1>Duyệt vượt hạn mức</h1>
            <p className="credit-override-queue__subtitle">
              Kiểm soát các đề nghị vượt hạn mức công nợ theo thẩm quyền được giao.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="credit-override-queue__refresh"
          onClick={() => queue.refetch()}
          disabled={queue.isFetching}
          aria-label={queue.isFetching ? 'Đang tải lại hàng chờ' : 'Tải lại hàng chờ'}
        >
          {queue.isFetching ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
          <span>Tải lại</span>
        </button>
      </header>

      <section className="credit-override-queue__summary" aria-label="Tóm tắt hàng chờ">
        <article className="credit-override-queue__summary-card is-neutral">
          <span className="credit-override-queue__summary-icon" aria-hidden="true"><ListChecks size={20} /></span>
          <div>
            <span>Đề nghị hiển thị</span>
            <strong>{requests.length}</strong>
          </div>
        </article>
        <article className="credit-override-queue__summary-card is-pending">
          <span className="credit-override-queue__summary-icon" aria-hidden="true"><ShieldAlert size={20} /></span>
          <div>
            <span>Đang chờ duyệt</span>
            <strong>{pendingCount}</strong>
          </div>
        </article>
        <article className="credit-override-queue__summary-card is-actionable">
          <span className="credit-override-queue__summary-icon" aria-hidden="true"><UserRoundCheck size={20} /></span>
          <div>
            <span>Cần bạn xử lý</span>
            <strong>{actionableCount}</strong>
          </div>
        </article>
        <article className="credit-override-queue__summary-card is-value">
          <span className="credit-override-queue__summary-icon" aria-hidden="true"><BadgeDollarSign size={20} /></span>
          <div>
            <span>Giá trị hiển thị</span>
            <strong>{formatCurrency(totalProposed)}</strong>
          </div>
        </article>
      </section>

      <section
        className="credit-override-queue__workspace"
        aria-labelledby="credit-override-queue-title"
        aria-busy={queue.isFetching}
      >
        <div className="credit-override-queue__toolbar">
          <div className="credit-override-queue__toolbar-title">
            <h2 id="credit-override-queue-title">Hàng chờ phê duyệt</h2>
            <span>{requests.length}</span>
          </div>
          <div className="credit-override-queue__filters" aria-label="Bộ lọc hàng chờ">
            <label className="credit-override-queue__field is-status">
              <span>Trạng thái</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as QueueFilterStatus)}>
                <option value="PENDING">Chờ duyệt</option>
                <option value="APPROVED">Đã duyệt</option>
                <option value="REJECTED">Đã từ chối</option>
                <option value="CANCELED">Đã hủy</option>
                <option value="ALL">Tất cả</option>
              </select>
            </label>
            <label className="credit-override-queue__field is-search">
              <span>Khách hàng</span>
              <span className="credit-override-queue__search-control">
                <Search size={16} aria-hidden="true" />
                <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
                  <option value="">Tất cả khách hàng</option>
                  {customerOptions.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        </div>

        <div className="credit-override-queue__workspace-body">

      {queue.isLoading ? (
        <div className="credit-override-queue__state" role="status" aria-live="polite">
          <Loader2 size={18} className="spin" />
          <span>Đang tải hàng chờ phê duyệt…</span>
        </div>
      ) : null}

      {queue.isError ? (
        <div className="credit-override-queue__state is-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Không tải được hàng chờ.</strong>
            <p>{queue.error instanceof Error ? queue.error.message : 'Vui lòng thử lại.'}</p>
          </div>
        </div>
      ) : null}

      {!queue.isLoading && !queue.isError && requests.length === 0 ? (
        <div className="credit-override-queue__state is-empty" role="status" aria-live="polite">
          <span className="credit-override-queue__empty-icon" aria-hidden="true"><ShieldCheck size={38} /></span>
          <div>
            <strong>{statusFilter === 'PENDING' ? 'Không có đề nghị chờ duyệt' : 'Không có đề nghị phù hợp'}</strong>
            <p>{hasCustomFilters ? 'Hãy thay đổi bộ lọc để xem các đề nghị khác.' : 'Các đề nghị mới sẽ xuất hiện tại đây.'}</p>
          </div>
          {hasCustomFilters ? (
            <button type="button" className="credit-override-queue__clear-filters" onClick={clearFilters}>
              Xóa bộ lọc
            </button>
          ) : null}
        </div>
      ) : null}

      {!queue.isLoading && !queue.isError && requests.length > 0 ? (
        <div className="credit-override-queue__cards" data-testid="credit-override-card-list">
          {requests.map((request) => {
            const readOnlyReason = decisionMessage(request, user ?? null);
            const actionable = canActOnRequest(request, user ?? null);
            const isChecking = checkMutation.isPending && checkMutation.variables?.id === request.id;
            const isApproving = approveMutation.isPending && approveMutation.variables?.id === request.id;
            const isRejecting = rejectMutation.isPending && rejectMutation.variables?.id === request.id;
            return (
              <article key={request.id} className="credit-override-queue__card">
                <div className="credit-override-queue__card-header">
                  <div>
                    <div className="credit-override-queue__card-kicker">
                      <span>Đề nghị vượt hạn mức</span>
                      <span className={`credit-override-queue__status ${statusTone(request.status)}`}>
                        {STATUS_LABELS[request.status]}
                      </span>
                      <span className="credit-override-queue__badge">
                        {WORKFLOW_LABELS[request.workflowStatus]}
                      </span>
                    </div>
                    <h2>{request.customerName || 'Chưa có tên khách hàng'}</h2>
                  </div>
                  <div className="credit-override-queue__badges">
                    <span className="credit-override-queue__badge">{SCOPE_LABELS[request.scopeType]}</span>
                    <span className="credit-override-queue__badge">{TIER_LABELS[request.requiredTier]}</span>
                    {request.repeatException ? (
                      <span className="credit-override-queue__badge is-warning">
                        <ShieldAlert size={14} />
                        Lặp lại
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="credit-override-queue__facts">
                  <div>
                    <span className="credit-override-queue__fact-label">Người tạo</span>
                    <strong>{request.requestedByName || displayRole(request.requestedRole)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Lô hàng</span>
                    <strong>{request.shipmentId != null ? request.shipmentCode || 'Chưa có mã lô hàng' : 'Không áp dụng theo lô hàng'}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Hiệu lực đến</span>
                    <strong>{formatDateTimeVN(request.expiresAt)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Tạo lúc</span>
                    <strong>{formatDateTimeVN(request.createdAt)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Người kiểm tra</span>
                    <strong>
                      {request.checkedBy != null
                        ? `${request.checkedByName || 'Người dùng không xác định'} · ${formatDateTimeVN(request.checkedAt)}`
                        : 'Chưa kiểm tra'}
                    </strong>
                  </div>
                </div>

                <div className="credit-override-queue__reason">
                  <span className="credit-override-queue__fact-label">Lý do đề nghị</span>
                  <p>{request.reason}</p>
                </div>

                <div className="credit-override-queue__money-grid">
                  <div>
                    <span className="credit-override-queue__fact-label">Giá trị đề nghị</span>
                    <strong>{formatCurrency(request.proposedAmount)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Dư nợ hiện tại</span>
                    <strong>{formatCurrency(request.outstandingAmount)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Cam kết đã duyệt</span>
                    <strong>{formatCurrency(request.approvedCommitmentAmount)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Tổng phơi nhiễm</span>
                    <strong>{formatCurrency(request.totalExposure)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Hạn mức công nợ</span>
                    <strong>{formatCurrency(request.creditLimit)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Mức vượt</span>
                    <strong>{formatCurrency(request.overLimitAmount)}</strong>
                  </div>
                </div>

                <div className="credit-override-queue__meta">
                  <span>Ngưỡng cảnh báo: {Math.round(Number(request.warningThreshold || 0) * 100)}%</span>
                  <span>Tỷ lệ vượt: {Math.round(Number(request.overLimitRatio || 0) * 100)}%</span>
                  {request.consumedTripId != null ? <span>Đã được sử dụng cho một chuyến đi</span> : null}
                  {request.consumedAt ? <span>Dùng lúc {formatDateTimeVN(request.consumedAt)}</span> : null}
                </div>

                <DecisionSummary request={request} />

                {request.status === 'PENDING' ? (
                  <div className="credit-override-queue__actions">
                    {readOnlyReason ? (
                      <div className="credit-override-queue__read-only">
                        <AlertTriangle size={16} />
                        <span>{readOnlyReason}</span>
                      </div>
                    ) : null}

                    {actionable ? (
                      <div className="credit-override-queue__decision-box">
                        {request.workflowStatus === 'PENDING_CHECK' ? (
                          <button
                            type="button"
                            className="credit-override-queue__button is-primary"
                            onClick={() => handleCheck(request)}
                            disabled={isChecking}
                          >
                            {isChecking ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                            Xác nhận kiểm tra
                          </button>
                        ) : (
                          <>
                            <div className="credit-override-queue__decision-buttons">
                              <button
                                type="button"
                                className="credit-override-queue__button is-primary"
                                onClick={() => handleApprove(request)}
                                disabled={isApproving || isRejecting}
                              >
                                {isApproving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                                Duyệt đề nghị
                              </button>
                            </div>

                            <label className="credit-override-queue__reject-field">
                              <span>Lý do từ chối</span>
                              <textarea
                                value={rejectReasons[request.id] ?? ''}
                                onChange={(event) => setRejectReasons((current) => ({
                                  ...current,
                                  [request.id]: event.target.value,
                                }))}
                                rows={3}
                                placeholder="Bắt buộc khi từ chối đề nghị."
                              />
                            </label>
                            <button
                              type="button"
                              className="credit-override-queue__button is-secondary"
                              onClick={() => handleReject(request)}
                              disabled={isApproving || isRejecting}
                            >
                              {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
                              Từ chối
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}

                    {actionErrors[request.id] ? (
                      <div className="credit-override-queue__action-error" role="alert">
                        <AlertTriangle size={16} />
                        <span>{actionErrors[request.id]}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
        </div>
      </section>
    </div>
  );
}
