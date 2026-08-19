import { Loader2, Mail, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Panel } from '../../components/UI';
import type { useEmailSettings, useSaveEmailSettings } from '../../hooks/useAppSettings';
import { SecretField } from './SecretField';

type EmailSectionProps = {
  emailSettings: ReturnType<typeof useEmailSettings>;
  saveEmailSettings: ReturnType<typeof useSaveEmailSettings>;
  resendApiKey: string;
  setResendApiKey: (value: string) => void;
  saveEmail: () => Promise<void>;
  clearEmail: () => Promise<void>;
  emailMessage: string | null;
};

export function EmailSection({
  emailSettings,
  saveEmailSettings,
  resendApiKey,
  setResendApiKey,
  saveEmail,
  clearEmail,
  emailMessage,
}: EmailSectionProps) {
  return (
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
  );
}
