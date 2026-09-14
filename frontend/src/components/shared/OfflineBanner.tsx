// OfflineBanner — connection gate that warns when the device cannot reach the
// server.  Business actions (milestones, e-POD, paper handoff, etc.) now
// require a live connection — there is no offline queue to buffer writes.
//
// When online, renders nothing (zero layout impact).

import { WifiOff } from 'lucide-react';
import { useOnline } from '../../hooks/useOnline';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '8px 16px',
        background: 'var(--danger, #dc2626)',
        color: '#fff',
        fontSize: 14,
        fontWeight: 600,
        textAlign: 'center',
        paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
        zIndex: 50,
      }}
    >
      <WifiOff size={16} />
      <span>Mất kết nối — vui lòng kiểm tra mạng để tiếp tục thao tác.</span>
    </div>
  );
}
