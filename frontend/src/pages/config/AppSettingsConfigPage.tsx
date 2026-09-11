import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type AppSettings,
  type OcrSettingsUpdate,
} from '@tingting/shared';
import { useNavigate } from 'react-router-dom';
import { PageHeader, useConfirm } from '../../components/UI';
import {
  useAppSettings,
  useEmailSettings,
  useFinancialReportingPolicy,
  useRequestFinancialReportingPolicy,
  useRequestTruckFinancialProfile,
  useSaveAppSettings,
  useSaveEmailSettings,
  useTruckFinancialProfiles,
} from '../../hooks/useAppSettings';
import { useOcrSettings, useSaveOcrSettings } from '../../hooks/useOcrSettings';
import { usePageAnimations } from '../../hooks/animations';
import { userClient } from '../../api/userClient';
import { qk } from '../../api/keys';
import { FinancePolicySection, type FinanceTab } from '../../features/app-settings/FinancePolicySection';
import { OperationalPolicySection } from '../../features/app-settings/OperationalPolicySection';
import { OcrSection } from '../../features/app-settings/OcrSection';
import { EmailSection } from '../../features/app-settings/EmailSection';
import {
  formatViMonth,
  fromThresholdPercent,
  percentInputToNumber,
  ratioToPercentInput,
  toThresholdPercent,
} from '../../features/app-settings/formatters';
import './config-page.css';

