import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

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

export function SecretField({
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
