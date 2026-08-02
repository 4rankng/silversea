import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MapPin,
  Save,
  ScanLine,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDER_MODELS,
  type AppSettings,
  type LlmProvider,
  type LlmSettingsUpdate,
  type OcrSettingsUpdate,
} from '@tingting/shared';
import { PageHeader, Panel, useConfirm } from '../../components/UI';
import { formatCurrency } from '../../lib/format';
import {
  useAppSettings,
  useEmailSettings,
  useSaveAppSettings,
  useSaveEmailSettings,
} from '../../hooks/useAppSettings';
import { useGpsSettings, useSaveGpsSettings } from '../../hooks/useGpsSettings';
import { useLlmSettings, useSaveLlmSettings } from '../../hooks/useLlmSettings';
import { useOcrSettings, useSaveOcrSettings } from '../../hooks/useOcrSettings';
import { usePageAnimations } from '../../hooks/animations';
import { userClient } from '../../api/userClient';
import { qk } from '../../api/keys';
import { isGovernancePendingResponse } from '../../lib/governance';
import './config-page.css';

type FeatureSwitchProps = {
  icon: ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onChange: () => void;
  disabled: boolean;
};

function FeatureSwitch({ icon, label, description, enabled, onChange, disabled }: FeatureSwitchProps) {
  const descriptionId = useId();

  return (
    <div className="cfg-section cfg-feature">
      <button
        type="button"
        className="cfg-feature__button"
        role="switch"
        aria-checked={enabled}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={onChange}
      >
        <span className="cfg-feature__icon" aria-hidden="true">{icon}</span>
        <span className="cfg-feature__copy">
          <span className="cfg-feature__label">{label}</span>
          <span id={descriptionId} className="cfg-feature__description">{description}</span>
          <span className="cfg-feature__state">{enabled ? 'Đang bật' : 'Đang tắt'}</span>
        </span>
        <span className={`cfg-toggle ${enabled ? 'is-on' : ''}`} aria-hidden="true">
          <span className="cfg-toggle-knob" />
        </span>
      </button>
    </div>
  );
}

function toThresholdPercent(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10000) / 100) : '80';
}

function fromThresholdPercent(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const ratio = parsed / 100;
  if (ratio < 0.01 || ratio > 0.99) return null;
  return Math.round(ratio * 10000) / 10000;
}

type SecretFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  saved: boolean;
  maskedPreview: string;
  placeholder: string;
  disabled?: boolean;
};

function SecretField({
  id,
  label,
  value,
  onChange,
  saved,
  maskedPreview,
  placeholder,
  disabled = false,
}: SecretFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field cfg-secret-field">
      <label htmlFor={id}>
        {label}
        {saved && <span className="cfg-section__heading-pill">Đã lưu</span>}
      </label>
      <div className="cfg-secret-input">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={saved ? `Đã lưu (${maskedPreview}) — nhập để thay đổi` : placeholder}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
        />
        <button
          type="button"
          className="cfg-secret-input__toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Ẩn ${label}` : `Hiện ${label}`}
          disabled={disabled}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      <p className="cfg-field-hint">
        {saved
          ? 'Để trống để giữ giá trị hiện tại. Nhập giá trị mới để thay thế.'
          : 'Chưa cấu hình. Vui lòng nhập giá trị để kết nối.'}
      </p>
    </div>
  );
}

