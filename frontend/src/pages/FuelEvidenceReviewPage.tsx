import { PhotoImage } from '../components/shared/PhotoImage';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { qk } from '../api/keys';

import { fuelEvidenceClient, type FuelEvidenceReviewRecord, type FuelEvidenceReviewStatus } from '../api/fuelEvidenceClient';
import { useAuthedPhotoUrls } from '../lib/api/photo';
import { PageHeader, StatusPill } from '../components/UI';
import { FilterDropdown } from '../components/FilterDropdown';
import { formatDateTimeVN, formatCurrency } from '../lib/format';
import { FilterBar, Pagination, UuiSelectField } from '../design-system';
import { billBookingReference } from '../lib/business-reference';

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
  // DRV-DET-08: evidence photos load with the Authorization header (blob),
  // never a ?token= query string. Index-aligned with `items`.
  const photoUrls = useAuthedPhotoUrls(items.map((row) => row.photoUrl));
  const total = query.data?.total ?? 0;
  const limit = query.data?.limit ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 40px' }}>
      <style>{`
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
      `}</style>
      <PageHeader title="Ảnh và số liệu OCR nhiên liệu" showTitle={false} onBack={() => navigate(-1)} />
      <p style={{ margin: '0 0 12px', color: 'var(--fg-3)' }}>
        Ảnh đã được lưu. Số liệu OCR chưa xác minh; đối chiếu ảnh gốc khi nhập liệu.
      </p>
      {/* Card 20260927_152: the filter part of the old toolbar is the shared
          `FilterBar` band — `Trạng thái` is the only criterion, so it lives in
          `Bộ lọc` (inline while the strip still fits two rows). The page-local
          toolbar flex row and the 220px select cap it used to declare are
          deleted: no page rule sizes a filter control any more. */}
      <FilterBar>
        <FilterDropdown
          count={status === 'ALL' ? 0 : 1}
          ariaLabel="Bộ lọc"
          dialogLabel="Bộ lọc ảnh nhiên liệu"
          onReset={() => {
            setStatus('ALL');
            setPage(1);
          }}
        >
          <UuiSelectField
            id="fuel-status-filter"
            label="Trạng thái"
            hideLabel
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as FuelEvidenceReviewStatus | 'ALL');
              setPage(1);
            }}
            options={[
              { value: 'ALL', label: 'Tất cả trạng thái' },
              { value: 'PENDING', label: 'Chưa xác minh' },
              { value: 'CONFIRMED', label: 'Đã đối chiếu trước đây' },
              { value: 'REJECTED', label: 'Không sử dụng (lịch sử)' },
            ]}
          />
        </FilterDropdown>
      </FilterBar>

      {query.isLoading && <div className="panel" style={{ padding: 20 }}>Đang tải danh sách OCR nhiên liệu…</div>}
      {query.isError && <div className="panel" style={{ padding: 20, color: 'var(--danger)' }}>Không thể tải danh sách OCR nhiên liệu.</div>}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <div className="panel" style={{ padding: 20, color: 'var(--fg-3)' }}>Không có ảnh nhiên liệu nào trong bộ lọc hiện tại.</div>
      )}

      <div className="fuel-evidence-review__list">
        {items.map((row, rowIndex) => (
          <section key={row.id} className="panel" style={{ padding: 16 }}>
            <div className="fuel-evidence-review__card">
              <div>
                <PhotoImage
                  src={photoUrls[rowIndex]}
                  alt={`Ảnh nhiên liệu ${billBookingReference(row.tripCode)}`}
                  style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border-1)', objectFit: 'cover' }}
                />
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 'var(--text-caption-size)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', fontWeight: 600 }}>Bill/Booking / chủ ảnh</div>
                    <div style={{ fontSize: 'var(--text-section-size)', fontWeight: 700 }}>{billBookingReference(row.tripCode)}</div>
                    <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>{row.ownerName || '—'}</div>
                  </div>
                  <StatusPill variant={STATUS_VARIANT[row.reviewStatus]}>
                    {reviewDecisionLabel(row)}
                  </StatusPill>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  <div><strong>Chụp lúc</strong><div>{formatDateTimeVN(row.capturedAt)}</div></div>
                  <div><strong>Lít</strong><div>{row.litres ?? '—'}</div></div>
                  <div><strong>Đơn giá</strong><div>{row.unitPrice != null ? formatCurrency(row.unitPrice) : '—'}</div></div>
                  <div><strong>Thành tiền</strong><div>{row.totalAmount != null ? formatCurrency(row.totalAmount) : '—'}</div></div>
                  <div><strong>Tính lại</strong><div>{row.computedTotal != null ? formatCurrency(row.computedTotal) : '—'}</div></div>
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
