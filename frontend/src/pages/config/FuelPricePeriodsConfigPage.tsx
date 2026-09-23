import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Drawer } from '../../components/UI';
import { CONFIG } from '@tingting/shared';
import type { FuelPricePeriodRow } from '../../api/pricingClient';
import { quotationClient, type QuotationFuelApprovalRow } from '../../api/quotationClient';
import { DateInput } from '../../design-system/forms/DateInput';
import { formatDate } from '../../lib/format';

/** Card 20260922_61: the kế-toán alert — pending "ĐỒNG Ý CẬP NHẬT BÁO GIÁ"
 *  rows surface as a banner + a role=dialog batch list (select-all + per-row;
 *  closing the drawer = Để sau, rows stay pending server-side). */
function QuotationFuelApprovalAlert() {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const pendingQuery = useQuery({
    queryKey: ['quotation-fuel-approvals', 'PENDING'],
    queryFn: () => quotationClient.listFuelApprovals('PENDING'),
  });
  const decide = useMutation({
    mutationFn: (input: { ids: number[]; decision: 'AGREED' | 'DECLINED' }) =>
      quotationClient.decideFuelApprovals(input.ids, input.decision),
    onSuccess: async () => {
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ['quotation-fuel-approvals'] });
    },
  });

  const rows = pendingQuery.data?.items ?? [];
  const pendingTotal = rows.length;
  const toggle = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const decideSelected = (decision: 'AGREED' | 'DECLINED') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    decide.mutate({ ids, decision });
  };

  return (
    <>
      {pendingTotal > 0 && (
        <div className="expense-page-error" role="alert" style={{ margin: '12px 0' }}>
          <p>
            <strong>ĐỒNG Ý CẬP NHẬT BÁO GIÁ</strong>
            {' — '}
            {pendingTotal} khách hàng có báo giá chờ xác nhận cập nhật theo giá dầu mới.
          </p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setDrawerOpen(true)}>
            Xem danh sách chờ
          </button>
        </div>
      )}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Đồng ý cập nhật báo giá"
        subtitle="Kỳ giá dầu mới áp dụng cho khách hàng chỉ sau khi kế toán tick Đồng ý. Để sau = đóng danh sách, các dòng vẫn chờ."
        footer={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={selected.size === 0 || decide.isPending}
              onClick={() => decideSelected('AGREED')}
            >
              Đồng ý ({selected.size})
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={selected.size === 0 || decide.isPending}
              onClick={() => decideSelected('DECLINED')}
            >
              Không ({selected.size})
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDrawerOpen(false)}>
              Để sau
            </button>
          </div>
        )}
      >
        {rows.length === 0 ? (
          <p role="status">Không còn dòng chờ xác nhận.</p>
        ) : (
          <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input
                type="checkbox"
                aria-label="Chọn tất cả"
                checked={selected.size === rows.length && rows.length > 0}
                onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())}
              />
              Chọn tất cả
            </label>
            <table className="tt-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}><span className="sr-only">Chọn</span></th>
                  <th>Khách hàng</th>
                  <th>Báo giá</th>
                  <th>Kỳ giá mới</th>
                  <th><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: QuotationFuelApprovalRow) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${row.customerName}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td>{row.customerName}</td>
                    <td>
                      {row.quotationName}
                      <span style={{ display: 'block', color: 'var(--ink-3)' }}>{formatDate(row.quotationEffectiveDate)}</span>
                    </td>
                    <td>
                      {fmtPrice(row.periodUnitPrice)} đ/lít
                      <span style={{ display: 'block', color: 'var(--ink-3)' }}>từ {formatDate(row.periodEffectiveFrom)}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ ids: [row.id], decision: 'AGREED' })}
                      >
                        Đồng ý
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ ids: [row.id], decision: 'DECLINED' })}
                      >
                        Không
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Drawer>
    </>
  );
}

const fmtPrice = (v: string) => Number(v).toLocaleString('vi-VN');

function FuelPricePeriodForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean;
  item?: FuelPricePeriodRow;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(item?.effectiveFrom ?? '');
  const [unitPrice, setUnitPrice] = useState(item?.unitPrice ?? '');
  const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? '');

  const canSave = Boolean(effectiveFrom)
    && Boolean(unitPrice.trim())
    && Number(unitPrice) > 0;

  return (
    <InlineForm colSpan={3}>
      <div style={{ flex: 1, minWidth: 160 }}>
        <Field label="Ngày hiệu lực">
          <DateInput
            className="input"
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <Field label="Giá dầu mới (đ/lít)">
          <input
            className="input"
            type="number"
            min="1"
            required
            step="1"
            inputMode="numeric"
            placeholder="21740"
            value={unitPrice}
            onChange={e => setUnitPrice(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <Field label="Ghi chú (tùy chọn)">
          <input
            className="input"
            value={sourceNote}
            onChange={e => setSourceNote(e.target.value)}
            placeholder="Nguồn giá (VD: Petrolimex 18/7)"
          />
        </Field>
      </div>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        ondelete={onDelete}
        deleting={deleting}
        onsave={() => {
          if (!canSave) return;
          onsave({
            effectiveFrom,
            unitPrice: Number(unitPrice),
            ...(sourceNote.trim() ? { sourceNote: sourceNote.trim() } : {}),
          });
        }}
      />
    </InlineForm>
  );
}

export default function FuelPricePeriodsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <QuotationFuelApprovalAlert />
      <CrudTable<FuelPricePeriodRow>
        title="Giá dầu theo kỳ"
        description="Giá dầu Petrolimex công bố theo kỳ — nhập một bản ghi mỗi lần công bố giá mới"
        endpoint={CONFIG.FUEL_PRICE_PERIODS}
        colSpan={4}
        pageSlug="fuel-price-periods"
        emptyTitle="Chưa có kỳ giá dầu"
        emptyHint="Nhập kỳ giá đầu tiên để động cơ cước tự động có dữ liệu đối chiếu."
        sortFn={(a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)}
        columns={[
          { header: 'Ngày hiệu lực', render: r => formatDate(r.effectiveFrom) },
          { header: 'Giá dầu (đ/lít)', render: r => fmtPrice(r.unitPrice) },
          { header: 'Ghi chú', render: r => r.sourceNote || '—' },
          { header: 'Người nhập', render: r => r.createdByName || 'Không xác định' },
        ]}
        renderForm={p => (
          <FuelPricePeriodForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
            onDelete={p.onDelete}
            deleting={p.deleting}
          />
        )}
      />
    </div>
  );
}