/** ADMIN home for global switches and external-service credentials. */
export default function AppSettingsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.panel'] });
  const navigate = useNavigate();

  const appSettings = useAppSettings();
  const saveAppSettings = useSaveAppSettings();
  const emailSettings = useEmailSettings();
  const saveEmailSettings = useSaveEmailSettings();
  const llmSettings = useLlmSettings();
  const saveLlmSettings = useSaveLlmSettings();
  const ocrSettings = useOcrSettings();
  const saveOcrSettings = useSaveOcrSettings();
  const gpsSettings = useGpsSettings();
  const saveGpsSettings = useSaveGpsSettings();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [features, setFeatures] = useState<AppSettings>({
    botEnabled: false,
    gpsEnabled: false,
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
  const [provider, setProvider] = useState<LlmProvider>('minimax');
  const [minimaxKey, setMinimaxKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [ocrOpenrouterKey, setOcrOpenrouterKey] = useState('');
  const [ocrGeminiKey, setOcrGeminiKey] = useState('');
  const [gpsUsername, setGpsUsername] = useState('');
  const [gpsPassword, setGpsPassword] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [generalMessage, setGeneralMessage] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  useEffect(() => {
    if (appSettings.data) {
      setFeatures(appSettings.data);
      setCreditWarningPercent(toThresholdPercent(appSettings.data.creditWarningThresholdDefault));
      setCreditTierOneCap(String(appSettings.data.creditTierOneAmountCap));
    }
  }, [appSettings.data]);

  useEffect(() => {
    if (llmSettings.data) setProvider(llmSettings.data.provider);
  }, [llmSettings.data]);

  useEffect(() => {
    if (ocrSettings.data) setOcrEnabled(ocrSettings.data.enabled);
  }, [ocrSettings.data]);

  useEffect(() => {
    if (gpsSettings.data) setGpsUsername(gpsSettings.data.username);
  }, [gpsSettings.data]);

  const updateFeature = (key: keyof AppSettings) => {
    setFeatures((current) => ({ ...current, [key]: !current[key] }));
  };

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
    const result = await saveAppSettings.mutateAsync({
      ...(appSettings.data ?? features),
      creditWarningThresholdDefault: threshold,
      creditTierOneAmountCap: parsedCap,
      salaryPayrollBusinessUnitId: features.salaryPayrollBusinessUnitId,
    });
    if (isGovernancePendingResponse(result)) {
      setGeneralMessage('Đã gửi yêu cầu cập nhật cài đặt ứng dụng để kiểm tra và phê duyệt. Cấu hình hiện chưa thay đổi.');
      return;
    }
    setGeneralMessage('Đã lưu cài đặt ứng dụng.');
  };

  const saveChatbot = async () => {
    setAiMessage(null);
    const payload: LlmSettingsUpdate = { provider };
    if (minimaxKey.trim()) payload.minimaxApiKey = minimaxKey.trim();
    if (openrouterKey.trim()) payload.openrouterApiKey = openrouterKey.trim();
    const providerChanged = llmSettings.data?.provider !== provider;
    const credentialsChanged = !!(payload.minimaxApiKey || payload.openrouterApiKey);
    const botToggleChanged = appSettings.data?.botEnabled !== features.botEnabled;
    try {
      // Configure the provider before enabling the launcher, so there is no
      // window where users can open a chatbot whose selected provider has no
      // key. Disabling takes effect first for the inverse reason.
      if (botToggleChanged && !features.botEnabled) {
        await saveAppSettings.mutateAsync({
          ...(appSettings.data ?? features),
          botEnabled: features.botEnabled,
        });
      }
      if (providerChanged || credentialsChanged) {
        await saveLlmSettings.mutateAsync(payload);
      }
      if (botToggleChanged && features.botEnabled) {
        await saveAppSettings.mutateAsync({
          ...(appSettings.data ?? features),
          botEnabled: features.botEnabled,
        });
      }
      setMinimaxKey('');
      setOpenrouterKey('');
      setAiMessage('Đã lưu cài đặt trợ lý ảo.');
    } catch {
      setAiMessage(null);
    }
  };

  const saveOcr = async () => {
    setOcrMessage(null);
    const payload: OcrSettingsUpdate = { enabled: ocrEnabled };
    if (ocrOpenrouterKey.trim()) payload.openrouterApiKey = ocrOpenrouterKey.trim();
    if (ocrGeminiKey.trim()) payload.geminiApiKey = ocrGeminiKey.trim();
    try {
      await saveOcrSettings.mutateAsync(payload);
      setOcrOpenrouterKey('');
      setOcrGeminiKey('');
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

  const saveGps = async () => {
    setGpsMessage(null);
    try {
      // The gpsEnabled toggle lives in this panel, so saving the panel must
      // also persist the toggle. Previously only the credentials were saved
      // here, which silently dropped the toggle flip — a user who turned GPS
      // off in this panel and then refreshed found it back on.
      const tasks: Promise<unknown>[] = [];
      const previous = appSettings.data;
      if (previous && previous.gpsEnabled !== features.gpsEnabled) {
        tasks.push(saveAppSettings.mutateAsync({
          ...previous,
          gpsEnabled: features.gpsEnabled,
        }));
      }
      // Credentials are only meaningful while GPS is on. When the user has
      // also typed something into the credential fields, send them along.
      const hasCredentialEdit = gpsUsername.trim() !== '' || gpsPassword.trim() !== '';
      if (features.gpsEnabled && hasCredentialEdit) {
        tasks.push(
          saveGpsSettings.mutateAsync({
            username: gpsUsername.trim(),
            ...(gpsPassword.trim() ? { password: gpsPassword } : {}),
          }),
        );
      }
      if (tasks.length === 0) return;
      await Promise.all(tasks);
      setGpsPassword('');
      setGpsMessage('Đã lưu cài đặt định vị Bách Khoa.');
    } catch {
      setGpsMessage(null);
    }
  };

  const models = llmSettings.data?.models ?? LLM_PROVIDER_MODELS;
  const minimaxKeySet = !!llmSettings.data?.minimaxKeySet;
  const openrouterKeySet = !!llmSettings.data?.openrouterKeySet;
  const chosenKeyReady = provider === 'openrouter'
    ? openrouterKeySet || openrouterKey.trim() !== ''
    : minimaxKeySet || minimaxKey.trim() !== '';
  const chatbotToggleChanged = !!appSettings.data
    && appSettings.data.botEnabled !== features.botEnabled;
  const chatbotProviderChanged = !!llmSettings.data && llmSettings.data.provider !== provider;
  const chatbotCredentialsChanged = minimaxKey.trim() !== '' || openrouterKey.trim() !== '';
  const chatbotCanSave = chatbotToggleChanged || chatbotProviderChanged || chatbotCredentialsChanged;
  const chatbotNeedsReadyProvider = features.botEnabled || chatbotProviderChanged || chatbotCredentialsChanged;
  const ocrOpenrouterKeySet = !!ocrSettings.data?.openrouterKeySet;
  const ocrGeminiKeySet = !!ocrSettings.data?.geminiKeySet;
  const ocrHasKey = ocrOpenrouterKeySet
    || ocrGeminiKeySet
    || ocrOpenrouterKey.trim() !== ''
    || ocrGeminiKey.trim() !== '';
  const ocrChanged = !!ocrSettings.data && (
    ocrSettings.data.enabled !== ocrEnabled
    || ocrOpenrouterKey.trim() !== ''
    || ocrGeminiKey.trim() !== ''
  );
  // Credentials are only required while the feature is enabled. When off, the
  // fields are disabled and the save button stays inert — no validation pressure.
  const gpsCredsRequired = features.gpsEnabled;
  // The save button must also be enabled when the user has only flipped the
  // gpsEnabled toggle in this panel — otherwise the toggle flip is lost on
  // refresh because "Lưu cài đặt" (the only place that persists app_settings)
  // sits in a different panel above.
  const gpsToggleChanged = !!appSettings.data && appSettings.data.gpsEnabled !== features.gpsEnabled;
  const gpsReady = gpsToggleChanged
    || (gpsCredsRequired
      && gpsUsername.trim() !== ''
      && (gpsSettings.data?.passwordSet || gpsPassword.trim() !== ''));
  const creditThresholdValid = fromThresholdPercent(creditWarningPercent) != null;
  const creditTierCapValid = Number.isFinite(Number(creditTierOneCap))
    && Number(creditTierOneCap) >= 0
    && Number.isInteger(Number(creditTierOneCap));

  return (
    <div ref={pageRef} className="cfg-page cfg-page--app-settings">
      <PageHeader
        title="Cài đặt ứng dụng"
        description="Quản lý tính năng và kết nối dùng chung trên toàn hệ thống · chỉ Quản trị viên"
        onBack={() => navigate('/config')}
        iconName="app-settings"
      />

      <div className="cfg-app-settings-stack">
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
              />
              <p className="cfg-field-hint">
                Dùng chung khi khách hàng chưa cấu hình riêng. Hiện tại: {creditThresholdValid
                  ? `${creditWarningPercent}%`
                  : 'giá trị không hợp lệ'}
              </p>
            </div>
            <div className="field">
              <label htmlFor="salary-payroll-business-unit">Phạm vi chốt kỳ lương</label>
              <select
                id="salary-payroll-business-unit"
                className="input"
                value={features.salaryPayrollBusinessUnitId ?? ''}
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
              >
                <option value="">Toàn công ty</option>
                {(businessUnits.data?.items ?? [])
                  .filter((unit) => unit.status === 'ACTIVE')
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
              </select>
              <p className="cfg-field-hint">
                Khi chọn đơn vị, kiểm tra sẵn sàng và tổng lương chỉ gồm lái xe đang được gán vào đơn vị đó.
              </p>
            </div>
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
              />
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
            {!creditThresholdValid && (
              <span role="alert" className="cfg-form-error">
                Ngưỡng cảnh báo phải từ 1% đến 99%.
              </span>
            )}
            {creditThresholdValid && !creditTierCapValid && (
              <span role="alert" className="cfg-form-error">
                Ngưỡng tiền duyệt cấp 1 phải là số nguyên VND không âm.
              </span>
            )}
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

        <Panel
          title="Trợ lý ảo"
          subtitle="Bật hoặc tắt chatbot và quản lý nhà cung cấp AI trong cùng một nơi"
          action={<Bot size={18} className="cfg-panel-action-icon" />}
        >
          <FeatureSwitch
            icon={<Bot size={19} />}
            label="Sử dụng trợ lý ảo"
            description="Cho phép người dùng văn phòng mở và sử dụng chatbot trong ứng dụng. API key bên dưới được giữ lại khi tắt."
            enabled={features.botEnabled}
            onChange={() => updateFeature('botEnabled')}
            disabled={
              appSettings.isLoading
              || appSettings.isError
              || saveAppSettings.isPending
              || saveLlmSettings.isPending
            }
          />
          <div className="cfg-security-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>API key được mã hóa khi lưu. Giá trị đầy đủ không bao giờ gửi lại trình duyệt.</span>
          </div>
          <fieldset className="cfg-section cfg-provider-fieldset">
            <legend className="cfg-section__heading">Nhà cung cấp</legend>
            <div className="cfg-provider-grid">
              {LLM_PROVIDERS.map((item) => (
                <label key={item} className={`cfg-provider-option ${provider === item ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="llm-provider"
                    checked={provider === item}
                    onChange={() => setProvider(item)}
                    disabled={llmSettings.isLoading || llmSettings.isError || saveLlmSettings.isPending}
                  />
                  <span>
                    <strong>{LLM_PROVIDER_LABELS[item]}</strong>
                    <small>Model: <code>{models[item]}</code></small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="cfg-credentials-grid">
            <SecretField
              id="llm-minimax-key"
              label="MiniMax API key"
              value={minimaxKey}
              onChange={setMinimaxKey}
              saved={minimaxKeySet}
              maskedPreview={llmSettings.data?.minimaxKeyMasked ?? ''}
              placeholder="Nhập MiniMax API key"
              disabled={llmSettings.isLoading || llmSettings.isError || saveLlmSettings.isPending}
            />
            <SecretField
              id="llm-openrouter-key"
              label="OpenRouter API key"
              value={openrouterKey}
              onChange={setOpenrouterKey}
              saved={openrouterKeySet}
              maskedPreview={llmSettings.data?.openrouterKeyMasked ?? ''}
              placeholder="Nhập OpenRouter API key"
              disabled={llmSettings.isLoading || llmSettings.isError || saveLlmSettings.isPending}
            />
          </div>
          <div className="cfg-form-actions">
            <button
              className="btn btn--primary"
              disabled={
                !llmSettings.data
                || !appSettings.data
                || llmSettings.isError
                || appSettings.isError
                || saveLlmSettings.isPending
                || saveAppSettings.isPending
                || !chatbotCanSave
                || (chatbotNeedsReadyProvider && !chosenKeyReady)
              }
              onClick={saveChatbot}
            >
              {saveLlmSettings.isPending || saveAppSettings.isPending
                ? <Loader2 size={15} className="spin" />
                : <Save size={15} />}
              {saveLlmSettings.isPending || saveAppSettings.isPending
                ? 'Đang lưu…'
                : 'Lưu cài đặt trợ lý'}
            </button>
            {aiMessage && <span className="cfg-form-success" role="status">{aiMessage}</span>}
            {saveLlmSettings.error && (
              <span className="cfg-form-error" role="alert">
                {saveLlmSettings.error instanceof Error ? saveLlmSettings.error.message : 'Không thể lưu cấu hình AI.'}
              </span>
            )}
            {llmSettings.error && (
              <span className="cfg-form-error" role="alert">
                {llmSettings.error instanceof Error ? llmSettings.error.message : 'Không thể tải cấu hình AI.'}
              </span>
            )}
          </div>
        </Panel>

        <Panel
          title="Nhận dạng OCR"
          subtitle="Bật hoặc tắt nhận dạng hình ảnh và quản lý API key riêng cho OCR"
          action={<ScanLine size={18} className="cfg-panel-action-icon" />}
        >
          <FeatureSwitch
            icon={<ScanLine size={19} />}
            label="Sử dụng OCR"
            description="Cho phép nhận dạng số container, số seal và thông tin từ ảnh. API key được giữ lại khi tắt."
            enabled={ocrEnabled}
            onChange={() => setOcrEnabled((current) => !current)}
            disabled={ocrSettings.isLoading || ocrSettings.isError || saveOcrSettings.isPending}
          />
          <div className="cfg-security-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>API key OCR được mã hóa riêng khi lưu và không dùng chung với chatbot. Giá trị đầy đủ không bao giờ gửi lại trình duyệt.</span>
          </div>
          <div className="cfg-credentials-grid">
            <SecretField
              id="ocr-openrouter-key"
              label="OpenRouter API key cho OCR"
              value={ocrOpenrouterKey}
              onChange={setOcrOpenrouterKey}
              saved={ocrOpenrouterKeySet}
              maskedPreview={ocrSettings.data?.openrouterKeyMasked ?? ''}
              placeholder="Nhập OpenRouter API key cho OCR"
              disabled={ocrSettings.isLoading || ocrSettings.isError || saveOcrSettings.isPending}
            />
            <SecretField
              id="ocr-gemini-key"
              label="Gemini API key dự phòng"
              value={ocrGeminiKey}
              onChange={setOcrGeminiKey}
              saved={ocrGeminiKeySet}
              maskedPreview={ocrSettings.data?.geminiKeyMasked ?? ''}
              placeholder="Nhập Gemini API key cho OCR"
              disabled={ocrSettings.isLoading || ocrSettings.isError || saveOcrSettings.isPending}
            />
          </div>
          <p className="cfg-field-hint cfg-ocr-provider-note">
            OCR ưu tiên OpenRouter và tự động chuyển sang Gemini khi nhà cung cấp chính gặp lỗi.
          </p>
          <div className="cfg-form-actions">
            <button
              className="btn btn--primary"
              disabled={
                !ocrSettings.data
                || ocrSettings.isError
                || saveOcrSettings.isPending
                || !ocrChanged
                || (ocrEnabled && !ocrHasKey)
              }
              onClick={saveOcr}
            >
              {saveOcrSettings.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {saveOcrSettings.isPending ? 'Đang lưu…' : 'Lưu cài đặt OCR'}
            </button>
            {ocrMessage && <span className="cfg-form-success" role="status">{ocrMessage}</span>}
            {saveOcrSettings.error && (
              <span className="cfg-form-error" role="alert">
                {saveOcrSettings.error instanceof Error
                  ? saveOcrSettings.error.message
                  : 'Không thể lưu cài đặt OCR.'}
              </span>
            )}
            {ocrSettings.error && (
              <span className="cfg-form-error" role="alert">
                {ocrSettings.error instanceof Error
                  ? ocrSettings.error.message
                  : 'Không thể tải cài đặt OCR.'}
              </span>
            )}
          </div>
        </Panel>

        <Panel
          title="Gửi email qua Resend"
          subtitle="API key dùng để gửi email hệ thống"
          action={<Mail size={18} className="cfg-panel-action-icon" />}
        >
          <div className="cfg-security-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>API key được mã hóa khi lưu. Giá trị đầy đủ không bao giờ gửi lại trình duyệt. Thay đổi có hiệu lực ngay.</span>
          </div>
          <div className="cfg-credentials-grid cfg-credentials-grid--single">
            <SecretField
              id="resend-api-key"
              label="Resend API key"
              value={resendApiKey}
              onChange={setResendApiKey}
              saved={!!emailSettings.data?.resendKeySet}
              maskedPreview={emailSettings.data?.resendKeyMasked ?? ''}
              placeholder="Nhập Resend API key"
              disabled={emailSettings.isLoading || emailSettings.isError || saveEmailSettings.isPending}
            />
          </div>
          <div className="cfg-form-actions cfg-email-actions">
            <button
              className="btn btn--primary"
              disabled={
                !emailSettings.data
                || emailSettings.isError
                || saveEmailSettings.isPending
                || resendApiKey.trim() === ''
              }
              onClick={saveEmail}
            >
              {saveEmailSettings.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {saveEmailSettings.isPending
                ? 'Đang lưu…'
                : emailSettings.data?.resendKeySet
                  ? 'Thay API key'
                  : 'Lưu API key'}
            </button>
            {emailSettings.data?.resendKeySet && (
              <button
                className="btn btn--secondary cfg-danger-action"
                disabled={saveEmailSettings.isPending}
                onClick={clearEmail}
              >
                <Trash2 size={15} />
                {saveEmailSettings.isPending ? 'Đang xử lý…' : 'Xóa API key'}
              </button>
            )}
            {emailMessage && (
              <span className="cfg-form-success" role="status" aria-live="polite">
                {emailMessage}
              </span>
            )}
            {saveEmailSettings.error && (
              <span className="cfg-form-error" role="alert">
                {saveEmailSettings.error instanceof Error
                  ? saveEmailSettings.error.message
                  : 'Không thể lưu API key. Kiểm tra key và thử lại.'}
              </span>
            )}
            {emailSettings.error && (
              <span className="cfg-form-error" role="alert">
                {emailSettings.error instanceof Error
                  ? emailSettings.error.message
                  : 'Không thể tải cấu hình gửi email.'}
              </span>
            )}
          </div>
        </Panel>

        <Panel
          title="Định vị Bách Khoa"
          subtitle="Tài khoản dùng để đồng bộ vị trí xe và lộ trình GPS"
          action={<MapPin size={18} className="cfg-panel-action-icon" />}
        >
          <FeatureSwitch
            icon={<MapPin size={19} />}
            label="Định vị Bách Khoa"
            description="Bật để đồng bộ vị trí xe từ hệ thống Bách Khoa. Tắt để dừng đồng bộ — tài khoản bên dưới được giữ lại để bật lại nhanh."
            enabled={features.gpsEnabled}
            onChange={() => updateFeature('gpsEnabled')}
            disabled={appSettings.isLoading || appSettings.isError || saveAppSettings.isPending}
          />
          <div className="cfg-security-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Tên đăng nhập và mật khẩu được mã hóa khi lưu. Thay đổi có hiệu lực ngay, không cần khởi động lại.</span>
          </div>
          <div className="cfg-credentials-grid">
            <div className="field">
              <label htmlFor="bach-khoa-username">Tên đăng nhập Bách Khoa</label>
              <input
                id="bach-khoa-username"
                className="input"
                value={gpsUsername}
                onChange={(event) => setGpsUsername(event.target.value)}
                placeholder="Nhập tên đăng nhập"
                autoComplete="username"
                spellCheck={false}
                disabled={!features.gpsEnabled || gpsSettings.isLoading || gpsSettings.isError || saveGpsSettings.isPending}
              />
            </div>
            <SecretField
              id="bach-khoa-password"
              label="Mật khẩu Bách Khoa"
              value={gpsPassword}
              onChange={setGpsPassword}
              saved={!!gpsSettings.data?.passwordSet}
              maskedPreview={gpsSettings.data?.passwordMasked ?? ''}
              placeholder="Nhập mật khẩu"
              disabled={!features.gpsEnabled || gpsSettings.isLoading || gpsSettings.isError || saveGpsSettings.isPending}
            />
          </div>
          <div className="cfg-form-actions">
            <button
              className="btn btn--primary"
              disabled={!gpsSettings.data || gpsSettings.isError || saveGpsSettings.isPending || !gpsReady}
              onClick={saveGps}
            >
              {saveGpsSettings.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {saveGpsSettings.isPending ? 'Đang lưu…' : 'Lưu định vị'}
            </button>
            {gpsMessage && <span className="cfg-form-success" role="status">{gpsMessage}</span>}
            {saveGpsSettings.error && (
              <span className="cfg-form-error" role="alert">
                {saveGpsSettings.error instanceof Error ? saveGpsSettings.error.message : 'Không thể lưu tài khoản định vị.'}
              </span>
            )}
            {gpsSettings.error && (
              <span className="cfg-form-error" role="alert">
                {gpsSettings.error instanceof Error ? gpsSettings.error.message : 'Không thể tải tài khoản định vị.'}
              </span>
            )}
          </div>
        </Panel>
      </div>
      {confirmDialog}
    </div>
  );
}
