import type { Dispatch, SetStateAction } from 'react';
import { Loader2, MapPin, Save, ShieldCheck } from 'lucide-react';
import type { AppSettings } from '@tingting/shared';
import { Panel } from '../../components/UI';
import type { useAppSettings, useSaveAppSettings } from '../../hooks/useAppSettings';
import type { useGpsSettings, useSaveGpsSettings } from '../../hooks/useGpsSettings';
import { FeatureSwitch } from './FeatureSwitch';
import { SecretField } from './SecretField';

type GpsSectionProps = {
  appSettings: ReturnType<typeof useAppSettings>;
  saveAppSettings: ReturnType<typeof useSaveAppSettings>;
  features: AppSettings;
  updateFeature: (key: keyof AppSettings) => void;
  gpsSettings: ReturnType<typeof useGpsSettings>;
  saveGpsSettings: ReturnType<typeof useSaveGpsSettings>;
  gpsUsername: string;
  setGpsUsername: Dispatch<SetStateAction<string>>;
  gpsPassword: string;
  setGpsPassword: Dispatch<SetStateAction<string>>;
  gpsReady: boolean;
  saveGps: () => Promise<void>;
  gpsMessage: string | null;
};

export function GpsSection({
  appSettings,
  saveAppSettings,
  features,
  updateFeature,
  gpsSettings,
  saveGpsSettings,
  gpsUsername,
  setGpsUsername,
  gpsPassword,
  setGpsPassword,
  gpsReady,
  saveGps,
  gpsMessage,
}: GpsSectionProps) {
  return (
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
  );
}
