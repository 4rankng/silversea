// SIL-779 — BẢNG ĐỐI SOÁT CHI PHÍ TẬP TRUNG & QUỸ CÁ NHÂN (/accounting/hoan-ung,
// spec REV2 IV.3.3.3): one table gathering every department-entered cost by
// lot (Ops khai, lái xe khai, chi phí chuyến) so kế toán can review against
// duplicates, tick [Xác nhận chi phí] / [Từ chối] with a mandatory reason, and
// fill Số hóa đơn even when Ops has not uploaded a photo yet (the invoice
// input never reads the evidence state). Below the table, each staff member's
// Quỹ cá nhân with the spec's signed warnings: '(−) Công ty phải chi hoàn trả
// thêm' when confirmed spend ran past the advance, '(+) Nhân viên phải nộp
// trả lại tiền thừa' when the advance outran the spend.
//
// The confirm action rides the EXISTING batch POST /expense-accounting/confirm
// through the row's confirmRef (ops-review law, card 20260921_10) — no forked
// confirmation path; rejection posts the dedicated /reject twin. The reads are
// the EXISTING expense-accounting list projection (cost-review service), so
// the numbers cannot fork from the books they report on.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXPENSE_REVIEW_PROGRESS,
  type CostReviewRow,
  type ExpenseReviewProgress,
  type ExpenseSourceRef,
} from '@tingting/shared';

import { SkeletonTable, StatusText } from '../../components/shared';
import { Money } from '../../components/shared/Money';
import { Btn, PageHeader } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, EmptyState, FilterBar, Pagination, SummaryRail, UuiSelectField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import {
  opsReconciliationReportClient,
  opsReconciliationReportKeys,
} from '../../api/opsReconciliationReportClient';
import { qk } from '../../api/keys';
import { formatDate, formatMoney } from '../../lib/format';
import { useReasonPrompt } from '../../components/reason-prompt';
// The record-table base + ops-table typography: the shared table pattern
// (recipe at styles/record-table.css). Page CSS declares no table skin.
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './CostReconciliationPage.css';

const PROGRESS_LABELS: Record<ExpenseReviewProgress, string> = {
  CHUA_XAC_NHAN: 'Chưa xác nhận',
  DA_XAC_NHAN: 'Đã xác nhận',
  DA_LAP_PHIEU: 'Đã lập phiếu',
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  OPS: 'Ops khai',
  DRIVER: 'Lái xe khai',
  TRIP: 'Chi phí chuyến',
};

const INVOICE_EDIT_REASON = 'Bổ sung số hóa đơn từ bảng đối soát chi phí tập trung.';

const rowKey = (row: Pick<CostReviewRow, 'sourceKind' | 'sourceId'>): string => `${row.sourceKind}:${row.sourceId}`;

function progressVariant(progress: ExpenseReviewProgress): 'warning' | 'success' | 'info' {
  return progress === 'CHUA_XAC_NHAN' ? 'warning' : progress === 'DA_XAC_NHAN' ? 'success' : 'info';
}

/** The spec's signed fund balance: ĐÃ ỨNG − ĐNTT. Positive = advance outran
 *  confirmed spend → staff returns the excess; negative = spend outran the
 *  advance → company reimburses more. It is the negative of the report's
 *  shipped "Còn phải hoàn ứng" (ĐNTT − ĐÃ ỨNG) — both ride card
 *  141026230770's signed formula, displayed in the spec's own orientation. */
function fundBalance(row: { advanced: number; dntt: number }): number {
  return row.advanced - row.dntt;
}

