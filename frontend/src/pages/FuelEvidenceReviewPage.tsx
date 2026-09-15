import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { qk } from '../api/keys';

import { fuelEvidenceClient, type FuelEvidenceReviewRecord, type FuelEvidenceReviewStatus } from '../api/fuelEvidenceClient';
import { getAuthenticatedPhotoUrl } from '../lib/api';
import { StatusPill } from '../components/UI';
import { formatCurrency } from '../lib/format';
import { Pagination, UuiSelectField } from '../design-system';

const STATUS_VARIANT: Record<FuelEvidenceReviewStatus, 'warn' | 'success' | 'danger'> = {
  PENDING: 'warn',
  CONFIRMED: 'success',
  REJECTED: 'danger',
};

const STATUS_LABEL: Record<FuelEvidenceReviewStatus, string> = {
  PENDING: 'Chưa xác minh',
  CONFIRMED: 'Đã đối chiếu trước đây',
  REJECTED: 'Không sử dụng (lịch sử)',
};

const OUTCOME_LABEL: Record<FuelEvidenceReviewRecord['ocrOutcome'], string> = {
  ACCEPTED: 'Ảnh bơm hợp lệ',
  UNREADABLE: 'Ảnh mờ / không đọc được',
  MULTI_SCREEN: 'Ảnh có nhiều màn hình',
  NON_PUMP: 'Ảnh không phải màn hình bơm',
  ANOMALY: 'Số liệu lệch cần soát',
};

function reviewDecisionLabel(row: FuelEvidenceReviewRecord): string {
  return `${OUTCOME_LABEL[row.ocrOutcome]} · ${STATUS_LABEL[row.reviewStatus]}`;
}

