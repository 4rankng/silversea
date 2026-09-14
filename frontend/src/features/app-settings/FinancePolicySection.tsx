import type { Dispatch, SetStateAction } from 'react';
import { Loader2, Save, ShieldCheck } from 'lucide-react';
import { Panel } from '../../components/UI';
import { DateInput } from '../../design-system/forms/DateInput';
import { UuiSelectField } from '../../design-system';
import type {
  useFinancialReportingPolicy,
  useRequestFinancialReportingPolicy,
  useRequestTruckFinancialProfile,
  useTruckFinancialProfiles,
} from '../../hooks/useAppSettings';
import { FinanceLoadingBlock, FinanceVersionList } from './FinanceVersionList';
import { FinancePolicyStatusCard } from './FinancePolicyStatusCard';
import { formatFullVnd, formatViDate } from './formatters';

export type FinanceTab = 'policy' | 'truck';

type FinancePolicySectionProps = {
  activeFinanceTab: FinanceTab;
  setActiveFinanceTab: Dispatch<SetStateAction<FinanceTab>>;
  financialPolicy: ReturnType<typeof useFinancialReportingPolicy>;
  requestFinancialPolicy: ReturnType<typeof useRequestFinancialReportingPolicy>;
  policyEffectiveFrom: string;
  setPolicyEffectiveFrom: Dispatch<SetStateAction<string>>;
  policyThresholdPercent: string;
  setPolicyThresholdPercent: Dispatch<SetStateAction<string>>;
  policySubmitLabel: string;
  requestPolicy: () => Promise<void>;
  policyMessage: string | null;
  policyError: string | null;
  truckProfiles: ReturnType<typeof useTruckFinancialProfiles>;
  requestTruckProfile: ReturnType<typeof useRequestTruckFinancialProfile>;
  handleTruckSelectionChange: (nextTruckId: number) => Promise<void>;
  truckEffectiveFrom: string;
  setTruckEffectiveFrom: Dispatch<SetStateAction<string>>;
  truckAcquisitionCost: string;
  setTruckAcquisitionCost: Dispatch<SetStateAction<string>>;
  truckResidualValue: string;
  setTruckResidualValue: Dispatch<SetStateAction<string>>;
  truckInServiceDate: string;
  setTruckInServiceDate: Dispatch<SetStateAction<string>>;
  truckUsefulLifeMonths: string;
  setTruckUsefulLifeMonths: Dispatch<SetStateAction<string>>;
  truckMonthlyFixedCost: string;
  setTruckMonthlyFixedCost: Dispatch<SetStateAction<string>>;
  truckSubmitLabel: string;
  requestTruckFinancialProfileVersion: () => Promise<void>;
  truckMessage: string | null;
  truckError: string | null;
};

