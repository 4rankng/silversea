import { useSearchParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Tabs } from '../design-system';
import type { TabItem } from '../design-system';
import AdminAdvancesPage from './AdminAdvancesPage';
import AdminAdvanceSettlementsPage from './AdminAdvanceSettlementsPage';
import { OpsAccountantTab } from '../features/ops/OpsAccountantTab';
import './AdvanceWorkspacePage.css';

export type AdvanceWorkspaceView = 'requests' | 'settlements' | 'ops-expenses';

export function resolveAdvanceWorkspaceView(value: string | null): AdvanceWorkspaceView {
  return value === 'settlements' || value === 'ops-expenses' ? value : 'requests';
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
    // OpsVanHanh §5.4: accounting reviews Ops cash expenses + payment batches.
    { id: 'ops-expenses', label: 'Chi phí Ops' },
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
          description="Theo dõi tạm ứng, phiếu hoàn ứng và chi phí hiện trường. Thay đổi hợp lệ được ghi nhận trực tiếp."
        />
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
            {activeView === 'requests'
              ? 'Yêu cầu tạm ứng'
              : activeView === 'settlements' ? 'Phiếu hoàn ứng' : 'Chi phí Ops'}
          </h2>
          <p>
            {activeView === 'requests'
              ? 'Theo dõi khoản tạm ứng đã ghi sổ và xử lý bản nháp còn thiếu thông tin.'
              : activeView === 'settlements'
                ? 'Đối chiếu chi phí, số tiền hoàn lại và xử lý phiếu theo thẩm quyền.'
                : 'Đối chiếu khoản chi hiện trường của Ops và lập phiếu thanh toán.'}
          </p>
        </div>

        {activeView === 'requests'
          ? <AdminAdvancesPage embedded />
          : activeView === 'settlements'
            ? <AdminAdvanceSettlementsPage embedded />
            : <OpsAccountantTab />}
      </section>
    </div>
  );
}
