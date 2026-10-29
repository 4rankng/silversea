import React from 'react';
import { Modal, FormGroup } from '../UI';
import { Alert } from '../shared/Alert';
import { KeyRound, Lock, AlertCircle } from 'lucide-react';
import { generatePassword } from '../../lib/generatePassword';
import type { PasswordModalProps } from './types';

function PasswordModal({
  isOpen,
  onClose,
  saving,
  error,
  currentPasswordFieldRef,
  isCurrentPasswordError,
  form,
  onFormChange,
  onSave,
}: PasswordModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      title="Đổi mật khẩu"
      onClose={onClose}
      onConfirm={onSave}
      maxWidth={520}
      polished
      footer={
        <>
          <button className="btn btn--secondary btn--sm" onClick={onClose}>Hủy</button>
          <button className="btn btn--primary btn--sm" onClick={onSave} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Đổi mật khẩu'}
          </button>
        </>
      }
    >
      {error && (
        <Alert
          variant="error"
          style="soft"
          icon={<AlertCircle size={16} />}
          className="mb-4"
        >
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormGroup label="Mật khẩu hiện tại">
          <div className="input-icon">
            <Lock size={16} />
            <input
              className="input"
              type="password"
              value={form.currentPassword}
              onChange={e => onFormChange({ ...form, currentPassword: e.target.value })}
              placeholder="Nhập mật khẩu hiện tại"
              autoComplete="current-password"
              ref={currentPasswordFieldRef}
              aria-invalid={isCurrentPasswordError || undefined}
              aria-describedby={isCurrentPasswordError ? 'current-password-error' : undefined}
            />
          </div>
        </FormGroup>
        {isCurrentPasswordError && (
          // Keep the password error immediately after its field group.
          <p id="current-password-error" role="alert" className="mt-1 text-xs" style={{ color: 'var(--err, #dc2626)', margin: 0 }}>
            Mật khẩu hiện tại không đúng
          </p>
        )}
        <FormGroup label="Mật khẩu mới">
          <div className="input-icon">
            <Lock size={16} />
            <input
              className="input"
              type="password"
              value={form.newPassword}
              onChange={e => onFormChange({ ...form, newPassword: e.target.value })}
              placeholder="Ít nhất 6 ký tự"
              autoComplete="new-password"
            />
          </div>
          {/* SIL-574: the card acceptance asks the dialog to OFFER password
              generation (autocomplete tokens summon the password manager's
              generator — this covers users without one). Generates into BOTH
              new + confirm so the form stays consistent. House primitive
              (btn--secondary--sm beside an input), UUI catalog
              application/modals/password-prompt-modal consulted 29/10 — no
              generate affordance in the catalog to adopt. */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              const generated = generatePassword();
              onFormChange({ ...form, newPassword: generated, confirmPassword: generated });
            }}
          >
            <KeyRound size={14} aria-hidden="true" /> Tạo mật khẩu
          </button>
        </FormGroup>
        <div className="col-span-full">
          <FormGroup label="Xác nhận mật khẩu mới">
            <div className="input-icon">
              <Lock size={16} />
              <input
                className="input"
                type="password"
                value={form.confirmPassword}
                onChange={e => onFormChange({ ...form, confirmPassword: e.target.value })}
                placeholder="Nhập lại mật khẩu mới"
                autoComplete="new-password"
              />
            </div>
          </FormGroup>
        </div>
      </div>
    </Modal>
  );
}

export { PasswordModal };