export default function CostReconciliationPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [progress, setProgress] = useState<'' | ExpenseReviewProgress>('');
  const [payerId, setPayerId] = useState('');
  const [page, setPage] = useState(1);
  // Selection of UNCONFIRMED rows for the tick-all batch confirm.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState('');
  const queryClient = useQueryClient();
  const { prompt, dialog } = useReasonPrompt();
  const validRange = !from || !to || from <= to;

  const filters = {
    from: from || undefined,
    to: to || undefined,
    progress: progress || undefined,
    payerId: payerId ? Number(payerId) : undefined,
    page,
    limit: 100,
  };

  const costs = useQuery({
    queryKey: qk.expenseAccounting.costReview(filters),
    queryFn: () => expenseAccountingClient.costReview(filters),
  });
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog });
  // Quỹ cá nhân per staff — the same authority the Báo cáo hoàn ứng reports
  // from, scoped to the same period so the two blocks agree by construction.
  const funds = useQuery({
    queryKey: opsReconciliationReportKeys.list({ from: from || undefined, to: to || undefined }),
    queryFn: () => opsReconciliationReportClient.report({ from: from || undefined, to: to || undefined }),
  });

  const rows = costs.data?.items ?? [];
  const totals = costs.data?.totals ?? { unconfirmedAmount: 0, confirmedAmount: 0, unconfirmedCount: 0, duplicateRows: 0 };
  const fundRows = funds.data?.rows ?? [];
  const unconfirmedRows = rows.filter((row) => row.progress === 'CHUA_XAC_NHAN');
  const selectedRefs = unconfirmedRows.filter((row) => selected.has(rowKey(row))).map((row) => row.confirmRef);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.expenseAccounting.all });
    void queryClient.invalidateQueries({ queryKey: opsReconciliationReportKeys.all });
  };

  const confirmMutation = useMutation({
    mutationFn: (refs: ExpenseSourceRef[]) => expenseAccountingClient.confirm(refs),
    onSuccess: () => { setActionError(''); setSelected(new Set()); invalidate(); },
    onError: (error: Error) => setActionError(error.message),
  });
  const invoiceMutation = useMutation({
    mutationFn: (input: { ref: ExpenseSourceRef; invoiceNumber: string }) =>
      expenseAccountingClient.update(input.ref, { expectedVersion: input.ref.expectedVersion, reason: INVOICE_EDIT_REASON, invoiceNumber: input.invoiceNumber }),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: (error: Error) => setActionError(error.message),
  });

  const rejectRow = async (row: CostReviewRow) => {
    const reason = await prompt(
      `Từ chối khoản chi ${row.feeName} (${formatMoney(row.amount)} ₫) của ${SOURCE_KIND_LABELS[row.sourceKind] ?? row.sourceKind} — lô ${row.shipmentCode}. Khoản sẽ rời khỏi sổ chi phí, lịch sử giữ nguyên.`,
      { reasonLabel: 'Lý do từ chối (bắt buộc)', confirmLabel: 'Từ chối' },
    );
    if (!reason) return;
    try {
      await expenseAccountingClient.reject(row.confirmRef, reason);
      setActionError('');
      invalidate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không từ chối được khoản chi.');
    }
  };

  const toggleRow = (row: CostReviewRow) => {
    setSelected((current) => {
      const next = new Set(current);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allSelected = unconfirmedRows.length > 0 && unconfirmedRows.every((row) => selected.has(rowKey(row)));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(unconfirmedRows.map(rowKey)));
  };

  const isEmptyResult = !costs.isPending && !costs.isError && rows.length === 0;
  const hasRows = !costs.isPending && !costs.isError && rows.length > 0;
  // Sort by lot so the accountant reviews one lô at a time — the grouping the
  // spec asks for, without a second table pattern.
  const sortedRows = [...rows].sort((a, b) =>
    a.shipmentCode.localeCompare(b.shipmentCode, 'vi')
    || a.expenseDate.localeCompare(b.expenseDate)
    || a.sourceKind.localeCompare(b.sourceKind)
    || a.sourceId - b.sourceId);

  return (
    <div className="cost-reconciliation-page">
      <PageHeader
        title="Bảng đối soát chi phí tập trung"
        description="Gom chi phí các bộ phận nhập theo lô hàng để rà soát chống trùng lặp: xác nhận, từ chối, bổ sung số hóa đơn ngay cả khi chưa có ảnh. Dưới bảng là Quỹ cá nhân từng nhân sự kèm cảnh báo chênh lệch."
      />
      <section aria-label="Bộ lọc">
        <FilterBar
          actions={(
            <Btn variant="secondary" size="sm" onClick={() => void costs.refetch()}>Lọc</Btn>
          )}
        >
          <DateRangeFields
            id="cost-reconciliation-date-range"
            ariaLabel="Kỳ đối soát"
            fromLabel="Từ ngày"
            toLabel="Đến ngày"
            from={from}
            to={to}
            onChange={({ from: nextFrom, to: nextTo }) => { setFrom(nextFrom); setTo(nextTo); setPage(1); setSelected(new Set()); }}
          />
          <FilterDropdown
            count={(progress ? 1 : 0) + (payerId ? 1 : 0)}
            ariaLabel="Bộ lọc"
            dialogLabel="Bộ lọc đối soát chi phí"
            onReset={() => { setProgress(''); setPayerId(''); setPage(1); setSelected(new Set()); }}
          >
            <UuiSelectField
              label="Tiến độ"
              ariaLabel="Tiến độ"
              value={progress}
              onChange={(event) => { setProgress(event.target.value as '' | ExpenseReviewProgress); setPage(1); setSelected(new Set()); }}
              options={[{ value: '', label: 'Tất cả' }, ...EXPENSE_REVIEW_PROGRESS.map((value) => ({ value, label: PROGRESS_LABELS[value] }))]}
            />
            <UuiSelectField
              label="Người thực chi"
              ariaLabel="Người thực chi"
              value={payerId}
              onChange={(event) => { setPayerId(event.target.value); setPage(1); setSelected(new Set()); }}
              options={[{ value: '', label: 'Tất cả' }, ...(catalog.data?.opsUsers ?? []).map((person) => ({ value: String(person.id), label: person.name }))]}
            />
          </FilterDropdown>
        </FilterBar>
      </section>

      {!validRange && <p role="alert">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
      {costs.isError && <p role="alert">{costs.error.message} <Btn variant="secondary" size="sm" onClick={() => void costs.refetch()}>Thử lại</Btn></p>}
      {actionError && <p role="alert">{actionError}</p>}

      <SummaryRail
        ariaLabel="Tổng trong trang đang mở"
        items={[
          { label: `Chưa xác nhận — trong trang (${totals.unconfirmedCount})`, value: `${formatMoney(totals.unconfirmedAmount)} ₫` },
          { label: 'Đã xác nhận — trong trang', value: `${formatMoney(totals.confirmedAmount)} ₫` },
          { label: 'Dòng trùng lặp cần rà — trong trang', value: String(totals.duplicateRows) },
        ]}
      />

      {hasRows && unconfirmedRows.length > 0 && (
        <div className="cost-reconciliation-page__actions" role="toolbar" aria-label="Xác nhận hàng loạt">
          <Btn
            variant="primary"
            size="sm"
            disabled={selectedRefs.length === 0 || confirmMutation.isPending}
            onClick={() => confirmMutation.mutate(selectedRefs)}
          >
            {confirmMutation.isPending ? 'Đang xác nhận…' : `Xác nhận chi phí (${selectedRefs.length})`}
          </Btn>
        </div>
      )}

      {costs.isPending && <SkeletonTable rows={5} cols={6} />}
      {isEmptyResult && (
        <EmptyState
          variant="compact"
          context="wallet"
          title="Không có dòng chi phí nào trong bộ lọc."
          description="Điều chỉnh kỳ, tiến độ hoặc người khai — hoặc chi phí chưa được khai báo."
        />
      )}
      {hasRows && (
        <div className="record-table-wrap">
          <table className="record-table ops-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả dòng chưa xác nhận"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={unconfirmedRows.length === 0}
                  />
                </th>
                <th>Lô hàng</th>
                <th>Chi phí</th>
                <th className="num">Số tiền</th>
                <th>Chứng từ</th>
                <th>Số HĐ</th>
                <th>Trạng thái</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <CostRow
                  key={rowKey(row)}
                  row={row}
                  selected={row.progress === 'CHUA_XAC_NHAN' && selected.has(rowKey(row))}
                  onToggle={() => toggleRow(row)}
                  onConfirm={() => confirmMutation.mutate([row.confirmRef])}
                  onReject={() => void rejectRow(row)}
                  onInvoice={(invoiceNumber) => invoiceMutation.mutate({ ref: row.confirmRef, invoiceNumber })}
                  confirming={confirmMutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* SIL-779 review-major: a reconciliation surface never hides rows —
          pager + the loader's total stay visible even when the current page is
          smaller than `limit` (the projection drops INVOICE rows post-query). */}
      {!costs.isPending && !costs.isError && costs.data != null && (
        <Pagination
          page={costs.data.page}
          totalPages={Math.max(1, Math.ceil(costs.data.total / (costs.data.limit || 100)))}
          totalItems={costs.data.total}
          pageSize={costs.data.limit}
          disabled={costs.isFetching}
          onChange={(next) => { setPage(next); setSelected(new Set()); }}
        />
      )}

      <section aria-label="Quỹ cá nhân từng nhân sự" className="cost-reconciliation-page__funds">
        <h2>Quỹ cá nhân từng nhân sự</h2>
        <p className="cost-reconciliation-page__fund-note">
          Số dư quỹ = ĐÃ ỨNG − chi phí ĐNTT đã xác nhận trong kỳ. (+) nhân viên còn giữ tiền phải nộp trả lại; (−) công ty phải chi hoàn trả thêm.
        </p>
        {funds.isPending && <SkeletonTable rows={3} cols={4} />}
        {funds.isError && <p role="alert">{funds.error.message} <Btn variant="secondary" size="sm" onClick={() => void funds.refetch()}>Thử lại</Btn></p>}
        {!funds.isPending && !funds.isError && fundRows.length === 0 && (
          <EmptyState variant="compact" context="wallet" title="Chưa có quỹ cá nhân nào trong kỳ." description="Số dư xuất hiện khi nhân sự được cấp tạm ứng hoặc có chi phí đã xác nhận." />
        )}
        {fundRows.length > 0 && (
          <div className="record-table-wrap">
            <table className="record-table ops-table">
              <thead>
                <tr>
                  <th>Nhân sự</th>
                  <th className="num">Đã ứng</th>
                  <th className="num">Chi ĐNTT đã xác nhận</th>
                  <th className="num">Số dư quỹ</th>
                  <th>Cảnh báo</th>
                </tr>
              </thead>
              <tbody>
                {fundRows.map((row) => {
                  const balance = fundBalance(row);
                  return (
                    <tr key={row.staffId}>
                      <td data-label="Nhân sự">{row.staffName}</td>
                      <td data-label="Đã ứng" className="num"><Money value={row.advanced} /></td>
                      <td data-label="Chi ĐNTT đã xác nhận" className="num"><Money value={row.dntt} /></td>
                      <td data-label="Số dư quỹ" className="num" style={balance < 0 ? { color: 'var(--danger)' } : undefined}>
                        <Money value={Math.abs(balance)} sign={balance > 0 ? '+' : balance < 0 ? '−' : undefined} />
                      </td>
                      <td data-label="Cảnh báo">
                        {/* Two short facts, not one long nowrap line: the
                            StatusText primitive never wraps, so a full
                            sentence inside it overflows the record card at
                            narrow widths (uiux audit 2026-11-10). */}
                        {balance > 0
                          ? (<div className="record-cell-stack">
                            <StatusText variant="warning" dot={false}>{`(+) ${formatMoney(balance)} ₫`}</StatusText>
                            <small>Nhân viên phải nộp trả lại tiền thừa</small>
                          </div>)
                          : balance < 0
                            ? (<div className="record-cell-stack">
                              <StatusText variant="danger" dot={false}>{`(−) ${formatMoney(Math.abs(balance))} ₫`}</StatusText>
                              <small>Công ty phải chi hoàn trả thêm</small>
                            </div>)
                            : <StatusText variant="neutral">Không còn chênh lệch</StatusText>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog}
    </div>
  );
}

function CostRow({ row, selected, onToggle, onConfirm, onReject, onInvoice, confirming }: {
  row: CostReviewRow;
  selected: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onInvoice: (invoiceNumber: string) => void;
  confirming: boolean;
}) {
  const editable = row.progress === 'CHUA_XAC_NHAN';
  const [invoiceDraft, setInvoiceDraft] = useState<string | null>(null);
  const invoiceValue = invoiceDraft ?? row.invoiceNumber ?? '';
  return (
    <tr>
      <td data-label="Chọn">
        {row.progress === 'CHUA_XAC_NHAN' && (
          <input type="checkbox" aria-label={`Chọn ${row.feeName}`} checked={selected} onChange={onToggle} />
        )}
      </td>
      <td data-label="Lô hàng">
        <div className="record-cell-stack">
          <span>{row.shipmentCode}</span>
          <small>{row.customerName}</small>
        </div>
      </td>
      <td data-label="Chi phí">
        <div className="record-cell-stack">
          <span>{row.feeName}</span>
          <small>
            {SOURCE_KIND_LABELS[row.sourceKind] ?? row.sourceKind}{row.payerName ? ` · ${row.payerName}` : ''}
          </small>
          {/* SIL-779 — chống trùng lặp: the badge names how many rows in the
              current window share this lot + fee name + amount. */}
          {row.duplicateCount > 1 && (
            <StatusText variant="warning" dot={false}>⚠ Trùng {row.duplicateCount} dòng cùng lô</StatusText>
          )}
        </div>
      </td>
      <td data-label="Số tiền" className="num"><Money value={row.amount} /></td>
      <td data-label="Chứng từ">
        {/* Photos never gate this screen: missing evidence is a neutral fact
            here, exactly the invoice-entry-late flow the spec allows. */}
        {row.evidenceMissing
          ? <StatusText variant="neutral">Chưa có ảnh</StatusText>
          : <StatusText variant="neutral">Đã có ảnh</StatusText>}
      </td>
      <td data-label="Số HĐ">
        {editable ? (
          <span className="cost-reconciliation-page__invoice">
            <input
              type="text"
              aria-label={`Số hóa đơn ${row.feeName}`}
              value={invoiceValue}
              maxLength={100}
              onChange={(event) => setInvoiceDraft(event.target.value)}
            />
            {invoiceDraft !== null && invoiceDraft !== (row.invoiceNumber ?? '') && (
              <Btn variant="secondary" size="sm" disabled={confirming} onClick={() => onInvoice(invoiceDraft.trim())}>Lưu</Btn>
            )}
          </span>
        ) : (row.invoiceNumber ?? '—')}
      </td>
      <td data-label="Trạng thái">
        <div className="record-cell-stack">
          <StatusText variant={progressVariant(row.progress)}>{PROGRESS_LABELS[row.progress]}</StatusText>
          {row.confirmedAt && <small>{row.confirmedByName ?? '—'} · {formatDate(row.confirmedAt)}</small>}
        </div>
      </td>
      <td data-label="" className="record-table__action">
        {editable ? (
          <>
            <Btn variant="primary" size="sm" disabled={confirming} onClick={onConfirm}>Xác nhận</Btn>
            <Btn variant="secondary" size="sm" disabled={confirming} onClick={onReject}>Từ chối</Btn>
          </>
        ) : '—'}
      </td>
    </tr>
  );
}
