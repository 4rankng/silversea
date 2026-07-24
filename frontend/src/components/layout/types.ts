import type React from 'react';
import type { Role } from '@tingting/shared';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: React.ElementType;
  section?: 'operations' | 'hr' | 'financials' | 'master-data' | 'system';
  count?: number;
}

export type SectionName = 'operations' | 'hr' | 'financials' | 'master-data' | 'system';

export interface SidebarProps {
  user: {
    userId: number;
    role: Role;
    fullName?: string;
    username: string | null;
    email: string | null;
  };
  navItems: NavItem[];
  activeKey: string;
  sidebarOpen: boolean;
  isMobileViewport: boolean;
  userMenuOpen: boolean;
  collapsed: Set<string>;
  onNavigate: (path: string) => void;
  onToggleSidebar: () => void;
  onToggleUserMenu: () => void;
  onCloseUserMenu: () => void;
  onOpenProfileModal: () => void;
  onOpenPasswordModal: () => void;
  onLogout: () => void;
  navRef: React.RefObject<HTMLElement | null>;
  activeSection?: string;
  toggleSection: (key: string) => void;
}

export interface TopbarProps {
  user: {
    role: Role;
    fullName?: string;
    username: string | null;
  };
  isDriver: boolean;
  sidebarOpen: boolean;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  pageTitle: string;
  onToggleSidebar: () => void;
  onOpenTutorialLibrary?: () => void;
}

export interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  form: { email: string; phone: string; username: string; fullName: string };
  onFormChange: (form: { email: string; phone: string; username: string; fullName: string }) => void;
  onSave: () => void;
}

export interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  form: { currentPassword: string; newPassword: string; confirmPassword: string };
  onFormChange: (form: { currentPassword: string; newPassword: string; confirmPassword: string }) => void;
  onSave: () => void;
}
