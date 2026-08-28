import type { Dispatch, SetStateAction } from 'react';
import { Loader2, Save, ScanLine, ShieldCheck } from 'lucide-react';
import { Panel } from '../../components/UI';
import type { useOcrSettings, useSaveOcrSettings } from '../../hooks/useOcrSettings';
import { FeatureSwitch } from './FeatureSwitch';
import { SecretField } from './SecretField';

type OcrSectionProps = {
  ocrSettings: ReturnType<typeof useOcrSettings>;
  saveOcrSettings: ReturnType<typeof useSaveOcrSettings>;
  ocrEnabled: boolean;
  setOcrEnabled: Dispatch<SetStateAction<boolean>>;
  ocrOpenrouterKey: string;
  setOcrOpenrouterKey: Dispatch<SetStateAction<string>>;
  ocrOpenrouterKeySet: boolean;
  ocrHasKey: boolean;
  ocrChanged: boolean;
  saveOcr: () => Promise<void>;
  ocrMessage: string | null;
};

export function OcrSection({
  ocrSettings,
  saveOcrSettings,
  ocrEnabled,
  setOcrEnabled,
  ocrOpenrouterKey,
  setOcrOpenrouterKey,
  ocrOpenrouterKeySet,
  ocrHasKey,
  ocrChanged,
  saveOcr,
  ocrMessage,
}: OcrSectionProps) {
  return (
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
      </div>
      <p className="cfg-field-hint cfg-ocr-provider-note">
        OCR chạy trên OpenRouter với chuỗi mô hình Qwen (Qwen3-VL-32B → Qwen3.7-Plus), tự động đổi mô hình khi gặp lỗi.
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
  );
}