/** ADMIN home for global switches and external-service credentials. */
export default function AppSettingsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.panel'] });
  const navigate = useNavigate();

  const appSettings = useAppSettings();
  const saveAppSettings = useSaveAppSettings();
  const emailSettings = useEmailSettings();
  const saveEmailSettings = useSaveEmailSettings();
  const financialPolicy = useFinancialReportingPolicy();
  const requestFinancialPolicy = useRequestFinancialReportingPolicy();
  const ocrSettings = useOcrSettings();
  const saveOcrSettings = useSaveOcrSettings();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [activeFinanceTab, setActiveFinanceTab] = useState<FinanceTab>('policy');

  const [features, setFeatures] = useState<AppSettings>({
    creditWarningThresholdDefault: 0.8,
    creditTierOneAmountCap: 0,
    salaryPayrollBusinessUnitId: null,
  });
  const [creditWarningPercent, setCreditWarningPercent] = useState('80');
  const [creditTierOneCap, setCreditTierOneCap] = useState('0');
  const businessUnits = useQuery({
    queryKey: qk.appSettings.businessUnits,
    queryFn: () => userClient.getBusinessUnits(),
  });
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [ocrOpenrouterKey, setOcrOpenrouterKey] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [generalMessage, setGeneralMessage] = useState<string | null>(null);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [policyEffectiveFrom, setPolicyEffectiveFrom] = useState('');
  const [policyThresholdPercent, setPolicyThresholdPercent] = useState('');
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(null);
  const truckProfiles = useTruckFinancialProfiles(selectedTruckId);
  const requestTruckProfile = useRequestTruckFinancialProfile();
  const [truckEffectiveFrom, setTruckEffectiveFrom] = useState('');
  const [truckAcquisitionCost, setTruckAcquisitionCost] = useState('');
  const [truckResidualValue, setTruckResidualValue] = useState('');
  const [truckInServiceDate, setTruckInServiceDate] = useState('');
  const [truckUsefulLifeMonths, setTruckUsefulLifeMonths] = useState('');
  const [truckMonthlyFixedCost, setTruckMonthlyFixedCost] = useState('');
  const [truckMessage, setTruckMessage] = useState<string | null>(null);
  const [truckError, setTruckError] = useState<string | null>(null);

  useEffect(() => {
    if (appSettings.data) {
      setFeatures(appSettings.data);
      setCreditWarningPercent(toThresholdPercent(appSettings.data.creditWarningThresholdDefault));
      setCreditTierOneCap(String(appSettings.data.creditTierOneAmountCap));
    }
  }, [appSettings.data]);

  useEffect(() => {
    if (ocrSettings.data) setOcrEnabled(ocrSettings.data.enabled);
  }, [ocrSettings.data]);

  useEffect(() => {
    if (!financialPolicy.data) return;
    setPolicyEffectiveFrom(financialPolicy.data.currentVietnamMonthStart);
    setPolicyThresholdPercent(
      ratioToPercentInput(financialPolicy.data.currentPolicy?.lowMarginThresholdRatio ?? null),
    );
  }, [financialPolicy.data]);

  useEffect(() => {
    if (selectedTruckId == null && truckProfiles.data?.selectedTruckId != null) {
      setSelectedTruckId(truckProfiles.data.selectedTruckId);
    }
  }, [selectedTruckId, truckProfiles.data?.selectedTruckId]);

  useEffect(() => {
    if (!truckProfiles.data) return;
    const current = truckProfiles.data.currentProfile;
    setTruckEffectiveFrom(truckProfiles.data.currentVietnamMonthStart);
    setTruckAcquisitionCost(current?.acquisitionCost ?? '');
    setTruckResidualValue(current?.residualValue ?? '');
    setTruckInServiceDate(current?.inServiceDate ?? '');
    setTruckUsefulLifeMonths(current?.usefulLifeMonths != null ? String(current.usefulLifeMonths) : '');
    setTruckMonthlyFixedCost(current?.monthlyFixedCost ?? '');
  }, [truckProfiles.data]);

  const saveGeneralSettings = async () => {
    const threshold = fromThresholdPercent(creditWarningPercent);
    if (threshold == null) {
      return;
    }
    const parsedCap = Number(creditTierOneCap);
    if (!Number.isFinite(parsedCap) || parsedCap < 0 || !Number.isInteger(parsedCap)) {
      return;
    }
    setGeneralMessage(null);
    await saveAppSettings.mutateAsync({
      ...(appSettings.data ?? features),
      creditWarningThresholdDefault: threshold,
      creditTierOneAmountCap: parsedCap,
      salaryPayrollBusinessUnitId: features.salaryPayrollBusinessUnitId,
    });
    setGeneralMessage('Đã lưu cài đặt ứng dụng.');
  };

  const saveOcr = async () => {
    setOcrMessage(null);
    const payload: OcrSettingsUpdate = { enabled: ocrEnabled };
    if (ocrOpenrouterKey.trim()) payload.openrouterApiKey = ocrOpenrouterKey.trim();
    try {
      await saveOcrSettings.mutateAsync(payload);
      setOcrOpenrouterKey('');
      setOcrMessage('Đã lưu cài đặt nhận dạng OCR.');
    } catch {
      setOcrMessage(null);
    }
  };

  const saveEmail = async () => {
    const replacement = resendApiKey.trim();
    if (!replacement) return;
    setEmailMessage(null);
    try {
      await saveEmailSettings.mutateAsync({ resendApiKey: replacement });
      setResendApiKey('');
      setEmailMessage('Đã lưu Resend API key.');
    } catch {
      setEmailMessage(null);
    }
  };

  const requestPolicy = async () => {
    setPolicyError(null);
    setPolicyMessage(null);
    if (!financialPolicy.data) return;
    if (!policyEffectiveFrom) {
      setPolicyError('Chọn tháng hiện tại hoặc một tháng trong tương lai. Không thể áp dụng ngược cho kỳ đã đóng.');
      return;
    }
    const lowMarginThresholdPercent = percentInputToNumber(policyThresholdPercent);
    if (policyThresholdPercent.trim() !== '' && lowMarginThresholdPercent == null) {
      setPolicyError('Ngưỡng cảnh báo phải là số từ 0% đến 100%.');
      return;
    }
    const confirmed = await confirm(
      `Gửi yêu cầu chính sách báo cáo hiệu lực từ ${formatViMonth(policyEffectiveFrom)}${lowMarginThresholdPercent == null ? ' và giữ trạng thái chưa cấu hình cảnh báo biên lợi nhuận?' : ` với ngưỡng cảnh báo biên lợi nhuận ${lowMarginThresholdPercent}%?`}`,
      { confirmLabel: 'Gửi yêu cầu', variant: 'primary' },
    );
    if (!confirmed) return;
    try {
      await requestFinancialPolicy.mutateAsync({
        expectedPublicVersion: financialPolicy.data.publicVersion,
        effectiveFrom: policyEffectiveFrom,
        lowMarginThresholdPercent,
      });
      setPolicyMessage('Đã gửi yêu cầu. Cấu hình hiện tại chưa thay đổi.');
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : 'Không thể gửi yêu cầu chính sách.');
    }
  };

  const requestTruckFinancialProfileVersion = async () => {
    setTruckError(null);
    setTruckMessage(null);
    if (!truckProfiles.data?.selectedTruckId) {
      setTruckError('Chọn xe đầu kéo trước khi tạo hồ sơ tài chính.');
      return;
    }
    if (!truckEffectiveFrom || !truckInServiceDate) {
      setTruckError('Tháng hiệu lực và ngày đưa vào sử dụng là bắt buộc.');
      return;
    }
    const usefulLifeMonths = Number(truckUsefulLifeMonths);
    if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
      setTruckError('Thời gian sử dụng phải là số nguyên lớn hơn 0.');
      return;
    }
    const payload = {
      expectedPublicVersion: truckProfiles.data.publicVersion,
      truckId: truckProfiles.data.selectedTruckId,
      effectiveFrom: truckEffectiveFrom,
      acquisitionCost: truckAcquisitionCost,
      residualValue: truckResidualValue,
      inServiceDate: truckInServiceDate,
      usefulLifeMonths,
      monthlyFixedCost: truckMonthlyFixedCost,
    } as const;
    const confirmed = await confirm(
      `Gửi hồ sơ tài chính cho xe ${truckProfiles.data.selectedTruckLabel} hiệu lực từ ${formatViMonth(truckEffectiveFrom)}?`,
      { confirmLabel: 'Gửi yêu cầu', variant: 'primary' },
    );
    if (!confirmed) return;
    try {
      await requestTruckProfile.mutateAsync(payload);
      setTruckMessage('Đã gửi yêu cầu. Cấu hình hiện tại chưa thay đổi.');
    } catch (error) {
      setTruckError(error instanceof Error ? error.message : 'Không thể gửi hồ sơ tài chính xe.');
    }
  };

  const clearEmail = async () => {
    const confirmed = await confirm(
      'Xóa Resend API key? Email hệ thống sẽ không thể gửi cho đến khi API key mới được cấu hình.',
      { confirmLabel: 'Xóa API key', variant: 'danger' },
    );
    if (!confirmed) return;
    setEmailMessage(null);
    try {
      await saveEmailSettings.mutateAsync({ clearResendApiKey: true });
      setResendApiKey('');
      setEmailMessage('Đã xóa Resend API key.');
    } catch {
      setEmailMessage(null);
    }
  };

  const ocrOpenrouterKeySet = !!ocrSettings.data?.openrouterKeySet;
  const ocrHasKey = ocrOpenrouterKeySet || ocrOpenrouterKey.trim() !== '';
  const ocrChanged = !!ocrSettings.data && (
    ocrSettings.data.enabled !== ocrEnabled
    || ocrOpenrouterKey.trim() !== ''
  );
  const creditThresholdValid = fromThresholdPercent(creditWarningPercent) != null;
  const creditTierCapValid = Number.isFinite(Number(creditTierOneCap))
    && Number(creditTierOneCap) >= 0
    && Number.isInteger(Number(creditTierOneCap));
  const financeState = activeFinanceTab === 'policy' ? financialPolicy.data : truckProfiles.data;
  const financePendingRequest = financeState?.pendingRequest ?? null;
  const policySubmitLabel = financialPolicy.data?.status === 'UNCONFIGURED'
    ? 'Tạo yêu cầu đầu tiên'
    : 'Gửi yêu cầu phê duyệt';
  const truckSubmitLabel = truckProfiles.data?.status === 'UNCONFIGURED'
    ? 'Tạo hồ sơ cho xe'
    : 'Gửi yêu cầu phê duyệt';

  const handleTruckSelectionChange = async (nextTruckId: number) => {
    const truckDraftDirty = Boolean(
      truckProfiles.data
        && (
          truckEffectiveFrom !== truckProfiles.data.currentVietnamMonthStart
          || truckAcquisitionCost !== (truckProfiles.data.currentProfile?.acquisitionCost ?? '')
          || truckResidualValue !== (truckProfiles.data.currentProfile?.residualValue ?? '')
          || truckInServiceDate !== (truckProfiles.data.currentProfile?.inServiceDate ?? '')
          || truckUsefulLifeMonths !== (truckProfiles.data.currentProfile?.usefulLifeMonths != null ? String(truckProfiles.data.currentProfile.usefulLifeMonths) : '')
          || truckMonthlyFixedCost !== (truckProfiles.data.currentProfile?.monthlyFixedCost ?? '')
        )
    );
    if (truckDraftDirty) {
      const confirmed = await confirm(
        'Đổi xe đầu kéo sẽ bỏ bản nháp chưa gửi. Tiếp tục?',
        { confirmLabel: 'Đổi xe', variant: 'warning' },
      );
      if (!confirmed) return;
    }
    setTruckError(null);
    setTruckMessage(null);
    setSelectedTruckId(nextTruckId);
  };

  return (
    <div ref={pageRef} className="cfg-page cfg-page--app-settings">
      <PageHeader
        title="Chính sách tài chính"
        description="Thiết lập chính sách báo cáo và hồ sơ tài chính xe theo tháng hiệu lực. Bản đã duyệt không thể sửa."
        onBack={() => navigate('/config')}
        iconName="app-settings"
      />

      <div className={`cfg-finance-strip ${financePendingRequest ? 'is-warning' : 'is-neutral'}`}>
        <div>
          <strong>Kỳ mở theo giờ Việt Nam:</strong>{' '}
          {financeState?.currentVietnamMonthStart ? `tháng ${formatViMonth(financeState.currentVietnamMonthStart)}` : 'đang tải…'}
        </div>
        {financePendingRequest ? (
          <div className="cfg-finance-strip__meta">
            <span>Đang chờ kiểm tra và phê duyệt cho {formatViMonth(financePendingRequest.effectiveFrom)}</span>
            <span>{financePendingRequest.requestedByName}</span>
            <a href={financePendingRequest.queuePath}>Xem yêu cầu chờ phê duyệt</a>
          </div>
        ) : (
          <div className="cfg-finance-strip__meta">
            <span>Chỉ được áp dụng từ tháng hiện tại hoặc một tháng trong tương lai.</span>
            <span>Không thể áp dụng ngược cho kỳ đã đóng.</span>
          </div>
        )}
      </div>

      <div className="cfg-app-settings-stack">
        <FinancePolicySection
          activeFinanceTab={activeFinanceTab}
          setActiveFinanceTab={setActiveFinanceTab}
          financialPolicy={financialPolicy}
          requestFinancialPolicy={requestFinancialPolicy}
          policyEffectiveFrom={policyEffectiveFrom}
          setPolicyEffectiveFrom={setPolicyEffectiveFrom}
          policyThresholdPercent={policyThresholdPercent}
          setPolicyThresholdPercent={setPolicyThresholdPercent}
          policySubmitLabel={policySubmitLabel}
          requestPolicy={requestPolicy}
          policyMessage={policyMessage}
          policyError={policyError}
          truckProfiles={truckProfiles}
          requestTruckProfile={requestTruckProfile}
          handleTruckSelectionChange={handleTruckSelectionChange}
          truckEffectiveFrom={truckEffectiveFrom}
          setTruckEffectiveFrom={setTruckEffectiveFrom}
          truckAcquisitionCost={truckAcquisitionCost}
          setTruckAcquisitionCost={setTruckAcquisitionCost}
          truckResidualValue={truckResidualValue}
          setTruckResidualValue={setTruckResidualValue}
          truckInServiceDate={truckInServiceDate}
          setTruckInServiceDate={setTruckInServiceDate}
          truckUsefulLifeMonths={truckUsefulLifeMonths}
          setTruckUsefulLifeMonths={setTruckUsefulLifeMonths}
          truckMonthlyFixedCost={truckMonthlyFixedCost}
          setTruckMonthlyFixedCost={setTruckMonthlyFixedCost}
          truckSubmitLabel={truckSubmitLabel}
          requestTruckFinancialProfileVersion={requestTruckFinancialProfileVersion}
          truckMessage={truckMessage}
          truckError={truckError}
        />

        <OperationalPolicySection
          appSettings={appSettings}
          saveAppSettings={saveAppSettings}
          features={features}
          setFeatures={setFeatures}
          businessUnits={businessUnits}
          creditWarningPercent={creditWarningPercent}
          setCreditWarningPercent={setCreditWarningPercent}
          creditThresholdValid={creditThresholdValid}
          creditTierOneCap={creditTierOneCap}
          setCreditTierOneCap={setCreditTierOneCap}
          creditTierCapValid={creditTierCapValid}
          saveGeneralSettings={saveGeneralSettings}
          generalMessage={generalMessage}
        />

        <OcrSection
          ocrSettings={ocrSettings}
          saveOcrSettings={saveOcrSettings}
          ocrEnabled={ocrEnabled}
          setOcrEnabled={setOcrEnabled}
          ocrOpenrouterKey={ocrOpenrouterKey}
          setOcrOpenrouterKey={setOcrOpenrouterKey}
          ocrOpenrouterKeySet={ocrOpenrouterKeySet}
          ocrHasKey={ocrHasKey}
          ocrChanged={ocrChanged}
          saveOcr={saveOcr}
          ocrMessage={ocrMessage}
        />

        <EmailSection
          emailSettings={emailSettings}
          saveEmailSettings={saveEmailSettings}
          resendApiKey={resendApiKey}
          setResendApiKey={setResendApiKey}
          saveEmail={saveEmail}
          clearEmail={clearEmail}
          emailMessage={emailMessage}
        />
      </div>
      {confirmDialog}
    </div>
  );
}
