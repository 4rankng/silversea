import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { Role } from '@tingting/shared';
import { useTripOptions } from '../hooks/useTripOptions';
import { useTripForm } from '../hooks/useTripForm';
import { TripFormProvider } from '../hooks/useTripFormContext';
import { TripInfoCard } from '../components/trip/TripInfoCard';
import { JourneyLegsCard } from '../components/trip/JourneyLegsCard';
import { FuelTollsRevenueCard } from '../components/trip/FuelTollsRevenueCard';
import { ImagesNotesCard } from '../components/trip/ImagesNotesCard';
import { ContainerInstancesCard } from '../components/trip/ContainerInstancesCard';
import { CardSection } from '../components/trip/CardSection';
import { TripSummaryCard } from '../components/trip/TripSummaryCard';
import { TripChecklistPanel } from '../components/trip/TripChecklistPanel';
import { ActionBar } from '../components/trip/ActionBar';
import { onboardingEvents } from '../lib/onboardingEvents';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { useConfirm } from '../components/UI';
import { Pagination } from '../design-system';
import { useAuth } from '../hooks/useAuth';
import type { CreditOverrideRequestRecord } from '../api/creditOverrideClient';
import {
  useApproveCreditOverrideRequest,
  useCreateCreditOverrideRequest,
  useCreditOverrideQueue,
  useRejectCreditOverrideRequest,
} from '../hooks/useCreditOverrideQueries';
import { formatCurrency } from '../lib/format';
import { canDecideCreditOverride } from '../lib/credit-override-permissions';
import './TripForm.css';
import './TripCreatePage.css';

