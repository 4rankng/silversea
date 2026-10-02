import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AccountantWorkInboxItem } from '@tingting/shared';
import { financialClient } from '../../api/financialClient';
import { formatDateTimeShort } from '../../lib/format';
import { qk } from '../../api/keys';
import { SortHeader } from '../../components/shared';
import { nextTableSort, type TableSortState } from '../../lib/table-sort';
import './AccountingWorkInbox.css';

type InboxView = 'ACTION' | 'WAITING';

const STALE_AFTER_MS = 5 * 60 * 1000;

function blockerRoute(item: AccountantWorkInboxItem, code: string): string {
  const trip = encodeURIComponent(String(item.tripId));
  if (code === 'EXPENSE_APPROVAL') return `/trips/${trip}`;
  if (code === 'SETTLEMENT') return `/advances?view=settlements&tripId=${trip}`;
  if (code === 'PROFITABILITY') return `/profit?tripId=${trip}`;
  return `${item.targetRoute}`;
}

function formatTime(value: string): string {
  // Combined date+time contract: time-first 24h, Vietnam-pinned — the old
  // inline toLocaleString was date-first, browser-local, engine-dependent.
  return formatDateTimeShort(value);
}

function ReadinessFacts({ item }: { item: AccountantWorkInboxItem }) {
  const facts = [
    ['POD', item.acceptedPod ? 'Đã nộp' : 'Còn thiếu'],
    ['Chi phí', item.expenseApprovalPending ? 'Chờ xử lý' : 'Đã xử lý'],
    ['Quyết toán', item.settlementComplete ? 'Hoàn tất' : 'Chưa hoàn tất'],
    ['Lợi nhuận', item.profitabilitySnapshotReady ? 'Đã chụp' : 'Còn thiếu'],
  ];
  return <dl className="accounting-work-inbox__facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function InboxLane({
  view,
  title,
  description,
}: {
  view: InboxView;
  title: string;
  description: string;
}) {
  const [page, setPage] = useState(1);
  // Server-side column sort; a new sort always restarts the lane from page 1.
  const [sort, setSort] = useState<TableSortState | null>(null);
  const query = useQuery({
    queryKey: qk.accounting.workInbox(view, page, sort?.by, sort?.dir),
    queryFn: () => financialClient.getWorkInbox(view, page, { sortBy: sort?.by, sortDir: sort?.dir }),
  });
  const data = query.data;
  const stale = data ? Date.now() - new Date(data.asOf).getTime() > STALE_AFTER_MS : false;

  const handleSortChange = (key: string) => {
    setSort((current) => nextTableSort(current, key));
    setPage(1);
  };

  return (
    <section className={`accounting-work-inbox__lane is-${view.toLowerCase()}`} aria-labelledby={`accounting-${view.toLowerCase()}-title`}>
      <header>
        <div>
          <h2 id={`accounting-${view.toLowerCase()}-title`}>{title} <span>{data?.total ?? 0}</span></h2>
          <p>{description}</p>
        </div>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label={`Làm mới ${title.toLowerCase()}`}><RefreshCw size={14} aria-hidden="true" /></button>
      </header>

      {stale && <div className="accounting-work-inbox__notice" role="status"><Clock3 size={15} /> Dữ liệu đã cũ; hãy làm mới trước khi xử lý.</div>}
      {query.isLoading ? (
        <div className="accounting-work-inbox__state" role="status">Đang tải {title.toLowerCase()}…</div>
      ) : query.isError ? (
        <div className="accounting-work-inbox__state is-error" role="alert"><AlertTriangle size={18} /> Không thể tải nhóm này.<button type="button" onClick={() => void query.refetch()}>Thử lại</button></div>
      ) : !data?.items.length ? (
        <div className="accounting-work-inbox__state is-empty" role="status"><CheckCircle2 size={15} /> Không có hồ sơ trong nhóm này.</div>
      ) : (
        <div className="record-table-wrap accounting-work-inbox__table-wrap">
          <table className="record-table ops-table accounting-work-inbox__table">
            <thead><tr>
              <SortHeader label="Hồ sơ" sortKey="title" sort={sort} onSortChange={handleSortChange} />
              <SortHeader label="Điều kiện tài chính" sortKey="readiness" sort={sort} onSortChange={handleSortChange} />
              <SortHeader label="Trở ngại / ngoại lệ" sortKey="blockers" sort={sort} onSortChange={handleSortChange} />
              <SortHeader label="Cập nhật" sortKey="freshness" sort={sort} onSortChange={handleSortChange} />
              <th scope="col"><span className="sr-only">Hành động</span></th>
            </tr></thead>
            <tbody>{data.items.map((item) => (
              <tr key={item.id}>
                <td data-label="Hồ sơ"><strong>{item.title}</strong><small>{item.subtitle}</small></td>
                <td data-label="Điều kiện"><ReadinessFacts item={item} /></td>
                <td data-label="Ngoại lệ">
                  {item.blockers.length > 0 && <ul className="accounting-work-inbox__issues">{item.blockers.map((blocker) => <li key={blocker.code}><Link to={blockerRoute(item, blocker.code)}>{blocker.label}</Link><small>Chủ trì: {blocker.ownerLabel}</small></li>)}</ul>}
                  {item.advisories.length > 0 && <ul className="accounting-work-inbox__advisories">{item.advisories.map((advisory) => <li key={advisory.code}>{advisory.label}<small>Ngoại lệ tham khảo — không chặn tài chính</small></li>)}</ul>}
                  {item.blockers.length === 0 && item.advisories.length === 0 && <span className="accounting-work-inbox__clear">Đủ điều kiện</span>}
                </td>
                <td data-label="Cập nhật"><time dateTime={item.freshnessAt}>{formatTime(item.freshnessAt)}</time></td>
                <td data-label="" className="record-table__action"><Link className="accounting-work-inbox__action" to={item.nextAction?.targetRoute ?? item.targetRoute}>{item.nextAction?.label ?? 'Mở hồ sơ'}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && <nav className="accounting-work-inbox__pagination" aria-label={`Phân trang ${title.toLowerCase()}`}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trước</button><span>Trang {page} / {data.totalPages}</span><button type="button" disabled={page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Sau</button></nav>}
    </section>
  );
}

export function AccountingWorkInbox() {
  return (
    <section className="accounting-work-inbox" aria-label="Hàng đợi sẵn sàng tài chính">
      <p className="accounting-work-inbox__batch-note">Tạo hàng loạt chỉ thực hiện trong Đối chiếu vận tải sau khi máy chủ xác nhận các dòng sẵn sàng và cùng một khách hàng.</p>
      <InboxLane view="ACTION" title="Sẵn sàng xử lý" description="Đã đủ POD, chi phí, quyết toán và ảnh chụp lợi nhuận." />
      <InboxLane view="WAITING" title="Đang bị chặn" description="Mở đúng nghiệp vụ đang giữ hồ sơ để hoàn thiện điều kiện." />
    </section>
  );
}