export default function FuelEvidenceReviewPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<FuelEvidenceReviewStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: qk.fuelEvidence.reviews(status, page),
    queryFn: () => fuelEvidenceClient.list({ status: status === 'ALL' ? undefined : status, page, limit: 20 }),
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const total = query.data?.total ?? 0;
  const limit = query.data?.limit ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 40px' }}>
      <style>{`
        .fuel-evidence-review__toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .fuel-evidence-review__toolbar-main {
          flex: 1;
          min-width: 200px;
        }
        .fuel-evidence-review__select {
          /* Use min/max rather than width so the global .ds-uui-select
           * (width: 100% inside a flex container) and the
           * --operational variant can't squeeze the H1 toolbar to zero
           * width. Cap and floor both at 220px so the select always
           * renders as a fixed-width control — the !important is required
           * because the .ds-uui-select--operational variant loads after
           * this inline style and overrides max-width. */
          min-width: 220px !important;
          max-width: 220px !important;
          min-height: 44px;
        }
        /* The select's WRAPPER is the toolbar's flex child; its width:100%
         * sets flex-basis to the full row, so with flex-shrink on, the
         * guidance (min-width: 0) collapsed to a 0px word-column beneath it.
         * Give the wrapper an explicit 220px flex-basis (matching the
         * control's min/max cap) so the guidance owns the remaining space. */
        .fuel-evidence-review__toolbar > .ds-uui-select {
          flex: 0 0 220px;
        }
        .fuel-evidence-review__card {
          display: grid;
          gap: 14px;
          grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
        }
        .fuel-evidence-review__list {
          display: grid;
          gap: 16px;
          max-height: calc(100vh - 220px);
          overflow: auto;
          padding-right: 4px;
        }
        @media (max-width: 900px) {
          .fuel-evidence-review__card {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        @media (max-width: 640px) {
          .fuel-evidence-review__toolbar {
            flex-direction: column;
            align-items: stretch;
          }
          .fuel-evidence-review__select {
            width: 100%;
          }
        }
      `}</style>
      <div className="fuel-evidence-review__toolbar">
        <button className="btn btn--ghost btn--icon" onClick={() => navigate(-1)} aria-label="Quay lại">
          <ArrowLeft size={18} />
        </button>
        <div className="fuel-evidence-review__toolbar-main">
          <h1 className="sr-only">Ảnh và số liệu OCR nhiên liệu</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--fg-3)' }}>
            Ảnh đã được lưu. Số liệu OCR chưa xác minh; đối chiếu ảnh gốc khi nhập liệu.
          </p>
        </div>
        <UuiSelectField
          id="fuel-status-filter"
          label="Trạng thái"
          hideLabel
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as FuelEvidenceReviewStatus | 'ALL');
            setPage(1);
          }}
          controlClassName="fuel-evidence-review__select"
          options={[
            { value: 'ALL', label: 'Tất cả trạng thái' },
            { value: 'PENDING', label: 'Chưa xác minh' },
            { value: 'CONFIRMED', label: 'Đã đối chiếu trước đây' },
            { value: 'REJECTED', label: 'Không sử dụng (lịch sử)' },
          ]}
        />
      </div>

      {query.isLoading && <div className="panel" style={{ padding: 20 }}>Đang tải danh sách OCR nhiên liệu…</div>}
      {query.isError && <div className="panel" style={{ padding: 20, color: 'var(--danger)' }}>Không thể tải danh sách OCR nhiên liệu.</div>}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <div className="panel" style={{ padding: 20, color: 'var(--fg-3)' }}>Không có ảnh nhiên liệu nào trong bộ lọc hiện tại.</div>
      )}

      <div className="fuel-evidence-review__list">
        {items.map((row) => (
          <section key={row.id} className="panel" style={{ padding: 16 }}>
            <div className="fuel-evidence-review__card">
              <div>
                <img
                  src={getAuthenticatedPhotoUrl(row.photoUrl)}
                  alt={`Ảnh nhiên liệu ${row.tripCode ?? row.tripId}`}
                  style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border-1)', objectFit: 'cover' }}
                />
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 'var(--text-caption-size)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', fontWeight: 600 }}>Chuyến / chủ ảnh</div>
                    <div style={{ fontSize: 'var(--text-section-size)', fontWeight: 700 }}>{row.tripCode || `Chuyến #${row.tripId}`}</div>
                    <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>{row.ownerName || `User #${row.ownerUserId}`}</div>
                  </div>
                  <StatusPill variant={STATUS_VARIANT[row.reviewStatus]}>
                    {reviewDecisionLabel(row)}
                  </StatusPill>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  <div><strong>Chụp lúc</strong><div>{new Date(row.capturedAt).toLocaleString('vi-VN')}</div></div>
                  <div><strong>Lít</strong><div>{row.litres ?? '—'}</div></div>
                  <div><strong>Đơn giá</strong><div>{row.unitPrice ? formatCurrency(row.unitPrice) : '—'}</div></div>
                  <div><strong>Thành tiền</strong><div>{row.totalAmount ? formatCurrency(row.totalAmount) : '—'}</div></div>
                  <div><strong>Tính lại</strong><div>{row.computedTotal ? formatCurrency(row.computedTotal) : '—'}</div></div>
                  <div><strong>GPS</strong><div>{row.latitude && row.longitude ? `${row.latitude}, ${row.longitude}` : 'Chưa có'}</div></div>
                </div>

                {(row.anomalyReason || row.ocrError || row.reviewNote) && (
                  <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-2)', fontSize: 'var(--text-data-size)', color: 'var(--fg-2)' }}>
                    {row.anomalyReason && <div><strong>Cảnh báo:</strong> {row.anomalyReason}</div>}
                    {row.ocrError && <div><strong>Lỗi OCR:</strong> {row.ocrError}</div>}
                    {row.reviewNote && <div><strong>Ghi chú đối chiếu trước đây:</strong> {row.reviewNote}</div>}
                  </div>
                )}


              </div>
            </div>
          </section>
        ))}
      </div>

      {!query.isLoading && totalPages > 1 && <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={20} onChange={setPage} disabled={query.isFetching} />}
    </main>
  );
}