export function FinancePolicySection({
  activeFinanceTab,
  setActiveFinanceTab,
  financialPolicy,
  requestFinancialPolicy,
  policyEffectiveFrom,
  setPolicyEffectiveFrom,
  policyThresholdPercent,
  setPolicyThresholdPercent,
  policySubmitLabel,
  requestPolicy,
  policyMessage,
  policyError,
  truckProfiles,
  requestTruckProfile,
  handleTruckSelectionChange,
  truckEffectiveFrom,
  setTruckEffectiveFrom,
  truckAcquisitionCost,
  setTruckAcquisitionCost,
  truckResidualValue,
  setTruckResidualValue,
  truckInServiceDate,
  setTruckInServiceDate,
  truckUsefulLifeMonths,
  setTruckUsefulLifeMonths,
  truckMonthlyFixedCost,
  setTruckMonthlyFixedCost,
  truckSubmitLabel,
  requestTruckFinancialProfileVersion,
  truckMessage,
  truckError,
}: FinancePolicySectionProps) {
  return (
    <Panel
      title="Thiết lập chính sách tài chính"
      subtitle="Tạo phiên bản mới theo tháng hiệu lực, không sửa trực tiếp bản hiện hành"
      action={<ShieldCheck size={18} className="cfg-panel-action-icon" />}
    >
      <div className="cfg-finance-tabs" role="tablist" aria-label="Nhóm chính sách tài chính">
        <button
          type="button"
          className={`cfg-finance-tab ${activeFinanceTab === 'policy' ? 'is-active' : ''}`}
          onClick={() => setActiveFinanceTab('policy')}
          role="tab"
          aria-selected={activeFinanceTab === 'policy'}
        >
          Chính sách báo cáo
        </button>
        <button
          type="button"
          className={`cfg-finance-tab ${activeFinanceTab === 'truck' ? 'is-active' : ''}`}
          onClick={() => setActiveFinanceTab('truck')}
          role="tab"
          aria-selected={activeFinanceTab === 'truck'}
        >
          Hồ sơ tài chính xe
        </button>
      </div>

      {activeFinanceTab === 'policy' ? (
        financialPolicy.isLoading ? (
          <FinanceLoadingBlock />
        ) : financialPolicy.error ? (
          <div className="cfg-form-error" role="alert">
            {financialPolicy.error instanceof Error
              ? financialPolicy.error.message
              : 'Không tải được chính sách. Kiểm tra kết nối và thử lại.'}
          </div>
        ) : (
          <div className="cfg-finance-workspace">
            <div className="cfg-finance-summary">
              <FinancePolicyStatusCard data={(financialPolicy.data ?? null) as Record<string, unknown> | null} />

              <FinanceVersionList
                title="Lịch sử phiên bản"
                emptyMessage="Chưa có lịch sử phiên bản."
                rows={financialPolicy.data?.history ?? []}
                renderMeta={(row) => {
                  const current = financialPolicy.data?.history.find((item) => item.id === row.id);
                  return (
                    <>
                      <span>{current?.depreciationMethodLabel}</span>
                      <span>{current?.allocationBasisLabel}</span>
                      <span>
                        {current?.lowMarginThresholdPercent == null
                          ? 'Chưa cấu hình cảnh báo biên lợi nhuận'
                          : `${current.lowMarginThresholdPercent}%`}
                      </span>
                    </>
                  );
                }}
              />
            </div>

            <div className="cfg-finance-form">
              <div className="cfg-section__heading-row">
                <h3 className="cfg-section__heading">Tạo phiên bản mới</h3>
              </div>
              <div className="field">
                <label htmlFor="financial-policy-effective-from">Tháng hiệu lực</label>
                <DateInput
                  id="financial-policy-effective-from"
                  className="input"
                  value={policyEffectiveFrom}
                  onChange={setPolicyEffectiveFrom}
                  min={financialPolicy.data?.currentVietnamMonthStart}
                  disabled={requestFinancialPolicy.isPending}
                  aria-invalid={policyError?.includes('tháng') ? true : undefined}
                  aria-describedby={policyError?.includes('tháng') ? 'policy-effective-error' : undefined}
                />
                {/* One version per month by design: months already carrying a
                    version must be visible as taken BEFORE the user submits —
                    otherwise a correct 409 reads as a broken apply loop. */}
                {(() => {
                  const taken = (financialPolicy.data?.history ?? [])
                    .find((h) => h.effectiveFrom === policyEffectiveFrom);
                  if (!taken) return null;
                  return (
                    <p role="alert" className="cfg-field-hint" style={{ color: 'var(--err, #dc2626)' }}>
                      Tháng này đã có phiên bản — xem "Lịch sử phiên bản" hoặc chọn tháng khác.
                    </p>
                  );
                })()}
                <p className="cfg-field-hint">
                  Chọn tháng hiện tại hoặc một tháng trong tương lai. Không thể áp dụng ngược cho kỳ đã đóng.
                </p>
              </div>
              <div className="field">
                <label htmlFor="financial-policy-threshold-percent">Ngưỡng cảnh báo biên lợi nhuận (%)</label>
                <input
                  id="financial-policy-threshold-percent"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  value={policyThresholdPercent}
                  onChange={(event) => setPolicyThresholdPercent(event.target.value)}
                  disabled={requestFinancialPolicy.isPending}
                  aria-invalid={policyError?.includes('Ngưỡng') ? true : undefined}
                  aria-describedby={policyError?.includes('Ngưỡng') ? 'policy-threshold-error' : undefined}
                />
                <p className="cfg-field-hint">
                  Để trống nếu chưa cấu hình cảnh báo biên lợi nhuận.
                </p>
              </div>
              <div className="cfg-finance-static-list">
                <div>
                  <span>Khấu hao</span>
                  <strong>Đường thẳng</strong>
                </div>
                <div>
                  <span>Phân bổ</span>
                  <strong>Tỷ trọng doanh thu chuyến hoàn thành</strong>
                </div>
              </div>
              {policyError && (
                <p
                  id={policyError?.includes('tháng') ? 'policy-effective-error' : policyError?.includes('Ngưỡng') ? 'policy-threshold-error' : undefined}
                  role="alert"
                  className="cfg-form-error"
                >
                  {policyError}
                </p>
              )}
              {requestFinancialPolicy.error && !policyError && (
                <p role="alert" className="cfg-form-error">
                  {requestFinancialPolicy.error instanceof Error
                    ? requestFinancialPolicy.error.message
                    : 'Không thể gửi yêu cầu chính sách.'}
                </p>
              )}
              <div className="cfg-form-actions">
                <button
                  className="btn btn--primary"
                  disabled={requestFinancialPolicy.isPending || !financialPolicy.data}
                  onClick={() => { void requestPolicy(); }}
                >
                  {requestFinancialPolicy.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                  {requestFinancialPolicy.isPending ? 'Đang gửi…' : policySubmitLabel}
                </button>
                {policyMessage && <span className="cfg-form-success" role="status">{policyMessage}</span>}
              </div>
            </div>
          </div>
        )
      ) : truckProfiles.isLoading ? (
        <FinanceLoadingBlock />
      ) : truckProfiles.error ? (
        <div className="cfg-form-error" role="alert">
          {truckProfiles.error instanceof Error
            ? truckProfiles.error.message
            : 'Không tải được hồ sơ tài chính xe. Kiểm tra kết nối và thử lại.'}
        </div>
      ) : (
        <div className="cfg-finance-workspace">
          <div className="cfg-finance-summary">
            <div className="cfg-finance-summary__section">
              <UuiSelectField
                id="truck-financial-profile-truck"
                label="Xe đầu kéo"
                value={truckProfiles.data?.selectedTruckId === null || truckProfiles.data?.selectedTruckId === undefined ? '' : String(truckProfiles.data?.selectedTruckId)}
                onChange={(event) => {
                  const nextTruckId = Number(event.target.value);
                  if (Number.isInteger(nextTruckId) && nextTruckId > 0) {
                    void handleTruckSelectionChange(nextTruckId);
                  }
                }}
                disabled={(truckProfiles.data?.trucks.length ?? 0) === 0}
                options={(truckProfiles.data?.trucks ?? []).map((truck) => ({
                  value: String(truck.id),
                  label: truck.label,
                }))}
              />
              {truckProfiles.data?.status === 'UNCONFIGURED' ? (
                <div className="cfg-finance-note cfg-finance-note--warning">
                  <strong>Xe này chưa có hồ sơ tài chính</strong>
                  <p>Khấu hao và chi phí cố định theo tháng sẽ tiếp tục hiển thị chưa phân bổ.</p>
                </div>
              ) : (
                <dl className="cfg-finance-summary__grid">
                  <div>
                    <dt>Hiệu lực từ</dt>
                    <dd>{truckProfiles.data?.currentProfile ? formatViDate(truckProfiles.data.currentProfile.effectiveFrom) : 'Chưa cấu hình'}</dd>
                  </div>
                  <div>
                    <dt>Phiên bản</dt>
                    <dd>{truckProfiles.data?.currentProfile?.version ?? 'Chưa cấu hình'}</dd>
                  </div>
                  <div>
                    <dt>Nguyên giá</dt>
                    <dd>{truckProfiles.data?.currentProfile ? formatFullVnd(truckProfiles.data.currentProfile.acquisitionCost) : '0'} VND</dd>
                  </div>
                  <div>
                    <dt>Giá trị thu hồi</dt>
                    <dd>{truckProfiles.data?.currentProfile ? formatFullVnd(truckProfiles.data.currentProfile.residualValue) : '0'} VND</dd>
                  </div>
                  <div>
                    <dt>Ngày đưa vào sử dụng</dt>
                    <dd>{truckProfiles.data?.currentProfile ? formatViDate(truckProfiles.data.currentProfile.inServiceDate) : 'Chưa cấu hình'}</dd>
                  </div>
                  <div>
                    <dt>Thời gian sử dụng</dt>
                    <dd>{truckProfiles.data?.currentProfile?.usefulLifeMonths ?? '0'} tháng</dd>
                  </div>
                  <div>
                    <dt>Chi phí cố định mỗi tháng</dt>
                    <dd>{truckProfiles.data?.currentProfile ? formatFullVnd(truckProfiles.data.currentProfile.monthlyFixedCost) : '0'} VND</dd>
                  </div>
                </dl>
              )}
            </div>

            <FinanceVersionList
              title="Lịch sử theo xe"
              emptyMessage="Chưa có lịch sử hồ sơ tài chính cho xe này."
              rows={truckProfiles.data?.history ?? []}
              renderMeta={(row) => {
                const current = truckProfiles.data?.history.find((item) => item.id === row.id);
                return (
                  <>
                    <span>Nguyên giá {current ? formatFullVnd(current.acquisitionCost) : '0'} VND</span>
                    <span>Giá trị thu hồi {current ? formatFullVnd(current.residualValue) : '0'} VND</span>
                    <span>Chi phí cố định {current ? formatFullVnd(current.monthlyFixedCost) : '0'} VND</span>
                  </>
                );
              }}
            />
          </div>

          <div className="cfg-finance-form">
            <div className="cfg-section__heading-row">
              <h3 className="cfg-section__heading">Tạo hồ sơ theo tháng</h3>
            </div>
            <div className="cfg-finance-form__grid">
              <div className="field">
                <label htmlFor="truck-effective-from">Tháng hiệu lực</label>
                <DateInput
                  id="truck-effective-from"
                  className="input"
                  value={truckEffectiveFrom}
                  min={truckProfiles.data?.currentVietnamMonthStart}
                  onChange={setTruckEffectiveFrom}
                  disabled={requestTruckProfile.isPending}
                  aria-invalid={truckError?.includes('Tháng hiệu lực') ? true : undefined}
                  aria-describedby={truckError?.includes('Tháng hiệu lực') ? 'truck-effective-error' : undefined}
                />
              </div>
              <div className="field">
                <label htmlFor="truck-in-service-date">Ngày đưa vào sử dụng</label>
                <DateInput
                  id="truck-in-service-date"
                  className="input"
                  value={truckInServiceDate}
                  onChange={setTruckInServiceDate}
                  disabled={requestTruckProfile.isPending}
                  aria-invalid={truckError?.includes('ngày đưa vào sử dụng') ? true : undefined}
                  aria-describedby={truckError?.includes('ngày đưa vào sử dụng') ? 'truck-effective-error' : undefined}
                />
              </div>
              <div className="field">
                <label htmlFor="truck-acquisition-cost">Nguyên giá (VND)</label>
                <input
                  id="truck-acquisition-cost"
                  className="input"
                  inputMode="numeric"
                  value={truckAcquisitionCost}
                  onChange={(event) => setTruckAcquisitionCost(event.target.value)}
                  disabled={requestTruckProfile.isPending}
                />
                <p className="cfg-field-hint">{truckAcquisitionCost ? `${formatFullVnd(truckAcquisitionCost)} VND` : 'Nhập đầy đủ số tiền VND'}</p>
              </div>
              <div className="field">
                <label htmlFor="truck-residual-value">Giá trị thu hồi (VND)</label>
                <input
                  id="truck-residual-value"
                  className="input"
                  inputMode="numeric"
                  value={truckResidualValue}
                  onChange={(event) => setTruckResidualValue(event.target.value)}
                  disabled={requestTruckProfile.isPending}
                />
                <p className="cfg-field-hint">{truckResidualValue ? `${formatFullVnd(truckResidualValue)} VND` : 'Nhập đầy đủ số tiền VND'}</p>
              </div>
              <div className="field">
                <label htmlFor="truck-useful-life-months">Thời gian sử dụng (tháng)</label>
                <input
                  id="truck-useful-life-months"
                  className="input"
                  inputMode="numeric"
                  value={truckUsefulLifeMonths}
                  onChange={(event) => setTruckUsefulLifeMonths(event.target.value)}
                  disabled={requestTruckProfile.isPending}
                  aria-invalid={truckError?.includes('Thời gian sử dụng') ? true : undefined}
                  aria-describedby={truckError?.includes('Thời gian sử dụng') ? 'truck-life-error' : undefined}
                />
                {truckError?.includes('Thời gian sử dụng') && (
                  <p id="truck-life-error" role="alert" className="cfg-field-error" style={{ color: 'var(--err, #dc2626)', margin: '4px 0 0', fontSize: 12 }}>
                    {truckError}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="truck-monthly-fixed-cost">Chi phí cố định mỗi tháng (VND)</label>
                <input
                  id="truck-monthly-fixed-cost"
                  className="input"
                  inputMode="numeric"
                  value={truckMonthlyFixedCost}
                  onChange={(event) => setTruckMonthlyFixedCost(event.target.value)}
                  disabled={requestTruckProfile.isPending}
                />
                <p className="cfg-field-hint">{truckMonthlyFixedCost ? `${formatFullVnd(truckMonthlyFixedCost)} VND` : 'Nhập đầy đủ số tiền VND'}</p>
              </div>
            </div>
            {truckError && !truckError?.includes('Thời gian sử dụng') && (
              <p
                id={truckError?.includes('Tháng hiệu lực') || truckError?.includes('ngày đưa vào sử dụng') ? 'truck-effective-error' : undefined}
                role="alert"
                className="cfg-form-error"
              >
                {truckError}
              </p>
            )}
            {requestTruckProfile.error && !truckError && (
              <p role="alert" className="cfg-form-error">
                {requestTruckProfile.error instanceof Error
                  ? requestTruckProfile.error.message
                  : 'Không thể gửi hồ sơ tài chính xe.'}
              </p>
            )}
            <div className="cfg-form-actions">
              <button
                className="btn btn--primary"
                disabled={requestTruckProfile.isPending || truckProfiles.data?.selectedTruckId == null}
                onClick={() => { void requestTruckFinancialProfileVersion(); }}
              >
                {requestTruckProfile.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                {requestTruckProfile.isPending ? 'Đang gửi…' : truckSubmitLabel}
              </button>
              {truckMessage && <span className="cfg-form-success" role="status">{truckMessage}</span>}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
