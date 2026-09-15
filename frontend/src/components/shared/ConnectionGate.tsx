import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useConnectionState } from '../../hooks/useOnline';
import { checkConnection } from '../../lib/connection';
import { useAuth } from '../../hooks/useAuth';
import { isolateInteractionGate } from '../../lib/interaction-gate';
import './connection-gate.css';

/** Covers every shell and body portal without discarding the visible draft. */
export function ConnectionGate({ children }: { children: ReactNode }) {
  const state = useConnectionState();
  const { logout } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);
  const blocked = state !== 'online';
  useEffect(() => {
    if (!blocked || !panelRef.current) return;
    return isolateInteractionGate(panelRef.current, 10);

  }, [blocked]);
  return <>
    {children}
    {blocked && createPortal(
      <div ref={panelRef} className="connection-gate" role="dialog" aria-modal="true"
        aria-labelledby="connection-gate-title" aria-describedby="connection-gate-description" tabIndex={-1}>
        <div className="connection-gate__content">
          <strong id="connection-gate-title">{state === 'checking' ? 'Đang kiểm tra kết nối…'
            : state === 'offline' ? 'Mất kết nối internet' : 'Chưa kết nối được máy chủ'}</strong>
          <p id="connection-gate-description">Cần kết nối để tiếp tục. Thao tác chưa gửi sẽ không tự gửi lại.
            Nếu vừa lưu, hãy kiểm tra kết quả khi kết nối trở lại.</p>
          <div className="connection-gate__actions">
            <button type="button" onClick={() => void checkConnection()}>Thử lại kết nối</button>
            <button type="button" onClick={() => logout()}>Đăng xuất</button>
          </div>
        </div>
      </div>, document.body)}
  </>;
}
