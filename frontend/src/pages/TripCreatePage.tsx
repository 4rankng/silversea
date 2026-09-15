import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
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
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { useConfirm } from '../components/UI';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency } from '../lib/format';
import './TripForm.css';
import './TripCreatePage.css';

export default function TripCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [exceptionReason, setExceptionReason] = React.useState('');
  const [exceptionCeiling, setExceptionCeiling] = React.useState('');
  const [exceptionError, setExceptionError] = React.useState('');
  const canRecordException = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const options = useTripOptions();
  const [creditBlock, setCreditBlock] = React.useState<{
    message: string;
    customerId: number;
    proposedAmount: number;
  } | null>(null);
  const form = useTripForm({
    options,
    onCreditLimitBlocked: (details) => {
      setCreditBlock(details);
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

  const estimatedProposedAmount = creditBlock?.proposedAmount && creditBlock.proposedAmount > 0
    ? creditBlock.proposedAmount
    : Math.round((form.suggestedPrice ?? 0) * expectedContainerCount);

  const submitTrip = async () => {
    const tripId = await form.handleSubmit(undefined);
    if (tripId) {
      navigate(`/trips/${tripId}`);
      return true;
    }
    return false;
  };

  const handleSubmit = async () => {
    await submitTrip();
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

          <details className="tc-create-summary">
            <summary>Ước tính & tiến độ <span>{form.requiredFieldsFilled}/{form.totalRequiredFields} trường bắt buộc · Lợi nhuận {formatCurrency(form.estimatedProfit)}</span></summary>
            <div className="tc-hero-widgets">
              <TripSummaryCard />
              <TripChecklistPanel />
            </div>
          </details>

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
              marginTop: 12,
              border: '1px solid rgba(217, 119, 6, 0.35)',
              background: 'rgba(245, 158, 11, 0.08)',
              borderRadius: 8,
              padding: 12,
              display: 'grid',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
              <div style={{ display: 'grid', gap: 6 }}>
                <strong>Vượt hạn mức công nợ</strong>
                <span style={{ color: 'var(--fg-2)', fontSize: 'var(--text-body-size)' }}>{creditBlock.message}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div style={creditMetricStyle}>
                <span style={creditMetricLabelStyle}>Giá trị chuyến dự kiến</span>
                <strong>{estimatedProposedAmount > 0 ? formatCurrency(estimatedProposedAmount) : 'Chưa xác định'}</strong>
              </div>
            </div>
            {canRecordException ? <div style={{ display: 'grid', gap: 8 }}>
              <p>Ghi nhận ngoại lệ một lần cho chuyến này. Hạn mức áp dụng đến lúc lưu; nếu lưu thất bại, ngoại lệ không được tạo.</p>
              <label htmlFor="credit-exception-reason">Lý do ngoại lệ</label>
              <input id="credit-exception-reason" className="form-input" value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} maxLength={1000} />
              <label htmlFor="credit-exception-ceiling">Tổng dư nợ và cam kết tối đa cho phép (₫)</label>
              <input id="credit-exception-ceiling" className="form-input" inputMode="numeric" value={exceptionCeiling} onChange={event => setExceptionCeiling(event.target.value)} />
              {exceptionError && <p role="alert" style={{ color: 'var(--danger)' }}>{exceptionError}</p>}
              <button type="button" className="btn btn--primary" disabled={form.submitting} onClick={async () => {
                const ceiling = Number(exceptionCeiling.replace(/[.,\s]/g, ''));
                if (!exceptionReason.trim() || !Number.isSafeInteger(ceiling) || ceiling <= 0) { setExceptionError('Nhập lý do và tổng hạn mức ngoại lệ hợp lệ.'); return; }
                setExceptionError('');
                const tripId = await form.handleSubmit(undefined, { creditException: { reason: exceptionReason.trim(), exposureCeiling: ceiling, scopeType: 'SHIPMENT', expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() } });
                if (tripId) navigate(`/trips/${tripId}`);
              }}>Ghi ngoại lệ và tạo chuyến</button>
            </div> : <p>Vai trò hiện tại không có quyền ghi ngoại lệ. Điều chỉnh dư nợ hoặc liên hệ Quản lý để xử lý tín dụng.</p>}
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

