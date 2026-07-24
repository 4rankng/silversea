import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  Bot,
  Cpu,
  Eye,
  EyeOff,
  GraduationCap,
  Loader2,
  MapPin,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDER_MODELS,
  type AppSettings,
  type LlmProvider,
  type LlmSettingsUpdate,
} from '@tingting/shared';
import { PageHeader, Panel } from '../../components/UI';
import { useAppSettings, useSaveAppSettings } from '../../hooks/useAppSettings';
import { useGpsSettings, useSaveGpsSettings } from '../../hooks/useGpsSettings';
import { useLlmSettings, useSaveLlmSettings } from '../../hooks/useLlmSettings';
import { usePageAnimations } from '../../hooks/animations';
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
  const llmSettings = useLlmSettings();
  const saveLlmSettings = useSaveLlmSettings();
  const gpsSettings = useGpsSettings();
  const saveGpsSettings = useSaveGpsSettings();

  const [features, setFeatures] = useState<AppSettings>({ botEnabled: false, tutorialEnabled: true });
  const [provider, setProvider] = useState<LlmProvider>('minimax');
  const [minimaxKey, setMinimaxKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [gpsUsername, setGpsUsername] = useState('');
  const [gpsPassword, setGpsPassword] = useState('');
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  useEffect(() => {
    if (appSettings.data) setFeatures(appSettings.data);
  }, [appSettings.data]);

  useEffect(() => {
    if (llmSettings.data) setProvider(llmSettings.data.provider);
  }, [llmSettings.data]);

  useEffect(() => {
    if (gpsSettings.data) setGpsUsername(gpsSettings.data.username);
  }, [gpsSettings.data]);

  const updateFeature = (key: keyof AppSettings) => {
    setFeatures((current) => ({ ...current, [key]: !current[key] }));
  };

  const saveAi = async () => {
    setAiMessage(null);
    const payload: LlmSettingsUpdate = { provider };
    if (minimaxKey.trim()) payload.minimaxApiKey = minimaxKey.trim();
    if (openrouterKey.trim()) payload.openrouterApiKey = openrouterKey.trim();
    try {
      await saveLlmSettings.mutateAsync(payload);
      setMinimaxKey('');
      setOpenrouterKey('');
      setAiMessage('Đã lưu cấu hình AI.');
    } catch {
      setAiMessage(null);
    }
  };

  const saveGps = async () => {
    setGpsMessage(null);
    try {
      await saveGpsSettings.mutateAsync({
        username: gpsUsername.trim(),
        ...(gpsPassword.trim() ? { password: gpsPassword } : {}),
      });
      setGpsPassword('');
      setGpsMessage('Đã lưu tài khoản định vị Bách Khoa.');
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
  const gpsReady = gpsUsername.trim() !== ''
    && (gpsSettings.data?.passwordSet || gpsPassword.trim() !== '');

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
          title="Tính năng ứng dụng"
          subtitle="Các thay đổi có hiệu lực cho toàn bộ người dùng sau khi lưu"
          action={<ShieldCheck size={18} className="cfg-panel-action-icon" />}
        >
          <FeatureSwitch
            icon={<Bot size={19} />}
            label="Trợ lý ảo"
            description="Cho phép người dùng văn phòng mở và sử dụng trợ lý ảo trong ứng dụng."
            enabled={features.botEnabled}
            onChange={() => updateFeature('botEnabled')}
            disabled={appSettings.isLoading || appSettings.isError || saveAppSettings.isPending}
          />
          <FeatureSwitch
            icon={<GraduationCap size={19} />}
            label="Hướng dẫn sử dụng"
            description="Hiển thị bảng checklist và các tour hướng dẫn cho người dùng mới."
            enabled={features.tutorialEnabled}
            onChange={() => updateFeature('tutorialEnabled')}
            disabled={appSettings.isLoading || appSettings.isError || saveAppSettings.isPending}
          />
          <div className="cfg-form-actions">
            <button
              className="btn btn--primary"
              disabled={!appSettings.data || appSettings.isError || saveAppSettings.isPending}
              onClick={() => saveAppSettings.mutate(features)}
            >
              {saveAppSettings.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {saveAppSettings.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}
            </button>
            {saveAppSettings.error && (
              <span role="alert" className="cfg-form-error">
                {saveAppSettings.error instanceof Error ? saveAppSettings.error.message : 'Không thể lưu cài đặt.'}
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
          title="Nhà cung cấp AI"
          subtitle="Chọn mô hình và API key cho mọi cuộc hội thoại với trợ lý ảo"
          action={<Cpu size={18} className="cfg-panel-action-icon" />}
        >
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
              disabled={!llmSettings.data || llmSettings.isError || saveLlmSettings.isPending || !chosenKeyReady}
              onClick={saveAi}
            >
              {saveLlmSettings.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {saveLlmSettings.isPending ? 'Đang lưu…' : 'Lưu cấu hình AI'}
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
          title="Định vị Bách Khoa"
          subtitle="Tài khoản dùng để đồng bộ vị trí xe và lộ trình GPS"
          action={<MapPin size={18} className="cfg-panel-action-icon" />}
        >
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
                disabled={gpsSettings.isLoading || gpsSettings.isError || saveGpsSettings.isPending}
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
              disabled={gpsSettings.isLoading || gpsSettings.isError || saveGpsSettings.isPending}
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
    </div>
  );
}
