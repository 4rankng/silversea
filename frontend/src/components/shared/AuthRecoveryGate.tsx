import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isolateInteractionGate } from '../../lib/interaction-gate';
import './connection-gate.css';

/** Pause a transient session check without discarding the mounted page draft. */
export function AuthRecoveryGate({ pending, retry, logout }: {
  pending: boolean;
  retry: () => void;
  logout: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panelRef.current) return;
    // Connection recovery (10) yields to auth; an application upgrade (20)
    // retains priority. The shared coordinator prevents reciprocal inert traps.
    return isolateInteractionGate(panelRef.current, 15);
  }, []);
  return createPortal(
    <div ref={panelRef} className="connection-gate" role="dialog" aria-modal="true"
      aria-labelledby="auth-recovery-title" aria-describedby="auth-recovery-description" tabIndex={-1}>
      <section className="connection-gate__content">
        <strong id="auth-recovery-title">Chưa kiểm tra được phiên đăng nhập</strong>
        <p id="auth-recovery-description">Máy chủ tạm thời chưa phản hồi. Phiên đăng nhập và nội dung đang nhập được giữ lại; thử lại để tiếp tục.</p>
        <div className="connection-gate__actions">
          <button type="button" disabled={pending} onClick={retry}>
            {pending ? 'Đang kiểm tra…' : 'Thử lại'}
          </button>
          <button type="button" onClick={logout}>Đăng xuất</button>
        </div>
      </section>
    </div>, document.body,
  );
}
