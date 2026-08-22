import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ManagerWorkInboxItem, WorkInboxResponseOf } from '@tingting/shared';
import { WORKSPACES } from '@tingting/shared';
import { qk } from '../../../api/keys';
import { api } from '../../../lib/api';
import './ManagerDecisionInbox.css';

const STALE_AFTER_MS = 5 * 60 * 1000;

function ageLabel(ageHours: number): string {
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))} phút`;
  if (ageHours < 24) return `${Math.round(ageHours)} giờ`;
  return `${Math.round(ageHours / 24)} ngày`;
}

export function ManagerDecisionInbox({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: qk.dashboard.decisionInbox(page),
    queryFn: () => api.get<WorkInboxResponseOf<ManagerWorkInboxItem>>(
      `${WORKSPACES.DECISION_INBOX}?view=ACTION&page=${page}&limit=100`,
    ),
    enabled,
  });
  const disputeId = searchParams.get('disputeId');
  const selectedDispute = query.data?.items.find(
    (item) => item.entityType === 'delivery_response' && String(item.entityId) === disputeId,
  );
  const resolution = disputeId ? resolutionDrafts[disputeId] ?? '' : '';
  const resolveDispute = useMutation({
    mutationFn: (variables: { responseId: string; resolution: string }) => api.post(
      `${WORKSPACES.DECISION_INBOX.replace('/decision-inbox', '')}/delivery-disputes/${variables.responseId}/resolve`,
      { resolution: variables.resolution },
    ),
    onSuccess: async (_result, variables) => {
      setResolutionDrafts((current) => {
        const next = { ...current };
        delete next[variables.responseId];
        return next;
      });
      if (searchParams.get('disputeId') === variables.responseId) {
        const next = new URLSearchParams(searchParams);
        next.delete('disputeId');
        setSearchParams(next, { replace: true });
      }
      await client.invalidateQueries({ queryKey: ['dashboard', 'decision-inbox'] });
    },
  });

  useEffect(() => {
    if (query.data && page > query.data.totalPages && query.data.totalPages > 0) {
      setPage(query.data.totalPages);
    }
  }, [page, query.data]);

  if (!enabled) return null;
  const stale = query.data
    ? Date.now() - new Date(query.data.asOf).getTime() > STALE_AFTER_MS
    : false;

  return (
    <section className="manager-decision-inbox" aria-labelledby="manager-decision-title">
      <header>
        <div>
          <span>Điểm quyết định</span>
          <h2 id="manager-decision-title">Ngoại lệ cần xử lý trước</h2>
          <p>Bàn giao quá hạn, sai lệch giao hàng, phê duyệt và ngoại lệ SLA theo đúng chủ sở hữu.</p>
        </div>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Làm mới quyết định"><RefreshCw size={15} /></button>
      </header>

      {stale && <div className="manager-decision-inbox__notice" role="status"><Clock3 size={15} /> Dữ liệu đã cũ; hãy làm mới trước khi quyết định.</div>}
      {query.isLoading ? (
        <div className="manager-decision-inbox__state" role="status">Đang tải quyết định…</div>
      ) : query.isError ? (
        <div className="manager-decision-inbox__state is-error" role="alert"><AlertTriangle size={18} /> Không thể tải hàng đợi quyết định.<button type="button" onClick={() => void query.refetch()}>Thử lại</button></div>
      ) : !query.data?.items.length ? (
        <div className="manager-decision-inbox__state"><CheckCircle2 size={18} /> Không có ngoại lệ cần quyết định.</div>
      ) : (
        <div className="manager-decision-inbox__table-wrap">
          <table>
            <thead><tr><th>Vấn đề</th><th>Chủ sở hữu</th><th>Tuổi việc</th><th>Ảnh hưởng</th><th><span className="sr-only">Hành động</span></th></tr></thead>
            <tbody>{query.data.items.map((item) => (
              <tr key={item.id}>
                <td data-label="Vấn đề"><strong>{item.title}</strong><small>{item.subtitle}</small></td>
                <td data-label="Chủ sở hữu"><strong>{item.owner?.ownerLabel ?? 'Chưa xác định'}</strong><small>{item.owner?.label ?? 'Cần phân công'}</small></td>
                <td data-label="Tuổi việc"><strong>{ageLabel(item.ageHours)}</strong>{item.dueAt && <small>Hạn {new Date(item.dueAt).toLocaleString('vi-VN')}</small>}</td>
                <td data-label="Ảnh hưởng">{item.impact}</td>
                <td data-label="Hành động">{item.entityType === 'delivery_response' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set('disputeId', String(item.entityId));
                      setSearchParams(next);
                    }}
                  >
                    {item.nextAction?.label ?? 'Xử lý phản hồi'}
                  </button>
                ) : <Link to={item.nextAction?.targetRoute ?? item.targetRoute}>{item.nextAction?.label ?? 'Mở hồ sơ'}</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
          {query.data.totalPages > 1 && (
            <nav className="manager-decision-inbox__pagination" aria-label="Phân trang quyết định">
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Trang trước</button>
              <span>Trang {page} / {query.data.totalPages} · {query.data.total} việc</span>
              <button type="button" onClick={() => setPage((value) => Math.min(query.data!.totalPages, value + 1))} disabled={page === query.data.totalPages}>Trang sau</button>
            </nav>
          )}
        </div>
      )}

      {selectedDispute && (
        <form
          className="manager-decision-inbox__resolution"
          onSubmit={(event) => {
            event.preventDefault();
            if (disputeId && resolution.trim()) {
              resolveDispute.mutate({ responseId: disputeId, resolution: resolution.trim() });
            }
          }}
        >
          <div>
            <span>Xử lý sai lệch giao hàng</span>
            <h3>{selectedDispute.title}</h3>
            <p>{selectedDispute.subtitle}</p>
          </div>
          <label htmlFor="manager-dispute-resolution">Kết quả xử lý</label>
          <textarea
            id="manager-dispute-resolution"
            value={resolution}
            onChange={(event) => {
              if (!disputeId) return;
              const value = event.target.value;
              setResolutionDrafts((current) => ({ ...current, [disputeId]: value }));
            }}
            maxLength={2_000}
            required
            placeholder="Ghi rõ quyết định, người phối hợp và bước tiếp theo"
          />
          {resolveDispute.isError && <p className="manager-decision-inbox__resolution-error" role="alert">Không thể ghi nhận kết quả xử lý. Nội dung được giữ lại để thử lại.</p>}
          <div className="manager-decision-inbox__resolution-actions">
            <button type="button" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('disputeId'); setSearchParams(next); }}>Đóng</button>
            <button type="submit" disabled={!resolution.trim() || resolveDispute.isPending}>{resolveDispute.isPending ? 'Đang ghi nhận…' : 'Ghi nhận đã xử lý'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
