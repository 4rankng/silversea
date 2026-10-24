import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Drawer } from '../../components/UI';
import { Alert } from '../../components/shared/Alert';
import { CONFIG, Role } from '@tingting/shared';
import { useAuth } from '../../hooks/useAuth';
import { NumberField } from '../../design-system';
import type { FuelPricePeriodRow } from '../../api/pricingClient';
import { useTableRowSelection } from '../../hooks/useTableRowSelection';
import { quotationClient, type QuotationFuelApprovalRow } from '../../api/quotationClient';
import { qk } from '../../api/keys';
import { DateInput } from '../../design-system/forms/DateInput';
import { formatMoney, formatDate } from '../../lib/format';
import './fuel-price-periods-config.css';

/** Card 20260922_61: the kế-toán alert — pending "ĐỒNG Ý CẬP NHẬT BÁO GIÁ"
 *  rows surface as a banner + a role=dialog batch list (select-all + per-row;
 *  closing the drawer = Để sau, rows stay pending server-side). */
function QuotationFuelApprovalAlert() {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Card 20260929_207: the batch list is picked by clicking a row; the
  // select-all affordance is a button, not a header checkbox, and it says so.
  const selection = useTableRowSelection<number>();
  const selected = selection.selected;
  const pendingQuery = useQuery({
    queryKey: qk.quotationFuelApprovals.pending,
    queryFn: () => quotationClient.listFuelApprovals('PENDING'),
  });
  const decide = useMutation({
    mutationFn: (input: { ids: number[]; decision: 'AGREED' | 'DECLINED' }) =>
      quotationClient.decideFuelApprovals(input.ids, input.decision),
    onSuccess: async () => {
      selection.clear();
      await queryClient.invalidateQueries({ queryKey: qk.quotationFuelApprovals.all });
    },
  });

  const rows = pendingQuery.data?.items ?? [];
  const pendingTotal = rows.length;
  const toggleAll = () => {
    if (selection.allOfSelected(rows.map((row) => row.id))) selection.clear();
    else selection.selectAll(rows.map((row) => row.id));
  };
  const decideSelected = (decision: 'AGREED' | 'DECLINED') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    decide.mutate({ ids, decision });
  };

  return (
    <>
      {/* Card 20261004_333: a failed pending-approvals fetch must not render as
          "no pending work" — surface the error with retry instead. */}
      {pendingQuery.isError && (
        <div style={{ margin: '12px 0' }}>
          <Alert
            variant="error"
            style="soft"
            action={(
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={pendingQuery.isFetching}
                onClick={() => { void pendingQuery.refetch(); }}
              >
                {pendingQuery.isFetching ? 'Đang thử lại…' : 'Thử lại'}
              </button>
            )}
          >
            Không thể tải danh sách chờ xác nhận cập nhật báo giá
          </Alert>
        </div>
      )}
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
        {pendingQuery.isError ? (
          <p role="alert">Không thể tải danh sách chờ xác nhận. Đóng danh sách và thử lại sau.</p>
        ) : rows.length === 0 ? (
          <p role="status">Không còn dòng chờ xác nhận.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={toggleAll}
                disabled={rows.length === 0}
                title={selected.size === rows.length && rows.length > 0 ? 'Bỏ chọn' : `Chọn cả ${rows.length} dòng đang hiện`}
              >
                {selected.size === rows.length && rows.length > 0 ? 'Bỏ chọn tất cả' : `Chọn tất cả (${rows.length})`}
              </button>
              <span style={{ color: 'var(--ink-3)' }}>Bấm vào một dòng để chọn · {selected.size}/{rows.length} đã chọn</span>
            </div>
            <table className="tt-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Báo giá</th>
                  <th>Kỳ giá mới</th>
                  <th><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: QuotationFuelApprovalRow) => (
                  <tr
                    key={row.id}
                    data-selected={selection.isSelected(row.id) || undefined}
                    aria-selected={selection.isSelected(row.id)}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    {...selection.rowProps(row.id)}
                  >
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

const fmtPrice = (v: string) => formatMoney(Number(v));

/** Today as the YYYY-MM-DD the API's dates compare against. */
const todayIso = () => new Date().toISOString().slice(0, 10);

/** SIL-466: the fee engine prices against the period whose effectiveFrom is
 * the latest one ≤ today — surface that ruling as the row's "Đang áp dụng"
 * badge instead of making the reader infer it from the dates. */
function activeFuelPeriodId(items: FuelPricePeriodRow[]): number | null {
  const today = todayIso();
  let active: FuelPricePeriodRow | null = null;
  for (const row of items) {
    if (row.effectiveFrom > today) continue;
    if (!active || row.effectiveFrom > active.effectiveFrom) active = row;
  }
  return active?.id ?? null;
}

/** Badge state for one row: active (latest ≤ today), future, or superseded. */
function fuelPeriodState(item: FuelPricePeriodRow, allItems: FuelPricePeriodRow[]): 'Đang áp dụng' | 'Sắp áp dụng' | null {
  if (item.effectiveFrom > todayIso()) return 'Sắp áp dụng';
  return item.id === activeFuelPeriodId(allItems) ? 'Đang áp dụng' : null;
}

function FuelPricePeriodForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean;
  item?: FuelPricePeriodRow;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(item?.effectiveFrom ?? '');
  const [unitPrice, setUnitPrice] = useState<number | ''>(item?.unitPrice ? Number(item.unitPrice) : '');
  const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? '');

  const canSave = Boolean(effectiveFrom)
    && typeof unitPrice === 'number'
    && unitPrice > 0;

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
          <NumberField
            grouped
            required
            placeholder="21740"
            value={unitPrice}
            onChange={setUnitPrice}
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
            unitPrice,
            ...(sourceNote.trim() ? { sourceNote: sourceNote.trim() } : {}),
          });
        }}
      />
    </InlineForm>
  );
}

