import { useRef, useState } from 'react';
import { isCompanyInfoConfigured, type CompanyInfo } from '@tingting/shared';
import { isValidOptionalEmail } from '../../lib/optional-email';
import { useNavigate } from 'react-router-dom';
import { Loader2, Save, Trash2, Upload } from 'lucide-react';
import { PageHeader, Panel } from '../../components/UI';
import { useCompanyInfo, useSaveCompanyInfo } from '../../hooks/useCatalogQueries';
import { configClient } from '../../api/configClient';
import { photoSrc } from '../../lib/api/photo';
import { usePageAnimations } from '../../hooks/animations';
import './config-page.css';

type CompanyInfoForm = {
  name: string;
  shortName: string;
  address: string;
  taxCode: string;
  representative: string;
  representativeTitle: string;
  bankAccount: string;
  bankName: string;
  phone: string;
  email: string;
  logoStorageKey: string | null;
};

type TextCompanyInfoField = Exclude<keyof CompanyInfoForm, 'logoStorageKey'>;

const EMPTY_FORM: CompanyInfoForm = {
  name: '',
  shortName: '',
  address: '',
  taxCode: '',
  representative: '',
  representativeTitle: '',
  bankAccount: '',
  bankName: '',
  phone: '',
  email: '',
  logoStorageKey: null,
};

const FIELD_LABELS: Array<{ key: TextCompanyInfoField; label: string }> = [
  { key: 'name', label: 'Tên đầy đủ' },
  { key: 'shortName', label: 'Tên ngắn' },
  { key: 'address', label: 'Địa chỉ' },
  { key: 'taxCode', label: 'Mã số thuế' },
  { key: 'representative', label: 'Đại diện bởi' },
  { key: 'representativeTitle', label: 'Chức vụ' },
  { key: 'bankAccount', label: 'Số tài khoản' },
  { key: 'bankName', label: 'Ngân hàng' },
  { key: 'phone', label: 'Điện thoại' },
  { key: 'email', label: 'Email' },
];

