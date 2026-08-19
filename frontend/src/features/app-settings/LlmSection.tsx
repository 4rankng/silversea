import type { Dispatch, SetStateAction } from 'react';
import { Bot, Loader2, Save, ShieldCheck } from 'lucide-react';
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_LABELS,
  type LlmProvider,
  type AppSettings,
} from '@tingting/shared';
import { Panel } from '../../components/UI';
import type { useAppSettings, useSaveAppSettings } from '../../hooks/useAppSettings';
import type { useLlmSettings, useSaveLlmSettings } from '../../hooks/useLlmSettings';
import { FeatureSwitch } from './FeatureSwitch';
import { SecretField } from './SecretField';

type LlmSectionProps = {
  appSettings: ReturnType<typeof useAppSettings>;
  saveAppSettings: ReturnType<typeof useSaveAppSettings>;
  features: AppSettings;
  updateFeature: (key: keyof AppSettings) => void;
  llmSettings: ReturnType<typeof useLlmSettings>;
  saveLlmSettings: ReturnType<typeof useSaveLlmSettings>;
  provider: LlmProvider;
  setProvider: Dispatch<SetStateAction<LlmProvider>>;
  models: Record<LlmProvider, string>;
  minimaxKey: string;
  setMinimaxKey: Dispatch<SetStateAction<string>>;
  openrouterKey: string;
  setOpenrouterKey: Dispatch<SetStateAction<string>>;
  minimaxKeySet: boolean;
  openrouterKeySet: boolean;
  chosenKeyReady: boolean;
  chatbotCanSave: boolean;
  chatbotNeedsReadyProvider: boolean;
  saveChatbot: () => Promise<void>;
  aiMessage: string | null;
};

export function LlmSection({
  appSettings,
  saveAppSettings,
  features,
  updateFeature,
  llmSettings,
  saveLlmSettings,
  provider,
  setProvider,
  models,
  minimaxKey,
  setMinimaxKey,
  openrouterKey,
  setOpenrouterKey,
  minimaxKeySet,
  openrouterKeySet,
  chosenKeyReady,
  chatbotCanSave,
  chatbotNeedsReadyProvider,
  saveChatbot,
  aiMessage,
}: LlmSectionProps) {
  return (
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
  );
}
