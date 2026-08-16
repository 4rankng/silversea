import type React from 'react';
import type { Role } from '@tingting/shared';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: React.ElementType;
  section?: SectionName;
  count?: number;
}

export type SectionName =
  | 'operations'
  | 'reports'
  | 'financials'
  | 'hr'
  | 'master-data'
  | 'system'
  | 'dispatch-planning'
  | 'resources'
  | 'document-ops'
  | 'reconciliation'
  | 'my-work'
  | 'portal';

export interface NavSection {
  key: SectionName;
  label: string;
}

export interface SidebarProps {
  user: {
    userId: number;
    role: Role;
    fullName?: string;
    username: string | null;
    email: string | null;
  };
  navItems: NavItem[];
  navSections: NavSection[];
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
    capabilities?: readonly string[];
  };
  isDriver: boolean;
  sidebarOpen: boolean;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  onToggleSidebar: () => void;
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
