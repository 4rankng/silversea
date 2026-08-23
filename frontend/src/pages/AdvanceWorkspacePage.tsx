import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Tabs } from '../design-system';
import type { TabItem } from '../design-system';
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
  const navigate = useNavigate();
  const activeView = resolveAdvanceWorkspaceView(searchParams.get('view'));

  const tabs: TabItem[] = [
    { id: 'requests', label: 'Yêu cầu tạm ứng' },
    { id: 'settlements', label: 'Phiếu hoàn ứng' },
  ];

  const handleTabChange = (id: string) => {
    navigate(buildAdvanceWorkspaceSearch(searchParams, id as AdvanceWorkspaceView));
  };

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

      <Tabs
        className="advance-workspace__views"
        tabs={tabs}
        value={activeView}
        onChange={handleTabChange}
        variant="bordered"
        ariaLabel="Tạm ứng và hoàn ứng"
      />

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