function defaultExpiryInput(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(17, 30, 0, 0);
  const offset = next.getTimezoneOffset();
  const local = new Date(next.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function creditTierLabel(tier: CreditOverrideRequestRecord['requiredTier']): string {
  return tier === 'DIRECTOR' ? 'Giám đốc' : 'Trưởng phòng Tài chính/Kế toán';
}

export default function TripCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const options = useTripOptions();
  const [creditBlock, setCreditBlock] = React.useState<{
    message: string;
    customerId: number;
    proposedAmount: number;
  } | null>(null);
  const [creditReason, setCreditReason] = React.useState('');
  const [creditExpiry, setCreditExpiry] = React.useState(defaultExpiryInput);
  const [creditRequest, setCreditRequest] = React.useState<CreditOverrideRequestRecord | null>(null);
  const [creditRequestIdInput, setCreditRequestIdInput] = React.useState('');
  const [creditPage, setCreditPage] = React.useState(1);
  const [creditAction, setCreditAction] = React.useState<'request' | 'approve' | 'apply' | null>(null);
  const [creditError, setCreditError] = React.useState<string | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = React.useState<number | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const form = useTripForm({
    options,
    onCreditLimitBlocked: (details) => {
      setCreditBlock(details);
      setCreditReason('');
      setCreditExpiry(defaultExpiryInput());
      setCreditRequest(null);
      setCreditRequestIdInput('');
      setCreditPage(1);
      setCreditError(null);
    },
  });
  const expectedContainerCount = Math.min(10, Math.max(1, Number(form.containerCount) || 1));
  const { rootRef } = usePageAnimations({
    ready: !options.loading,
    selectors: ['.tc-create-hero', '.tc-create-bento'],
  });

  const { confirm, dialog } = useConfirm();
  const guard = useDirtyGuard([form], !options.loading);
  const handleBack = () => navigate('/trips');
  useBackShortcut(handleBack, {
    isDirty: guard.isDirty,
    confirmDiscard: () => confirm('Thoát mà không lưu? Các thay đổi chưa lưu sẽ bị mất.', { variant: 'warning', confirmLabel: 'Thoát' }),
  });

  const queueFilters = React.useMemo(
    () => ({
      customerId: creditBlock?.customerId,
      limit: 25,
      page: creditPage,
    }),
    [creditBlock?.customerId, creditPage],
  );
  const creditQueue = useCreditOverrideQueue(queueFilters, creditBlock?.customerId != null);
  const createCreditRequest = useCreateCreditOverrideRequest([queueFilters]);
  const approveCreditRequest = useApproveCreditOverrideRequest([queueFilters]);
  const rejectCreditRequest = useRejectCreditOverrideRequest([queueFilters]);
  const estimatedProposedAmount = creditBlock?.proposedAmount && creditBlock.proposedAmount > 0
    ? creditBlock.proposedAmount
    : Math.round((form.suggestedPrice ?? 0) * expectedContainerCount);

  React.useEffect(() => {
    if (!creditQueue.data) return;
    const lastAvailablePage = Math.max(creditQueue.data.totalPages, 1);
    if (creditPage > lastAvailablePage) setCreditPage(lastAvailablePage);
  }, [creditPage, creditQueue.data]);

  const submitTrip = async (creditApprovalRequestId?: number | null) => {
    const tripId = await form.handleSubmit(undefined, { creditApprovalRequestId });
    if (tripId) {
      onboardingEvents.emit('trip.created', { tripId });
      navigate(`/trips/${tripId}`);
      return true;
    }
    return false;
  };

  const handleSubmit = async () => {
    await submitTrip();
  };

  const handleCreateCreditRequest = async () => {
    if (!creditBlock) return;
    if (!creditReason.trim()) {
      setCreditError('Cần nhập lý do vượt hạn mức.');
      return;
    }
    if (estimatedProposedAmount <= 0) {
      setCreditError('Chưa xác định được giá trị chuyến dự kiến để lập đề nghị. Vui lòng kiểm tra bảng giá.');
      return;
    }
    const expiresAt = new Date(creditExpiry);
    if (Number.isNaN(expiresAt.getTime())) {
      setCreditError('Ngày hết hạn không hợp lệ.');
      return;
    }
    setCreditAction('request');
    setCreditError(null);
    try {
      const created = await createCreditRequest.mutateAsync({
        customerId: creditBlock.customerId,
        proposedAmount: estimatedProposedAmount,
        reason: creditReason.trim(),
        expiresAt: expiresAt.toISOString(),
      });
      setCreditRequest(created);
      setCreditRequestIdInput(String(created.id));
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : 'Không thể tạo đề nghị vượt hạn mức.');
    } finally {
      setCreditAction(null);
    }
  };

  const handleApproveRequest = async (requestId: number) => {
    const request = creditQueue.data?.items.find((item) => item.id === requestId) ?? creditRequest;
    if (!request) {
      setCreditError('Không tìm thấy phiên bản hiện tại của đề nghị để duyệt. Vui lòng tải lại hàng chờ.');
      return null;
    }
    setCreditAction('approve');
    setCreditError(null);
    try {
      const approved = await approveCreditRequest.mutateAsync({
        id: requestId,
        expectedVersion: request.version,
      });
      setCreditRequest(approved);
      setCreditRequestIdInput(String(approved.id));
      return approved.id;
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : 'Không thể duyệt đề nghị vượt hạn mức.');
      return null;
    } finally {
      setCreditAction(null);
    }
  };

  const handleRejectRequest = async (request: CreditOverrideRequestRecord) => {
    if (!rejectReason.trim()) {
      setCreditError('Cần nhập lý do từ chối.');
      return;
    }
    setRejectingRequestId(request.id);
    setCreditError(null);
    try {
      await rejectCreditRequest.mutateAsync({
        id: request.id,
        body: {
          expectedVersion: request.version,
          reason: rejectReason.trim(),
        },
      });
      setRejectReason('');
      setRejectingRequestId(null);
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : 'Không thể từ chối đề nghị vượt hạn mức.');
    } finally {
      setRejectingRequestId(null);
    }
  };

  const handleApplyApprovedRequest = async (requestId: number) => {
    setCreditAction('apply');
    setCreditError(null);
    try {
      const ok = await submitTrip(requestId);
      if (!ok) {
        setCreditError(form.error || 'Không thể tạo chuyến với đề nghị phê duyệt này.');
      }
    } finally {
      setCreditAction(null);
    }
  };

  const handleApproveAndApply = async () => {
    const requestId = Number(creditRequestIdInput);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      setCreditError('Cần chọn một đề nghị trước khi duyệt.');
      return;
    }
    const approvedId = await handleApproveRequest(requestId);
    if (approvedId) {
      await handleApplyApprovedRequest(approvedId);
    }
  };

  return (
    <TripFormProvider form={form}>
      <div ref={rootRef} className="tc-create-wrap">
        <section className="tc-create-hero">
          <div className="tc-hero-top">
            <button className="tc-back-btn" onClick={handleBack} aria-label="Quay lại">
              <ArrowLeft size={18} />
            </button>
            <div className="tc-hero-title-block">
              <div className="tc-hero-eyebrow">Tạo lệnh mới</div>
              <h1 className="tc-hero-h1" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src="/assets/icons/03-trip-log-so-chuyen-chuyen-xe.png" alt="" style={{ width: 36, height: 36, flexShrink: 0 }} />
                Tạo lệnh vận chuyển mới
              </h1>
              <p className="tc-hero-sub">
                Điền các trường bắt buộc để tạo lệnh. Chọn tuyến đường để tự động điền trạm thu phí, định mức dầu và lương sản lượng.
              </p>
            </div>
          </div>

          <div className="tc-hero-widgets">
            <TripSummaryCard />
            <TripChecklistPanel />
          </div>
        </section>

        <div className="tc-create-bento" id="trip-new-form">
          <div className="tc-bento-main">
            <TripInfoCard
              customers={options.customers}
              carrierCustomers={options.carrierCustomers}
              routes={options.routes}
              trucks={options.trucks}
              trailerTypes={options.trailerTypes}
              drivers={options.drivers}
              cargoTypes={options.cargoTypes}
              containerTypes={options.containerTypes}
              loading={options.loading}
            />
          </div>

          <div className="tc-bento-legs">
            <JourneyLegsCard collapsible defaultCollapsed />
          </div>

          <div className="tc-bento-finance">
            <FuelTollsRevenueCard collapsible defaultCollapsed />
          </div>

          <div className="tc-bento-containers">
            <CardSection
              number={4}
              title="Container & Seal"
              subtitle="Cập nhật số cont, seal và ảnh chụp khi có dữ liệu thực tế"
              badge="optional"
              collapsible
              defaultCollapsed
            >
              <ContainerInstancesCard expectedCount={expectedContainerCount} />
            </CardSection>
          </div>

          <div className="tc-bento-media">
            <ImagesNotesCard collapsible defaultCollapsed />
          </div>
        </div>

        <ActionBar
          loading={options.loading}
          onCancel={handleBack}
          onSubmit={handleSubmit}
        />

        {creditBlock && (
          <section
            style={{
              marginTop: 20,
              border: '1px solid rgba(217, 119, 6, 0.35)',
              background: 'rgba(245, 158, 11, 0.08)',
              borderRadius: 16,
              padding: 20,
              display: 'grid',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
              <div style={{ display: 'grid', gap: 6 }}>
                <strong>Vượt hạn mức công nợ</strong>
                <span style={{ color: 'var(--fg-2)', fontSize: 14 }}>{creditBlock.message}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div style={creditMetricStyle}>
                <span style={creditMetricLabelStyle}>Giá trị chuyến dự kiến</span>
                <strong>{estimatedProposedAmount > 0 ? formatCurrency(estimatedProposedAmount) : 'Chưa xác định'}</strong>
              </div>
              <div style={creditMetricStyle}>
                <span style={creditMetricLabelStyle}>Đề nghị hiện có</span>
                <select
                  className="input"
                  value={creditRequestIdInput}
                  onChange={(event) => setCreditRequestIdInput(event.target.value)}
                >
                  <option value="">Chọn theo lý do và trạng thái</option>
                  {(creditQueue.data?.items ?? [])
                    .filter((request) => request.shipmentId == null && request.status !== 'CANCELED')
                    .map((request) => (
                      <option key={request.id} value={request.id}>
                        {request.reason} · {request.status === 'APPROVED' ? 'Đã duyệt' : request.status === 'REJECTED' ? 'Đã từ chối' : 'Chờ duyệt'}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {creditRequest && (
              <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.72)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <ShieldCheck size={16} />
                  <strong>Đề nghị vượt hạn mức</strong>
                  <span style={creditBadgeStyle}>{creditRequest.status === 'APPROVED' ? 'Đã duyệt' : 'Chờ duyệt'}</span>
                  <span style={creditBadgeStyle}>{creditTierLabel(creditRequest.requiredTier)}</span>
                </div>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                  <div style={creditMetricStyle}>
                    <span style={creditMetricLabelStyle}>Dư nợ hiện tại</span>
                    <strong>{formatCurrency(Number(creditRequest.outstandingAmount))}</strong>
                  </div>
                  <div style={creditMetricStyle}>
                    <span style={creditMetricLabelStyle}>Đã duyệt chưa thu</span>
                    <strong>{formatCurrency(Number(creditRequest.approvedCommitmentAmount))}</strong>
                  </div>
                  <div style={creditMetricStyle}>
                    <span style={creditMetricLabelStyle}>Tổng phơi nhiễm</span>
                    <strong>{formatCurrency(Number(creditRequest.totalExposure))}</strong>
                  </div>
                  <div style={creditMetricStyle}>
                    <span style={creditMetricLabelStyle}>Phần vượt</span>
                    <strong>{formatCurrency(Number(creditRequest.overLimitAmount))}</strong>
                  </div>
                </div>
                {creditRequest.requestedBy === user?.userId && (
                  <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>
                    Bạn là người tạo đề nghị này nên không thể tự duyệt. Hãy chuyển đề nghị cho một người duyệt khác.
                  </span>
                )}
              </div>
            )}

            {creditQueue.data && creditQueue.data.items.length > 0 && (
              <div style={{ display: 'grid', gap: 10 }}>
                <strong>Các đề nghị của khách hàng này</strong>
                {creditQueue.data.items
                  .filter((request) => request.shipmentId == null)
                  .map((request) => (
                    <div key={request.id} style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.72)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong>{request.reason}</strong>
                        <span style={creditBadgeStyle}>{creditTierLabel(request.requiredTier)}</span>
                      </div>
                      <div style={{ color: 'var(--fg-2)', fontSize: 14 }}>{request.reason}</div>
                      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                        <div style={creditMetricStyle}>
                          <span style={creditMetricLabelStyle}>Phơi nhiễm</span>
                          <strong>{formatCurrency(Number(request.totalExposure))}</strong>
                        </div>
                        <div style={creditMetricStyle}>
                          <span style={creditMetricLabelStyle}>Phần vượt</span>
                          <strong>{formatCurrency(Number(request.overLimitAmount))}</strong>
                        </div>
                        <div style={creditMetricStyle}>
                          <span style={creditMetricLabelStyle}>Hiệu lực đến</span>
                          <strong>{request.expiresAt ? new Date(request.expiresAt).toLocaleString('vi-VN') : 'Theo phạm vi khác'}</strong>
                        </div>
                      </div>
                      {request.requestedBy === user?.userId ? (
                        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>
                          Bạn là người tạo đề nghị này nên không thể tự duyệt hoặc từ chối.
                        </span>
                      ) : canDecideCreditOverride(user?.role, request.requiredTier) ? (
                        <>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn--secondary"
                              onClick={() => { void handleApproveRequest(request.id).then((approvedId) => { if (approvedId) void handleApplyApprovedRequest(approvedId); }); }}
                              disabled={creditAction !== null || rejectingRequestId === request.id}
                            >
                              Duyệt rồi tạo chuyến
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary"
                              onClick={() => {
                                setRejectingRequestId((current) => current === request.id ? null : request.id);
                                setRejectReason('');
                                setCreditError(null);
                              }}
                              disabled={creditAction !== null}
                            >
                              Từ chối
                            </button>
                          </div>
                          {rejectingRequestId === request.id && (
                            <div style={{ display: 'grid', gap: 8 }}>
                              <textarea
                                className="input"
                                rows={3}
                                value={rejectReason}
                                onChange={(event) => setRejectReason(event.target.value)}
                                placeholder="Nhập lý do từ chối để người tạo biết cách xử lý."
                              />
                              <button
                                type="button"
                                className="btn btn--secondary"
                                onClick={() => { void handleRejectRequest(request); }}
                                disabled={rejectCreditRequest.isPending}
                              >
                                {rejectCreditRequest.isPending ? <Loader2 size={16} className="spin" /> : null}
                                Xác nhận từ chối
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>
                          Đề nghị này đang chờ đúng cấp {creditTierLabel(request.requiredTier)} xử lý.
                        </span>
                      )}
                    </div>
                  ))}
                <Pagination
                  page={creditQueue.data.page}
                  totalPages={creditQueue.data.totalPages}
                  totalItems={creditQueue.data.total}
                  pageSize={creditQueue.data.limit}
                  onChange={(nextPage) => {
                    setCreditPage(nextPage);
                    setCreditRequestIdInput('');
                  }}
                />
              </div>
            )}
            {creditQueue.isError && (
              <div role="alert" style={{ color: 'var(--danger)', fontSize: 14 }}>
                {creditQueue.error instanceof Error ? creditQueue.error.message : 'Không thể tải hàng chờ duyệt vượt hạn mức.'}
              </div>
            )}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Lý do vượt hạn mức</span>
                <textarea
                  className="input"
                  rows={3}
                  value={creditReason}
                  onChange={(event) => setCreditReason(event.target.value)}
                  placeholder="Giải thích vì sao cần tiếp tục phục vụ khách hàng này."
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Hiệu lực đến</span>
                <input
                  className="input mono"
                  type="datetime-local"
                  value={creditExpiry}
                  onChange={(event) => setCreditExpiry(event.target.value)}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary" onClick={() => { void handleCreateCreditRequest(); }} disabled={creditAction !== null}>
                {creditAction === 'request' ? <Loader2 size={16} className="spin" /> : null}
                Gửi đề nghị vượt hạn mức
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  const requestId = Number(creditRequestIdInput);
                  if (!Number.isInteger(requestId) || requestId <= 0) {
                    setCreditError('Cần chọn một đề nghị đã được duyệt trước khi áp dụng.');
                    return;
                  }
                  void handleApplyApprovedRequest(requestId);
                }}
                disabled={creditAction !== null}
              >
                {creditAction === 'apply' ? <Loader2 size={16} className="spin" /> : null}
                Tạo chuyến với đề nghị đã duyệt
              </button>
              {creditRequest
                && canDecideCreditOverride(user?.role, creditRequest.requiredTier)
                && creditRequest.requestedBy !== user?.userId && (
                <button
                  type="button"
                className="btn btn--secondary"
                onClick={() => { void handleApproveAndApply(); }}
                disabled={creditAction !== null}
              >
                {creditAction === 'approve' ? <Loader2 size={16} className="spin" /> : null}
                Duyệt đề nghị rồi tạo chuyến
              </button>
            )}
            </div>

            {creditError && (
              <div role="alert" style={{ color: 'var(--danger)', fontSize: 14 }}>
                {creditError}
              </div>
            )}
          </section>
        )}

        {dialog}
      </div>
    </TripFormProvider>
  );
}

const creditMetricStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.82)',
};

const creditMetricLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-3)',
};

const creditBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '0 10px',
  borderRadius: 999,
  background: 'rgba(37, 99, 235, 0.08)',
  color: 'var(--fg-2)',
  fontSize: 12,
  fontWeight: 600,
};
