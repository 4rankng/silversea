import { useRef } from 'react';
import { ChevronRight, KeyRound, LogOut, UserCog, X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useDropdownDismiss } from '../../hooks/useDropdownDismiss';
import type { SidebarProps } from './types';

type MobileAccountSheetProps = {
  user: SidebarProps['user'] & { phone?: string | null };
  roleLabel: string;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenPassword: () => void;
  onLogout: () => void;
};

/** One compact account surface. The desktop menu is rendered by Sidebar. */
export function MobileAccountSheet({
  user, roleLabel, onClose, onOpenProfile, onOpenPassword, onLogout,
}: MobileAccountSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, true);
  useDropdownDismiss(true, onClose);

  return (
    <div className="mobile-user-sheet-overlay" data-dropdown-root="" onClick={onClose}>
      <div
        ref={sheetRef}
        id="mobile-account-sheet"
        className="mobile-user-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-account-title"
        onClick={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="mobile-user-sheet-header">
          <h2 id="mobile-account-title">Tài khoản</h2>
          <button type="button" className="mobile-user-sheet-close" aria-label="Đóng tài khoản" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="mobile-user-sheet-scroll">
          <section className="mobile-user-sheet-identity" aria-label="Thông tin tài khoản">
            <div className="mobile-user-sheet-avatar" aria-hidden="true">
              <img src="/assets/avatars/driver-cartoon-v1.png" alt="" />
            </div>
            <div className="mobile-user-sheet-person">
              <strong>{user.fullName || user.username || roleLabel}</strong>
              <span>{roleLabel}</span>
            </div>
            <dl className="mobile-user-sheet-details">
              <div><dt>Tên đăng nhập</dt><dd>{user.username || '—'}</dd></div>
              <div><dt>Điện thoại</dt><dd>{user.phone || 'Chưa bổ sung'}</dd></div>
            </dl>
          </section>

          <div className="mobile-user-sheet-body">
            <button type="button" className="mobile-user-sheet-btn profile" onClick={onOpenProfile}>
              <UserCog size={18} aria-hidden="true" />
              <span className="btn-label">Thông tin cá nhân</span>
              <ChevronRight size={16} className="btn-chevron" aria-hidden="true" />
            </button>
            <button type="button" className="mobile-user-sheet-btn password" onClick={onOpenPassword}>
              <KeyRound size={18} aria-hidden="true" />
              <span className="btn-label">Đổi mật khẩu</span>
              <ChevronRight size={16} className="btn-chevron" aria-hidden="true" />
            </button>
            <button type="button" className="mobile-user-sheet-btn danger" onClick={onLogout}>
              <LogOut size={18} aria-hidden="true" />
              <span className="btn-label">Đăng xuất</span>
              <ChevronRight size={16} className="btn-chevron" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
