import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AdminHealthInboxItem, WorkInboxResponseOf } from '@tingting/shared';
import { WORKSPACES } from '@tingting/shared';
import { qk } from '../../api/keys';
import { formatDateTimeShort } from '../../lib/format';
import { api } from '../../lib/api';
import './AdminHealthWorkspace.css';

const HEALTH_LABELS: Record<AdminHealthInboxItem['healthState'], string> = {
  HEALTHY: 'Ổn định',
  FAILED: 'Cần xử lý',
  UNAVAILABLE: 'Không khả dụng',
};

const SOURCE_LABELS: Record<string, string> = {
  customer_email_logs: 'Email khách hàng',
  database: 'Cơ sở dữ liệu',
  setup: 'Thiết lập ban đầu',
  users_permissions: 'Người dùng & phân quyền',
  configuration: 'Cấu hình hệ thống',
  audit: 'Nhật ký kiểm toán',
  durable_effect_jobs: 'Tác vụ nền',
};

export function AdminHealthWorkspace() {
  const query = useQuery({
    queryKey: qk.configCounts.adminHealth,
    queryFn: () => api.get<WorkInboxResponseOf<AdminHealthInboxItem>>(
      `${WORKSPACES.ADMIN_HEALTH}?page=1&limit=100`,
    ),
  });

  const items = query.data?.items ?? [];
  const issueCount = items.filter((item) => item.healthState !== 'HEALTHY').length;

  return (
    <section className="admin-health-workspace" aria-labelledby="admin-health-title">
      <header>
        <div>
          <span>Trung tâm quản trị</span>
          <h2 id="admin-health-title">Sức khỏe và mức độ sẵn sàng</h2>
          <p>Thiết lập, phân quyền, tác vụ thất bại, cấu hình và kiểm toán từ dữ liệu máy chủ.</p>
        </div>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Làm mới sức khỏe hệ thống"><RefreshCw size={15} /></button>
      </header>

      {query.isLoading ? (
        <div className="admin-health-workspace__state" role="status">Đang tải sức khỏe hệ thống…</div>
      ) : query.isError ? (
        <div className="admin-health-workspace__state is-unavailable" role="alert"><AlertTriangle size={18} /> Nguồn sức khỏe hệ thống không khả dụng.<button type="button" onClick={() => void query.refetch()}>Thử lại</button></div>
      ) : (
        <>
          <div className="admin-health-workspace__summary" role="status">
            {issueCount > 0 ? <XCircle size={17} /> : <CheckCircle2 size={17} />}
            <strong>{issueCount > 0 ? `${issueCount} mục cần chú ý` : 'Các nguồn đang ổn định'}</strong>
            <span>Cập nhật {query.data && formatDateTimeShort(query.data.asOf)}</span>
          </div>
          <div className="admin-health-workspace__grid">
            {items.map((item) => (
              <article key={item.id} className={`is-${item.healthState.toLowerCase()}`}>
                <div className="admin-health-workspace__card-head">
                  <strong>{item.title}</strong>
                  <span>{HEALTH_LABELS[item.healthState]}</span>
                </div>
                <p>{item.subtitle}</p>
                <footer>
                  <small>{SOURCE_LABELS[item.source] ?? item.source} · {formatDateTimeShort(item.freshnessAt)}</small>
                  {(item.nextAction || item.targetRoute) && <Link to={item.nextAction?.targetRoute ?? item.targetRoute}>{item.nextAction?.label ?? 'Mở chi tiết'}</Link>}
                </footer>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