export default function FuelPricePeriodsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const { user } = useAuth();
  // The quotation-approval inbox is an accountant surface: `decide` is
  // ACCOUNTANT/ADMIN on the server and the list route is closed by the
  // '/api/config' Casbin guard for every other role. CUS may ENTER fuel prices
  // on this page (docx §5-1), so without this gate the page fired a request
  // that 403s for them (2026-09-27 role sweep: /config/fuel-price-periods).
  const canApproveQuotationFuel = user?.role === Role.ACCOUNTANT || user?.role === Role.ADMIN;
  return (
    <div ref={pageRef}>
      {canApproveQuotationFuel && <QuotationFuelApprovalAlert />}
      <CrudTable<FuelPricePeriodRow>
        title="Giá dầu theo kỳ"
        description="Giá dầu Petrolimex công bố theo kỳ — nhập một bản ghi mỗi lần công bố giá mới"
        endpoint={CONFIG.FUEL_PRICE_PERIODS}
        colSpan={4}
        pageSlug="fuel-price-periods"
        emptyTitle="Chưa có kỳ giá dầu"
        emptyVariant="compact"
        searchPlaceholder="Tìm theo ngày hiệu lực, ghi chú…"
        showIndex={false}
        rowActions
        sortFn={(a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)}
        columns={[
          {
            header: 'Ngày hiệu lực',
            width: 190,
            render: (r, _index, _isActive, allItems) => {
              const state = fuelPeriodState(r, allItems);
              return (
                <span className="fp-period">
                  <span>{formatDate(r.effectiveFrom)}</span>
                  {state && (
                    <span className={state === 'Đang áp dụng' ? 'fp-chip fp-chip--active' : 'fp-chip'}>{state}</span>
                  )}
                </span>
              );
            },
          },
          { header: 'Giá dầu (đ/lít)', width: 130, className: 'num', render: r => fmtPrice(r.unitPrice) },
          {
            header: 'Ghi chú',
            // SIL-466: one line, ellipsis + full-text title tooltip (owner
            // review 24/10 supersedes the wrap doctrine for this cell, same
            // class as the 23/10 debit-board ruling).
            render: r => (r.sourceNote
              ? <span className="fp-note" title={r.sourceNote}>{r.sourceNote}</span>
              : 'Chưa có ghi chú'),
          },
          {
            header: 'Người nhập',
            width: 130,
            // Missing values name their own field (design §1); the legacy
            // null entrant reads '—', never the noisy 'Chưa rõ người nhập'.
            render: r => r.createdByName || '—',
          },
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
