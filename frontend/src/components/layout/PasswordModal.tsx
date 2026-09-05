import React from 'react';
import { Modal, FormGroup } from '../UI';
import { Alert } from '../shared/Alert';
import { Lock, AlertCircle } from 'lucide-react';
import type { PasswordModalProps } from './types';

function PasswordModal({
  isOpen,
  onClose,
  saving,
  error,
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
            />
          </div>
        </FormGroup>
        <FormGroup label="Mật khẩu mới">
          <div className="input-icon">
            <Lock size={16} />
            <input
              className="input"
              type="password"
              value={form.newPassword}
              onChange={e => onFormChange({ ...form, newPassword: e.target.value })}
              placeholder="Ít nhất 6 ký tự"
            />
          </div>
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
              />
            </div>
          </FormGroup>
        </div>
      </div>
    </Modal>
  );
}

export { PasswordModal };
