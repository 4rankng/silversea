import type { Dispatch, SetStateAction } from 'react';
import { Loader2, Save, ShieldCheck } from 'lucide-react';
import type { AppSettings } from '@tingting/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { Panel } from '../../components/UI';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import type { BusinessUnit } from '../users/utils';
import type { useAppSettings, useSaveAppSettings } from '../../hooks/useAppSettings';

type OperationalPolicySectionProps = {
  appSettings: ReturnType<typeof useAppSettings>;
  saveAppSettings: ReturnType<typeof useSaveAppSettings>;
  features: AppSettings;
  setFeatures: Dispatch<SetStateAction<AppSettings>>;
  businessUnits: UseQueryResult<{ items: BusinessUnit[] }>;
  creditWarningPercent: string;
  setCreditWarningPercent: Dispatch<SetStateAction<string>>;
  creditThresholdValid: boolean;
  creditTierOneCap: string;
  setCreditTierOneCap: Dispatch<SetStateAction<string>>;
  creditTierCapValid: boolean;
  saveGeneralSettings: () => Promise<void>;
  generalMessage: string | null;
};

export function OperationalPolicySection({
  appSettings,
  saveAppSettings,
  features,
  setFeatures,
  businessUnits,
  creditWarningPercent,
  setCreditWarningPercent,
  creditThresholdValid,
  creditTierOneCap,
  setCreditTierOneCap,
  creditTierCapValid,
  saveGeneralSettings,
  generalMessage,
}: OperationalPolicySectionProps) {
  return (
    <Panel
      title="Chính sách vận hành"
      subtitle="Các ngưỡng và phạm vi áp dụng dùng chung trên toàn hệ thống"
      action={<ShieldCheck size={18} className="cfg-panel-action-icon" />}
    >
      <div className="cfg-section" style={{ display: 'grid', gap: 14 }}>
        <div className="field">
          <label htmlFor="credit-warning-threshold-default">Ngưỡng cảnh báo công nợ mặc định (%)</label>
          <input
            id="credit-warning-threshold-default"
            className="input"
            type="number"
            min="1"
            max="99"
            step="0.01"
            value={creditWarningPercent}
            onChange={(event) => setCreditWarningPercent(event.target.value)}
            disabled={appSettings.isLoading || appSettings.isError || saveAppSettings.isPending}
            aria-invalid={!creditThresholdValid || undefined}
            aria-describedby={!creditThresholdValid ? 'credit-threshold-error' : undefined}
          />
          {!creditThresholdValid && (
            <p id="credit-threshold-error" role="alert" className="cfg-field-error" style={{ color: 'var(--err, #dc2626)', margin: '4px 0 0', fontSize: 12 }}>
              Ngưỡng cảnh báo phải từ 1% đến 99%.
            </p>
          )}
          <p className="cfg-field-hint">
            Dùng chung khi khách hàng chưa cấu hình riêng. Hiện tại: {creditThresholdValid
              ? `${creditWarningPercent}%`
              : 'giá trị không hợp lệ'}
          </p>
        </div>
        <UuiSelectField
          id="salary-payroll-business-unit"
          label="Phạm vi chốt kỳ lương"
          value={features.salaryPayrollBusinessUnitId === null || features.salaryPayrollBusinessUnitId === undefined ? '' : String(features.salaryPayrollBusinessUnitId)}
          onChange={(event) => {
            const value = event.target.value;
            setFeatures((current) => ({
              ...current,
              salaryPayrollBusinessUnitId: value ? Number(value) : null,
            }));
          }}
          disabled={
            appSettings.isLoading
            || appSettings.isError
            || businessUnits.isLoading
            || businessUnits.isError
            || saveAppSettings.isPending
          }
          options={[
            { value: '', label: 'Toàn công ty' },
            ...(businessUnits.data?.items ?? [])
              .filter((unit) => unit.status === 'ACTIVE')
              .map((unit) => ({
                value: String(unit.id),
                label: unit.name,
              })),
          ]}
          hint="Khi chọn đơn vị, kiểm tra sẵn sàng và tổng lương chỉ gồm lái xe đang được gán vào đơn vị đó."
        />
        <div className="field">
          <label htmlFor="credit-tier-one-amount-cap">Ngưỡng tiền duyệt cấp 1 (VND)</label>
          <input
            id="credit-tier-one-amount-cap"
            className="input"
            type="number"
            min="0"
            step="1"
            value={creditTierOneCap}
            onChange={(event) => setCreditTierOneCap(event.target.value)}
            disabled={appSettings.isLoading || appSettings.isError || saveAppSettings.isPending}
            aria-invalid={!creditTierCapValid || undefined}
            aria-describedby={!creditTierCapValid ? 'credit-tier-cap-error' : undefined}
          />
          {!creditTierCapValid && (
            <p id="credit-tier-cap-error" role="alert" className="cfg-field-error" style={{ color: 'var(--err, #dc2626)', margin: '4px 0 0', fontSize: 12 }}>
              Ngưỡng tiền duyệt cấp 1 phải là số nguyên VND không âm.
            </p>
          )}
          <p className="cfg-field-hint">
            Cấp 1 chỉ được duyệt phần vượt không quá {creditTierCapValid
              ? formatCurrency(Number(creditTierOneCap))
              : 'một số nguyên không âm'}.
          </p>
        </div>
      </div>
      <div className="cfg-form-actions">
        <button
          className="btn btn--primary"
          disabled={
            !appSettings.data
            || appSettings.isError
            || saveAppSettings.isPending
            || !creditThresholdValid
            || !creditTierCapValid
          }
          onClick={() => { void saveGeneralSettings(); }}
        >
          {saveAppSettings.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
          {saveAppSettings.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}
        </button>
        {saveAppSettings.error && (
          <span role="alert" className="cfg-form-error">
            {saveAppSettings.error instanceof Error ? saveAppSettings.error.message : 'Không thể lưu cài đặt.'}
          </span>
        )}
        {generalMessage && !saveAppSettings.error && (
          <span role="status" className="cfg-field-hint">
            {generalMessage}
          </span>
        )}
        {appSettings.error && (
          <span role="alert" className="cfg-form-error">
            {appSettings.error instanceof Error ? appSettings.error.message : 'Không thể tải cài đặt.'}
          </span>
        )}
      </div>
    </Panel>
  );
}