export default function CompanyInfoConfigPage() {
  const navigate = useNavigate();
  const { rootRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row', '.company-info-preview-row'] });
  const { data, isLoading } = useCompanyInfo();
  const saveCompanyInfo = useSaveCompanyInfo();
  const [form, setForm] = useState<CompanyInfoForm>(EMPTY_FORM);
  // Hydrate the form synchronously when `data` changes (render-time state sync)
  // rather than via useEffect, so inputs never flash EMPTY_FORM for a frame
  // between data arriving and the effect running. React supports a guarded
  // setState during render to "store info from the previous render".
  const [dirty, setDirty] = useState(false);
  const [syncedData, setSyncedData] = useState<CompanyInfo | undefined>(undefined);
  if (data !== syncedData) {
    setSyncedData(data);
    if (!dirty) setForm(
      data
        ? {
            name: data.name ?? '',
            shortName: data.shortName || data.name || '',
            address: data.address ?? '',
            taxCode: data.taxCode ?? '',
            representative: data.representative ?? '',
            representativeTitle: data.representativeTitle ?? '',
            bankAccount: data.bankAccount ?? '',
            bankName: data.bankName ?? '',
            phone: data.phone ?? '',
            email: data.email ?? '',
            logoStorageKey: data.logoStorageKey ?? null,
          }
        : EMPTY_FORM,
    );
  }
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<TextCompanyInfoField, string>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSave = isCompanyInfoConfigured(form) && Boolean(form.shortName.trim());

  const updateField = (key: keyof CompanyInfoForm, value: string) => {
    setDirty(true);
    setForm(current => ({ ...current, [key]: value }));
    if (key !== 'logoStorageKey' && fieldErrors[key as TextCompanyInfoField]) {
      setFieldErrors(current => { const next = { ...current }; delete next[key as TextCompanyInfoField]; return next; });
    }
  };

  const validateEmail = (email: string): string | null => {
    const trimmed = email.trim();
    if (!trimmed) return null;
    if (!isValidOptionalEmail(trimmed)) return 'Địa chỉ email không hợp lệ — nhập đúng định dạng, ví dụ: ten@congty.vn';
    return null;
  };

  const handleLogoSelect = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const result = await configClient.uploadCompanyLogo(file);
      setDirty(true);
      setForm(current => ({ ...current, logoStorageKey: result.storageKey }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi tải logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleChooseLogo = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleRemoveLogo = () => {
    setDirty(true);
    setForm(current => ({ ...current, logoStorageKey: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    const emailErr = validateEmail(form.email);
    if (emailErr) {
      setFieldErrors(current => ({ ...current, email: emailErr }));
      document.getElementById('company-email')?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await saveCompanyInfo.mutateAsync({
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        address: form.address.trim(),
        taxCode: form.taxCode.trim(),
        representative: form.representative.trim(),
        representativeTitle: form.representativeTitle.trim(),
        bankAccount: form.bankAccount.trim(),
        bankName: form.bankName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        logoStorageKey: form.logoStorageKey,
      });
      navigate('/config');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi lưu thông tin công ty');
    } finally {
      setSaving(false);
    }
  };

  const logoSrc = photoSrc(form.logoStorageKey);

  return (
    <div ref={rootRef} className="cfg-page cfg-page--company-info">
      <PageHeader
        title="Thông tin công ty"
        description="Hồ sơ pháp lý, liên hệ và tài khoản ngân hàng — hiển thị trên các chứng từ xuất ra"
        onBack={() => navigate('/config')}
        iconName="company-profile"
      />

      <Panel
        title="Hồ sơ công ty"
        subtitle="Thông tin mặc định dùng cho các màn hình cấu hình và chứng từ nội bộ"
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink-3)' }}>Đang tải…</div>
        ) : (
          <>
            {!isCompanyInfoConfigured(data) && (
              <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 6, background: '#fff7ed', borderLeft: '3px solid #f59e0b', color: '#92400e', fontSize: 'var(--text-data-size)', lineHeight: 1.5 }}>
                Chưa cấu hình thông tin công ty — hãy điền các trường bên dưới. Tiêu đề công ty (tên, địa chỉ, MST, logo) sẽ hiển thị trên mọi chứng từ xuất ra (PDF/Excel).
              </div>
            )}
            <div className="company-info-layout">
              <div className="company-info-form">
                <div className="field cfg-row">
                  <label>Logo công ty</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={e => handleLogoSelect(e.target.files)}
                    />
                    {logoSrc ? (
                      <img
                        src={logoSrc}
                        alt="Logo công ty"
                        style={{ maxHeight: 80, maxWidth: 200, objectFit: 'contain', borderRadius: 6, border: '1px solid #dde3ea' }}
                      />
                    ) : (
                      <div style={{ height: 80, width: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px dashed #dde3ea', color: 'var(--ink-3)', fontSize: 'var(--text-data-size)' }}>
                        Chưa có logo
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={uploadingLogo || saving}
                        onClick={handleChooseLogo}
                      >
                        {uploadingLogo ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                        {logoSrc ? 'Đổi logo' : 'Chọn logo'}
                      </button>
                      {logoSrc && (
                        <button
                          type="button"
                          className="btn"
                          disabled={uploadingLogo || saving}
                          onClick={handleRemoveLogo}
                        >
                          <Trash2 size={14} />
                          Xóa
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="cfg-form-grid cfg-row">
                  <div className="field">
                    <label htmlFor="company-full-name">Tên đầy đủ</label>
                    <input
                      id="company-full-name"
                      className="input"
                      value={form.name}
                      onChange={e => updateField('name', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="company-short-name">Tên ngắn</label>
                    <input
                      id="company-short-name"
                      className="input"
                      value={form.shortName}
                      onChange={e => updateField('shortName', e.target.value)}
                    />
                  </div>
                </div>

                <div className="cfg-form-grid cfg-row">
                  <div className="field">
                    <label htmlFor="company-tax-code">Mã số thuế</label>
                    <input
                      id="company-tax-code"
                      className="input"
                      value={form.taxCode}
                      onChange={e => updateField('taxCode', e.target.value)}
                    />
                  </div>
                </div>

                <div className="field cfg-row">
                  <label htmlFor="company-address">Địa chỉ</label>
                  <textarea
                    id="company-address"
                    className="input"
                    rows={3}
                    value={form.address}
                    onChange={e => updateField('address', e.target.value)}
                  />
                </div>

                <div className="cfg-form-grid cfg-row">
                  <div className="field">
                    <label htmlFor="company-representative">Đại diện bởi</label>
                    <input
                      id="company-representative"
                      className="input"
                      value={form.representative}
                      onChange={e => updateField('representative', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="company-representative-title">Chức vụ</label>
                    <input
                      id="company-representative-title"
                      className="input"
                      value={form.representativeTitle}
                      onChange={e => updateField('representativeTitle', e.target.value)}
                    />
                  </div>
                </div>

                <div className="cfg-form-grid cfg-row">
                  <div className="field">
                    <label htmlFor="company-bank-account">Số tài khoản</label>
                    <input
                      id="company-bank-account"
                      className="input"
                      value={form.bankAccount}
                      onChange={e => updateField('bankAccount', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="company-bank-name">Ngân hàng</label>
                    <textarea
                      id="company-bank-name"
                      className="input"
                      rows={2}
                      value={form.bankName}
                      onChange={e => updateField('bankName', e.target.value)}
                    />
                  </div>
                </div>

                <div className="cfg-form-grid cfg-row">
                  <div className="field">
                    <label htmlFor="company-phone">Điện thoại</label>
                    <input
                      id="company-phone"
                      className="input"
                      value={form.phone}
                      onChange={e => updateField('phone', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="company-email">Email</label>
                    <input
                      id="company-email"
                      className="input"
                      value={form.email}
                      onChange={e => updateField('email', e.target.value)}
                      onBlur={e => { const err = validateEmail(e.target.value); setFieldErrors(current => { if (err) return { ...current, email: err }; const next = { ...current }; delete next.email; return next; }); }}
                      aria-invalid={fieldErrors.email ? true : undefined}
                      aria-describedby={fieldErrors.email ? 'company-email-error' : undefined}
                    />
                    {fieldErrors.email && (
                      <p id="company-email-error" role="alert" className="cfg-field-error" style={{ color: 'var(--err, #dc2626)', margin: '4px 0 0', fontSize: 'var(--text-caption-size)' }}>
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>
                </div>
              </div>

            </div>

            <div className="cfg-form-actions">
              <button
                className="btn btn--primary"
                disabled={saving || uploadingLogo || !canSave}
                onClick={handleSave}
              >
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                Lưu thông tin
              </button>
            </div>
            <details className="company-info-comparison">
              <summary>Thông tin đã lưu</summary>
              <p>Giá trị đang lưu trong hồ sơ. Các thay đổi trong biểu mẫu chỉ được áp dụng khi bấm Lưu thông tin.</p>
              <div className="company-info-preview" aria-label="Thông tin công ty đã lưu">
                {FIELD_LABELS.map(({ key, label }) => (
                  <div key={key} className="company-info-preview-row">
                    <span className="company-info-preview-row__label">{label}</span>
                    <span className="company-info-preview-row__value">{data?.[key] || '—'}</span>
                  </div>
                ))}
              </div>
            </details>
            {error && (
              <div role="alert" className="cfg-form-error" style={{ marginTop: 8 }}>
                {error}
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
