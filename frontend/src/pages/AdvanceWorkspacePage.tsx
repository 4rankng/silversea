import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, ClipboardCheck, WalletCards } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import AdminAdvancesPage from './AdminAdvancesPage';
import AdminAdvanceSettlementsPage from './AdminAdvanceSettlementsPage';
import './AdvanceWorkspacePage.css';

export type AdvanceWorkspaceView = 'requests' | 'settlements';

export function resolveAdvanceWorkspaceView(value: string | null): AdvanceWorkspaceView {
  return value === 'settlements' ? 'settlements' : 'requests';
}

export function buildAdvanceWorkspaceSearch(
  current: URLSearchParams,
  view: AdvanceWorkspaceView,
): string {
  const next = new URLSearchParams(current);
  next.set('view', view);
  next.delete('focus');
  next.delete('fdur');
  return `?${next.toString()}`;
}

export default function AdvanceWorkspacePage() {
  const [searchParams] = useSearchParams();
  const activeView = resolveAdvanceWorkspaceView(searchParams.get('view'));

  return (
    <div className="advance-workspace">
      <Breadcrumbs
        className="advance-workspace__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Tạm ứng & hoàn ứng' },
        ]}
      />

      <div className="advance-workspace__heading">
        <PageHeader
          title="Tạm ứng & hoàn ứng"
          iconName="advances"
          description="Quản lý yêu cầu tạm ứng và phiếu hoàn ứng trong một nơi. Yêu cầu tạm ứng được gửi sang Trung tâm phê duyệt để ra quyết định cuối cùng."
        />
        <Link className="advance-workspace__governance-link" to="/governance-actions">
          Mở Trung tâm phê duyệt
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <nav className="advance-workspace__views" aria-label="Tạm ứng và hoàn ứng">
        <Link
          className={activeView === 'requests' ? 'is-active' : ''}
          aria-current={activeView === 'requests' ? 'page' : undefined}
          to={buildAdvanceWorkspaceSearch(searchParams, 'requests')}
        >
          <WalletCards size={18} aria-hidden="true" />
          <span>Yêu cầu tạm ứng</span>
        </Link>
        <Link
          className={activeView === 'settlements' ? 'is-active' : ''}
          aria-current={activeView === 'settlements' ? 'page' : undefined}
          to={buildAdvanceWorkspaceSearch(searchParams, 'settlements')}
        >
          <ClipboardCheck size={18} aria-hidden="true" />
          <span>Phiếu hoàn ứng</span>
        </Link>
      </nav>

      <section
        className="advance-workspace__content"
        aria-labelledby={`advance-workspace-${activeView}-heading`}
      >
        <div className="advance-workspace__section-heading">
          <h2 id={`advance-workspace-${activeView}-heading`}>
            {activeView === 'requests' ? 'Yêu cầu tạm ứng' : 'Phiếu hoàn ứng'}
          </h2>
          <p>
            {activeView === 'requests'
              ? 'Xem yêu cầu của giao nhận và gửi đề nghị duyệt hoặc từ chối.'
              : 'Đối chiếu chi phí, số tiền hoàn lại và xử lý phiếu theo thẩm quyền.'}
          </p>
        </div>

        {activeView === 'requests'
          ? <AdminAdvancesPage embedded />
          : <AdminAdvanceSettlementsPage embedded />}
      </section>
    </div>
  );
}
