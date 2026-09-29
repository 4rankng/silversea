// Card 20260928_169 — BÁO CÁO TỔNG HỢP HOÀN ỨNG. Per staff (monthly view) and
// per đợt (an expense_reconciliations lot, which owns its costs and allocates
// the received advances — PRD OpsVanHanh §9.2). Columns: ĐNTT (confirmed costs
// of the period/đợt) and ĐÃ ỨNG (held advances; scoped to a đợt, what the lot
// allocated); "Còn phải hoàn ứng" is the SỔ QUỸ closing number —
// min(đã ứng, đã cấp) − đã tiêu, the granted-but-unconsumed advance — per the
// 2026-09-29 PM ruling (card 168 board "RULING PM" câu 1), so this report and
// the fund book's OPS row are one definition and cannot diverge.
// The row action "Lập phiếu" follows the ĐỢT's own difference (the
// reconciliation engine's number): > 0 the company pays (phiếu CHI through the
// existing voucher engine), < 0 the staff pays back (phiếu THU through the
// reconciliation refund) — and the wrong direction is never offered: the
// backend refuses it on both sides (pinned by
// backend/src/tests/card169-reconciliation-report.test.ts).

import { useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExpenseAccountingEntry, ExpenseReconciliation } from '@tingting/shared';

import { SkeletonTable, StatusText } from '../../components/shared';
import { Btn, PageHeader } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { ListFilterBar } from '../../components/ListFilterBar';
import { DateRangeFields, EmptyState, SummaryRail, UuiSelectField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import {
  opsReconciliationReportClient,
  opsReconciliationReportKeys,
  type OpsReconciliationReportRow,
} from '../../api/opsReconciliationReportClient';
import { qk } from '../../api/keys';
import { formatDate, formatMoney } from '../../lib/format';
import { ExpenseCashDrawer } from '../../features/expense-accounting/ExpenseCashDrawer';
import { ExpenseVoucherDrawer } from '../../features/expense-accounting/ExpenseVoucherDrawer';
// The record-table base + ops-table typography: the shared table pattern
// (recipe at styles/record-table.css). Page CSS declares no table skin.
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';

/** The sign is always visible and always labeled beside the amount — never a
 *  bare number (PRD §9.2). '+' the staff still holds granted, unconsumed
 *  advance money; 0 nothing is left to settle. */
function remainingText(remaining: number): string {
  const sign = remaining > 0 ? '+' : remaining < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(remaining))} ₫`;
}

function directionVariant(remaining: number): 'warning' | 'info' | 'neutral' {
  // Color law §2: green is money actually received — a pending obligation is
  // never success-toned. > 0 (staff still holds unspent advance) is warning;
  // 0 is neutral. The negative branch stays defensive for older payloads.
  return remaining > 0 ? 'warning' : remaining < 0 ? 'info' : 'neutral';
}

export default function OpsReconciliationReportPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [staffId, setStaffId] = useState('');
  const [lotId, setLotId] = useState('');
  const [chiLot, setChiLot] = useState<ExpenseReconciliation | null>(null);
  const [thuLot, setThuLot] = useState<ExpenseReconciliation | null>(null);
  const queryClient = useQueryClient();
  const validRange = !from || !to || from <= to;

  const report = useQuery({
    queryKey: opsReconciliationReportKeys.list({
      from: from || undefined,
      to: to || undefined,
      reconciliationId: lotId ? Number(lotId) : undefined,
      opsUserId: staffId ? Number(staffId) : undefined,
    }),
    queryFn: () => opsReconciliationReportClient.report({
      from: from || undefined,
      to: to || undefined,
      reconciliationId: lotId ? Number(lotId) : undefined,
      opsUserId: staffId ? Number(staffId) : undefined,
    }),
  });
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog });
  const lots = useQuery({ queryKey: qk.expenseAccounting.reconciliations, queryFn: expenseAccountingClient.reconciliations });

  const rows = report.data?.rows ?? [];
  const totals = report.data?.totals ?? { dntt: 0, advanced: 0, remaining: 0 };
  const scopedLot = lotId ? lots.data?.items.find((lot) => lot.id === Number(lotId)) : undefined;
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: opsReconciliationReportKeys.all });
    void queryClient.invalidateQueries({ queryKey: qk.expenseAccounting.reconciliations });
  };

  // The report row carries the đợt's INITIAL difference (PRD §9.2: making the
  // bảng must not assume the money moved), while the lot's live
  // remainingDifference is what is LEFT after phiếu thu/chi settled part of it.
  // The action therefore reads the live number: once the phiếu posts, the
  // action disappears instead of offering a voucher the backend will refuse.
  const lotOptions = (lots.data?.items ?? []).filter((lot) => !lot.voidedAt)
    .map((lot) => ({ value: String(lot.id), label: `${lot.code} · ${formatDate(lot.from)} – ${formatDate(lot.to)}` }));
  const liveLot = scopedLot && !scopedLot.voidedAt && scopedLot.remainingDifference !== 0 ? scopedLot : undefined;

  const isEmptyResult = !report.isPending && !report.isError && rows.length === 0;
  const hasRows = !report.isPending && !report.isError && rows.length > 0;

  return (
    <div className="ops-reconciliation-report-page">
      <PageHeader title="Báo cáo tổng hợp hoàn ứng" description="Tiền ĐNTT đã xác nhận trừ tạm ứng phân bổ, theo nhân viên hoặc theo từng đợt đối soát. Chọn một đợt để lập phiếu thu/chi phần chênh lệch." />
      <section aria-label="Bộ lọc">
        <ListFilterBar
          actions={(
            <Btn variant="secondary" size="sm" onClick={() => void report.refetch()}>Lọc</Btn>
          )}
        >
          <DateRangeFields
            id="ops-reconciliation-report-date-range"
            ariaLabel="Kỳ báo cáo"
            fromLabel="Từ ngày"
            toLabel="Đến ngày"
            from={from}
            to={to}
            onChange={({ from: nextFrom, to: nextTo }) => { setFrom(nextFrom); setTo(nextTo); }}
          />
          <FilterDropdown
            count={(staffId ? 1 : 0) + (lotId ? 1 : 0)}
            ariaLabel="Bộ lọc"
            dialogLabel="Bộ lọc báo cáo hoàn ứng"
            onReset={() => { setStaffId(''); setLotId(''); }}
          >
            <UuiSelectField
              label="Nhân viên"
              ariaLabel="Nhân viên"
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              options={[{ value: '', label: 'Tất cả' }, ...(catalog.data?.opsUsers ?? []).map((person) => ({ value: String(person.id), label: person.name }))]}
            />
            <UuiSelectField
              label="Đợt đối soát"
              ariaLabel="Đợt đối soát"
              value={lotId}
              onChange={(event) => setLotId(event.target.value)}
              options={[{ value: '', label: 'Tất cả' }, ...lotOptions]}
            />
          </FilterDropdown>
        </ListFilterBar>
      </section>

      {report.data?.reconciliation && (
        <p role="status" className="ops-reconciliation-report-page__scope">
          Đợt {report.data.reconciliation.code} · kỳ {formatDate(report.data.reconciliation.from)} – {formatDate(report.data.reconciliation.to)} — đợt tự định kỳ báo cáo.
        </p>
      )}
      {!validRange && <p role="alert">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
      {report.isError && <p role="alert">{report.error.message} <Btn variant="secondary" size="sm" onClick={() => void report.refetch()}>Thử lại</Btn></p>}

      <SummaryRail
        ariaLabel="Tổng theo bộ lọc"
        items={[
          { label: 'Tổng số tiền ĐNTT', value: `${formatMoney(totals.dntt)} ₫` },
          { label: 'Tổng số tiền đã ứng', value: `${formatMoney(totals.advanced)} ₫` },
          { label: 'Tổng còn phải hoàn ứng', value: remainingText(totals.remaining) },
        ]}
      />

      {report.isPending && <SkeletonTable rows={5} cols={6} />}
      {isEmptyResult && (
        <EmptyState
          variant="compact"
          context="wallet"
          title="Không có dòng hoàn ứng nào trong bộ lọc."
          description="Điều chỉnh kỳ hoặc đợt đối soát, hoặc lập bảng hoàn ứng trước."
        />
      )}
      {hasRows && (
        <div className="record-table-wrap">
          <table className="record-table ops-table">
            <thead>
              <tr>
                <th>STT</th><th>Nhân viên</th>
                <th className="num">Số tiền ĐNTT</th>
                <th className="num">Số tiền đã ứng</th>
                <th className="num">Còn phải hoàn ứng</th>
                <th>Chiều</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <ReportRow
                  key={row.staffId}
                  row={row}
                  index={index}
                  actionLot={row.staffId === liveLot?.opsUserId ? liveLot : undefined}
                  onVoucher={(lot) => (lot.remainingDifference > 0 ? setChiLot(lot) : setThuLot(lot))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chiLot && catalog.data && (
        <LotChiVoucherDialog
          lot={chiLot}
          accounts={catalog.data.accounts}
          onClose={() => setChiLot(null)}
          onSaved={() => { setChiLot(null); invalidate(); }}
        />
      )}
      {thuLot && catalog.data && (
        <ExpenseCashDrawer
          catalog={catalog.data}
          reconciliation={thuLot}
          onClose={() => { setThuLot(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function ReportRow({ row, index, actionLot, onVoucher }: {
  row: OpsReconciliationReportRow;
  index: number;
  /** The scoped đợt, only when its live difference is still open and belongs
   *  to this row's staff — the wrong-direction control is never rendered. */
  actionLot?: ExpenseReconciliation;
  onVoucher: (lot: ExpenseReconciliation) => void;
}) {
  return (
    <tr>
      <td data-label="STT">{index + 1}</td>
      <td data-label="Nhân viên">{row.staffName}</td>
      <td data-label="Số tiền ĐNTT" className="num">{formatMoney(row.dntt)} ₫</td>
      <td data-label="Số tiền đã ứng" className="num">{formatMoney(row.advanced)} ₫</td>
      <td data-label="Còn phải hoàn ứng" className="num">{remainingText(row.remaining)}</td>
      <td data-label="Chiều">
        <StatusText variant={directionVariant(row.remaining)}>{row.note}</StatusText>
      </td>
      <td data-label="" className="record-table__action">
        {actionLot && (
          <Btn variant="primary" size="sm" onClick={() => onVoucher(actionLot)}>
            {actionLot.remainingDifference > 0 ? 'Lập phiếu chi' : 'Lập phiếu thu'}
          </Btn>
        )}
      </td>
    </tr>
  );
}

/** The phiếu CHI rides the existing voucher engine: it needs the đợt's cost
 *  entries as full rows (outstanding payable per source), fetched through the
 *  same per-entry query the reconciliation history detail uses. */
function LotChiVoucherDialog({ lot, accounts, onClose, onSaved }: {
  lot: ExpenseReconciliation;
  accounts: Array<{ id: number; name: string; fundCode: 'COMPANY' | 'TM' | null }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queries = useQueries({
    queries: lot.entries.map((source) => ({
      queryKey: qk.expenseAccounting.entry(source.sourceKind, source.sourceId),
      queryFn: () => expenseAccountingClient.get(source),
    })),
  });
  const failed = queries.find((query) => query.isError);
  if (failed) {
    return (
      <div role="alert">
        Không tải được khoản chi của đợt. <Btn variant="secondary" size="sm" onClick={() => void failed.refetch()}>Thử lại</Btn>
      </div>
    );
  }
  if (queries.some((query) => query.isPending)) return <p role="status">Đang tải khoản chi của đợt…</p>;
  const entries = queries.map((query) => query.data).filter((entry): entry is ExpenseAccountingEntry => entry != null);
  if (entries.length === 0) return <p role="status">Đợt không còn khoản chi để lập phiếu.</p>;
  return (
    <ExpenseVoucherDrawer
      entries={entries}
      direction="OUT"
      accounts={accounts}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
