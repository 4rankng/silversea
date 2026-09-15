import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { APP_NAVIGATION_EVENT, type AppNavigationDetail } from '../../lib/app-navigation';

export function useTemplateLeaveGuard({ dirty, saving, confirm, onBack }: {
  dirty: boolean;
  saving: boolean;
  confirm: (message: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const leaving = useRef(false);
  const asking = useRef(false);
  const message = 'Mẫu có thay đổi chưa lưu. Bỏ thay đổi và rời trang?';
  const mayLeave = async () => {
    if (saving || asking.current) return false;
    asking.current = true;
    try {
      if (dirty && !await confirm(message)) return false;
      leaving.current = true;
      return true;
    } finally { asking.current = false; }
  };
  const requestBack = async () => {
    if (await mayLeave()) onBack();
  };
  useBackShortcut(() => { void requestBack(); });
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) { event.preventDefault(); event.returnValue = ''; }
    };
    const followLink = (event: MouseEvent) => {
      if (leaving.current || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin || target.pathname + target.search === window.location.pathname + window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      void mayLeave().then(allowed => { if (allowed) navigate(target.pathname + target.search + target.hash); });
    };
    const followAppNavigation = (event: Event) => {
      if (!(event instanceof CustomEvent) || leaving.current) return;
      const { path, proceed } = event.detail as AppNavigationDetail;
      if (path === window.location.pathname + window.location.search) return;
      event.preventDefault();
      void mayLeave().then(allowed => { if (allowed) proceed(); });
    };
    // BrowserRouter cannot cancel a pop after rendering the destination. Catch
    // the native event first and return to the exact prior history index when
    // the user keeps their draft. Browser Back uses its native confirmation.
    const currentIndex: unknown = window.history.state?.idx;
    let restoring = false;
    const historyBack = (event: PopStateEvent) => {
      if (leaving.current || restoring) { restoring = false; return; }
      const targetIndex: unknown = event.state?.idx;
      if (typeof currentIndex !== 'number' || typeof targetIndex !== 'number' || currentIndex === targetIndex) return;
      if (!saving && window.confirm(message)) { leaving.current = true; return; }
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(currentIndex - targetIndex);
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', followLink, true);
    window.addEventListener(APP_NAVIGATION_EVENT, followAppNavigation);
    window.addEventListener('popstate', historyBack, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', followLink, true);
      window.removeEventListener(APP_NAVIGATION_EVENT, followAppNavigation);
      window.removeEventListener('popstate', historyBack, true);
    };
  });
  return requestBack;
}
