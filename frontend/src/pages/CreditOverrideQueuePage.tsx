import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCcw, ShieldAlert, XCircle } from 'lucide-react';
import { Role } from '@tingting/shared';
import type { CreditOverrideRequestRecord, CreditOverrideStatus } from '../api/creditOverrideClient';
import {
  useApproveCreditOverrideRequest,
  useCreditOverrideQueue,
  useRejectCreditOverrideRequest,
} from '../hooks/useCreditOverrideQueries';
import { useAuth } from '../hooks/useAuth';
import { canDecideCreditOverride } from '../lib/credit-override-permissions';
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

type QueueFilterStatus = CreditOverrideStatus | 'ALL';

function normalizeCustomerId(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
    return 'Bạn là người tạo đề nghị này nên không thể tự duyệt hoặc tự từ chối.';
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
  if (!user || request.status !== 'PENDING') return false;
  if (request.requestedBy === user.userId) return false;
  return canDecideCreditOverride(user.role, request.requiredTier);
}

function DecisionSummary({ request }: { request: CreditOverrideRequestRecord }) {
  if (request.status === 'APPROVED') {
    return (
      <div className="credit-override-queue__decision-summary is-approved">
        <CheckCircle2 size={16} />
        <span>
          Đã duyệt bởi {request.approvedRole ?? '—'} lúc {formatDateTimeVN(request.approvedAt)}.
        </span>
      </div>
    );
  }
  if (request.status === 'REJECTED') {
    return (
      <div className="credit-override-queue__decision-summary is-rejected">
        <XCircle size={16} />
        <span>
          Đã từ chối bởi {request.rejectedRole ?? '—'} lúc {formatDateTimeVN(request.rejectedAt)}.
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
  const [customerIdInput, setCustomerIdInput] = React.useState('');
  const [rejectReasons, setRejectReasons] = React.useState<Record<number, string>>({});
  const [actionErrors, setActionErrors] = React.useState<Record<number, string | null>>({});

  const filters = React.useMemo(
    () => ({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      customerId: normalizeCustomerId(customerIdInput),
      limit: 50,
    }),
    [customerIdInput, statusFilter],
  );

  const queue = useCreditOverrideQueue(filters, true);
  const approveMutation = useApproveCreditOverrideRequest([filters]);
  const rejectMutation = useRejectCreditOverrideRequest([filters]);

  const requests = queue.data ?? [];
  const actionableCount = requests.filter((request) => canActOnRequest(request, user ?? null)).length;
  const pendingCount = requests.filter((request) => request.status === 'PENDING').length;
  const totalProposed = requests.reduce((sum, request) => sum + Number(request.proposedAmount || 0), 0);

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
      <header className="credit-override-queue__hero">
        <div>
          <p className="credit-override-queue__eyebrow">Phê duyệt công nợ</p>
          <h1>Duyệt vượt hạn mức</h1>
          <p className="credit-override-queue__subtitle">
            Theo dõi các đề nghị vượt hạn mức, áp dụng đúng phân cấp FINANCE_TIER_1 và DIRECTOR,
            đồng thời chặn tự duyệt trên toàn bộ hàng chờ.
          </p>
        </div>
        <button
          type="button"
          className="credit-override-queue__refresh"
          onClick={() => queue.refetch()}
          disabled={queue.isFetching}
        >
          {queue.isFetching ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
          Tải lại
        </button>
      </header>

      <section className="credit-override-queue__summary">
        <article className="credit-override-queue__summary-card">
          <span>Đề nghị đang hiển thị</span>
          <strong>{requests.length}</strong>
        </article>
        <article className="credit-override-queue__summary-card">
          <span>Đang chờ duyệt</span>
          <strong>{pendingCount}</strong>
        </article>
        <article className="credit-override-queue__summary-card">
          <span>Bạn có thể xử lý</span>
          <strong>{actionableCount}</strong>
        </article>
        <article className="credit-override-queue__summary-card">
          <span>Tổng giá trị đề nghị</span>
          <strong>{formatCurrency(totalProposed)}</strong>
        </article>
      </section>

      <section className="credit-override-queue__filters" aria-label="Bộ lọc hàng chờ">
        <label className="credit-override-queue__field">
          <span>Trạng thái</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as QueueFilterStatus)}>
            <option value="PENDING">Chờ duyệt</option>
            <option value="APPROVED">Đã duyệt</option>
            <option value="REJECTED">Đã từ chối</option>
            <option value="CANCELED">Đã hủy</option>
            <option value="ALL">Tất cả</option>
          </select>
        </label>
        <label className="credit-override-queue__field">
          <span>Mã khách hàng</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Ví dụ: 42"
            value={customerIdInput}
            onChange={(event) => setCustomerIdInput(event.target.value)}
          />
        </label>
      </section>

      {queue.isLoading ? (
        <div className="credit-override-queue__state">
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
        <div className="credit-override-queue__state is-empty">
          <Clock3 size={18} />
          <span>Không có đề nghị nào khớp với bộ lọc hiện tại.</span>
        </div>
      ) : null}

      {!queue.isLoading && !queue.isError && requests.length > 0 ? (
        <div className="credit-override-queue__cards" data-testid="credit-override-card-list">
          {requests.map((request) => {
            const readOnlyReason = decisionMessage(request, user ?? null);
            const actionable = canActOnRequest(request, user ?? null);
            const isApproving = approveMutation.isPending && approveMutation.variables?.id === request.id;
            const isRejecting = rejectMutation.isPending && rejectMutation.variables?.id === request.id;
            return (
              <article key={request.id} className="credit-override-queue__card">
                <div className="credit-override-queue__card-header">
                  <div>
                    <div className="credit-override-queue__card-kicker">
                      <span>Đề nghị #{request.id}</span>
                      <span className={`credit-override-queue__status ${statusTone(request.status)}`}>
                        {STATUS_LABELS[request.status]}
                      </span>
                    </div>
                    <h2>Khách hàng #{request.customerId}</h2>
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
                    <strong>{request.requestedRole}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Lô hàng</span>
                    <strong>{request.shipmentId != null ? `#${request.shipmentId}` : 'Không khóa theo lô'}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Hiệu lực đến</span>
                    <strong>{formatDateTimeVN(request.expiresAt)}</strong>
                  </div>
                  <div>
                    <span className="credit-override-queue__fact-label">Tạo lúc</span>
                    <strong>{formatDateTimeVN(request.createdAt)}</strong>
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
                  {request.consumedTripId != null ? <span>Đã dùng cho chuyến #{request.consumedTripId}</span> : null}
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
  );
}
