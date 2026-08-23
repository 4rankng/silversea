import { usePageAnimations } from '../hooks/animations';
import { AdminHealthWorkspace } from '../features/admin-center/AdminHealthWorkspace';

/**
 * Trung tâm quản trị — ADMIN-only health & readiness hub.
 *
 * Standalone page (extracted from /config): renders the server-driven
 * AdminHealthWorkspace whose own header carries the page title/subtitle,
 * so no separate PageHeader is layered on top.
 */
export default function AdminCenterPage() {
  const { rootRef } = usePageAnimations({ ready: true });

  return (
    <div ref={rootRef}>
      <AdminHealthWorkspace />
    </div>
  );
}
