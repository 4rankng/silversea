// OfflineBanner — M8.1 global offline indicator (PRD M08-01-05 slow-network).
//
// A slim banner pinned to the top of the app shell that appears whenever the
// browser reports no connection (`navigator.onLine === false`). It tells the
// driver/clerk their writes are being queued and will sync when reconnected.
// When online, it renders nothing (zero layout impact).
//
// The banner is purely informational — it does NOT block any interaction.
// The offline-queue lib (already wired in DriverProgressCard) handles the
// actual write buffering; this banner is the global visibility layer.

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
        background: 'var(--warn, #d97706)',
        color: '#fff',
        fontSize: 14,
        fontWeight: 600,
        textAlign: 'center',
        // Safe-area-aware so the banner clears the notch on iPhones.
        paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
        zIndex: 50,
      }}
    >
      <WifiOff size={16} />
      <span>Mất kết nối — thay đổi sẽ được lưu tạm và đồng bộ khi có mạng.</span>
    </div>
  );
}
