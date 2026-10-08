import { usePageAnimations } from '../hooks/animations';
import { AdminHealthWorkspace } from '../features/admin-center/AdminHealthWorkspace';
import { VatRateConfigCard } from '../features/admin-center/VatRateConfigCard';

/**
 * Trung tâm quản trị — ADMIN-only health & readiness hub.
 *
 * Standalone page (extracted from /config): renders the server-driven
 * AdminHealthWorkspace whose own header carries the page title/subtitle,
 * so no separate PageHeader is layered on top. The VAT rate config card
 * (card 081026104400-511) sits below the health workspace — the company
 * VAT rate is an admin setting surfaced where ADMIN manages the system.
 */
export default function AdminCenterPage() {
  const { rootRef } = usePageAnimations({ ready: true });

  return (
    <div ref={rootRef}>
      <AdminHealthWorkspace />
      <VatRateConfigCard />
    </div>
  );
}
