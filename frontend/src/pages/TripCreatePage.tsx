import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { useTripOptions } from '../hooks/useTripOptions';
import { DATE_TIME_24_PLACEHOLDER, useBufferedDateTimeValue } from '../design-system';
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
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { useConfirm } from '../components/UI';
import { Pagination, UuiSelectField } from '../design-system';
import { useAuth } from '../hooks/useAuth';
import type { CreditOverrideRequestRecord } from '../api/creditOverrideClient';
import {
  useCreateCreditOverrideRequest,
  useCreditOverrideQueue,
} from '../hooks/useCreditOverrideQueries';
import { formatCurrency } from '../lib/format';
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
  // 24h time-first entry (combined date+time contract, 2026-09-09): same
  // 'YYYY-MM-DDTHH:mm' value contract as the datetime-local it replaces.
  const creditExpiryInput = useBufferedDateTimeValue({ value: creditExpiry, onChange: setCreditExpiry });
  const [creditRequest, setCreditRequest] = React.useState<CreditOverrideRequestRecord | null>(null);
  const [creditRequestIdInput, setCreditRequestIdInput] = React.useState('');
  const [creditPageCursors, setCreditPageCursors] = React.useState<Array<string | null>>([null]);
  const [creditAction, setCreditAction] = React.useState<'request' | 'apply' | null>(null);
  const [creditError, setCreditError] = React.useState<string | null>(null);
  const form = useTripForm({
    options,
    onCreditLimitBlocked: (details) => {
      setCreditBlock(details);
      setCreditReason('');
      setCreditExpiry(defaultExpiryInput());
      setCreditRequest(null);
      setCreditRequestIdInput('');
      setCreditPageCursors([null]);
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
      cursor: creditPageCursors[creditPageCursors.length - 1] ?? undefined,
    }),
    [creditBlock?.customerId, creditPageCursors],
  );
  const creditQueue = useCreditOverrideQueue(queueFilters, creditBlock?.customerId != null);
  const createCreditRequest = useCreateCreditOverrideRequest([queueFilters]);
  const estimatedProposedAmount = creditBlock?.proposedAmount && creditBlock.proposedAmount > 0
    ? creditBlock.proposedAmount
    : Math.round((form.suggestedPrice ?? 0) * expectedContainerCount);

  React.useEffect(() => {
    if (!creditQueue.data || creditQueue.data.items.length > 0 || creditPageCursors.length === 1) return;
    setCreditPageCursors((current) => current.slice(0, -1));
  }, [creditPageCursors.length, creditQueue.data]);

  const submitTrip = async (creditApprovalRequestId?: number | null) => {
    const tripId = await form.handleSubmit(undefined, { creditApprovalRequestId });
    if (tripId) {
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
      setCreditPageCursors([null]);
      setCreditRequest(created);
      setCreditRequestIdInput(String(created.id));
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : 'Không thể tạo đề nghị vượt hạn mức.');
    } finally {
      setCreditAction(null);
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

  return (
    <TripFormProvider form={form}>
      <div ref={rootRef} className="tc-create-wrap">
        <section className="tc-create-hero">
          <div className="tc-hero-top">
            <button className="tc-back-btn" onClick={handleBack} aria-label="Quay lại">
              <ArrowLeft size={18} />
            </button>
            <div className="tc-hero-title-block">
              <h1 className="sr-only">Tạo lệnh vận chuyển mới</h1>
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
                <UuiSelectField
                  label="Đề nghị hiện có"
                  value={creditRequestIdInput}
                  onChange={(event) => setCreditRequestIdInput(event.target.value)}
                  options={[
                    { value: '', label: 'Chọn theo lý do và trạng thái' },
                    ...(creditQueue.data?.items ?? [])
                      .filter((request) => request.shipmentId == null && request.status !== 'CANCELED')
                      .map((request) => ({
                        value: String(request.id),
                        label: `${request.reason} · ${request.status === 'APPROVED' ? 'Đã duyệt' : request.status === 'REJECTED' ? 'Đã từ chối' : 'Chờ duyệt'}`
                      }))
                  ]}
                />
              </div>
            </div>

            {creditRequest && (
              <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.72)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <ShieldCheck size={16} />
                  <strong>Đề nghị vượt hạn mức</strong>
                  <span style={creditBadgeStyle}>{creditRequest.status === 'APPROVED' ? 'Đã duyệt' : 'Chờ duyệt'}</span>
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

                    </div>
                  ))}
                <Pagination
                  page={creditPageCursors.length}
                  totalPages={creditPageCursors.length + (creditQueue.data.nextCursor ? 1 : 0)}
                  summary={<span>Trang <b>{creditPageCursors.length}</b> · <b>{creditQueue.data.items.length}</b> đề nghị</span>}
                  onChange={(nextPage) => {
                    if (nextPage === creditPageCursors.length + 1 && creditQueue.data?.nextCursor) {
                      setCreditPageCursors((current) => [...current, creditQueue.data?.nextCursor ?? null]);
                    } else if (nextPage < creditPageCursors.length) {
                      setCreditPageCursors((current) => current.slice(0, nextPage));
                    }
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
                  ref={creditExpiryInput.ref}
                  defaultValue={creditExpiryInput.defaultValue}
                  onChange={creditExpiryInput.onChange}
                  onBlur={creditExpiryInput.onBlur}
                  className="input mono"
                  type="text"
                  inputMode="numeric"
                  placeholder={DATE_TIME_24_PLACEHOLDER}
                  maxLength={16}
                  autoComplete="off"
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
