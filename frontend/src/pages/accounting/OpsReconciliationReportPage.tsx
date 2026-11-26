// Card 20260928_169 — BÁO CÁO TỔNG HỢP HOÀN ỨNG. Per staff (monthly view) and
// per đợt (an expense_reconciliations lot, which owns its costs and allocates
// the received advances — PRD OpsVanHanh §9.2). Columns: ĐNTT (confirmed costs
// of the period/đợt), ĐÃ ỨNG (recorded gross advances — SIL-839) and
// "Còn phải hoàn ứng" CÓ DẤU: (+) cá nhân hoàn lại, (−) công ty trả thêm —
// số dư tất toán (tổng đã ứng − tổng ĐNTT đã xác nhận − tổng đã nộp lại −
// tổng đã tất toán qua phiếu), scoped đợt đọc ĐÃ ỨNG phân bổ − ĐNTT đợt.
// Đây là MỘT số cho mọi mặt: cột 'Còn phải hoàn ứng' ở đây, cột 'Số dư quỹ'
// của bảng Quỹ cá nhân, cửa sổ lập phiếu hoàn ứng và /advance-balances
// (?includeAll=true) — cùng chiều dấu (SIL-1083).
// Số dư ví có dấu (`outstandingSigned`) vẫn đi riêng trên row cho bút toán
// thu hồi.
// `remaining` là số SỔ QUỸ (tiền còn nắm, ≥ 0 — parity với sổ quỹ card 377),
// luôn bằng max(0, `remainingSigned`).
// The row action "Lập phiếu" follows the ĐỢT's own difference (the
// reconciliation engine's number): > 0 the company pays (phiếu CHI through the
// existing voucher engine), < 0 the staff pays back (phiếu THU through the
// reconciliation refund) — and the wrong direction is never offered: the
// backend refuses it on both sides (pinned by
// backend/src/tests/card169-reconciliation-report.test.ts).

import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { expenseDateSchema, type ExpenseAccountingEntry, type ExpenseReconciliation } from '@tingting/shared';

import { SkeletonTable, StatusText } from '../../components/shared';
import { Money } from '../../components/shared/Money';
import { Btn, Modal, PageHeader } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, EmptyState, FilterBar, SummaryRail, UuiSelectField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import {
  opsReconciliationReportClient,
  opsReconciliationReportKeys,
  type OpsReconciliationDrillDown,
  type OpsReconciliationReportRow,
} from '../../api/opsReconciliationReportClient';
import { qk } from '../../api/keys';
import { formatDate, formatMoney } from '../../lib/format';
import { useAuth } from '../../hooks/useAuth';
import { ExpenseCashDrawer, type AdvanceRecoveryTarget } from '../../features/expense-accounting/ExpenseCashDrawer';
import { ExpenseVoucherDrawer } from '../../features/expense-accounting/ExpenseVoucherDrawer';
import AdminAdvanceSettlementCreateDialog from '../AdminAdvanceSettlementCreateDialog';
// The record-table base + ops-table typography: the shared table pattern
// (recipe at styles/record-table.css). Page CSS declares no table skin.
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './OpsReconciliationReportPage.css';

function directionVariant(remaining: number): 'warning' | 'info' | 'neutral' {
  // Color law §2: green is money actually received — a pending obligation is
  // never success-toned. > 0 (staff still holds unspent advance) is warning;
  // 0 is neutral. The negative branch stays defensive for older payloads.
  return remaining > 0 ? 'warning' : remaining < 0 ? 'info' : 'neutral';
}

export default function OpsReconciliationReportPage({ embedded = false }: { embedded?: boolean }) {
  // Card 20260928_168 AC4: the Sổ quỹ's TÀI KHOẢN OPS row links here carrying
  // the same period and staff ("cùng một bộ lọc"), so the accountant lands
  // straight on this person's rows and the direction-correct Lập phiếu
  // actions. The URL only seeds the initial filters — after mount the bar
  // owns them.
  const [searchParams] = useSearchParams();
  const seeded = useRef(searchParams);
  const [from, setFrom] = useState(() => {
    const value = seeded.current.get('from');
    return value && expenseDateSchema.safeParse(value).success ? value : '';
  });
  const [to, setTo] = useState(() => {
    const value = seeded.current.get('to');
    return value && expenseDateSchema.safeParse(value).success ? value : '';
  });
  const [staffId, setStaffId] = useState(() => (/^\d+$/.test(seeded.current.get('opsUserId') ?? '') ? seeded.current.get('opsUserId')! : ''));
  const [lotId, setLotId] = useState('');
  const [chiLot, setChiLot] = useState<ExpenseReconciliation | null>(null);
  const [thuLot, setThuLot] = useState<ExpenseReconciliation | null>(null);
  // SIL-728 — Xác nhận hoàn ứng staff-level: một dòng ÂM bất kỳ (không cần lọc
  // đợt) mở bút toán thu hồi về Quỹ công ty.
  const [recovery, setRecovery] = useState<AdvanceRecoveryTarget | null>(null);
  // SIL-728 (QA fail 09/11) — a report-âm row whose balance rides the legacy
  // settlement family opens the SAME "Lập phiếu hoàn ứng" dialog the /advances
  // tab uses, preselecting the row's staff.
  const [createFor, setCreateFor] = useState<{ staffId: number; staffName: string; remaining: number } | null>(null);
  // SIL-1056 QA bounce #3 (KB K2.117) — the 'Còn phải hoàn ứng' cell opens the
  // transaction list that composes it (same law the cell reads).
  const [drill, setDrill] = useState<{ staffId: number; staffName: string; cellValue: number } | null>(null);
  // SIL-827 — the Báo cáo tab carries the same header [Lập phiếu hoàn ứng] the
  // Phiếu hoàn ứng tab has (SIL-487 placement: same row as the filters); it
  // opens the SAME dialog, no preselected staff.
  const [createOpen, setCreateOpen] = useState(false);
  const { user } = useAuth();
  // The create-settlement affordance mirrors the /advances tab's own law
  // (SIL-487): ADMIN/ACCOUNTANT create; MANAGER reads.
  const canReview = user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';
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
  const totals = report.data?.totals ?? { dntt: 0, advanced: 0, advancedRecorded: 0, remaining: 0, remainingSigned: 0 };
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
      {/* SIL-779 — embedded in the Tạm ứng & hoàn ứng workspace the tab already
          names the view, so the page header would repeat it twice. */}
      {!embedded && <PageHeader title="Báo cáo tổng hợp hoàn ứng" description="Tiền ĐNTT đã xác nhận trừ tạm ứng phân bổ, theo nhân viên hoặc theo từng đợt đối soát. Chọn một đợt để lập phiếu thu/chi phần chênh lệch." />}
      <section aria-label="Bộ lọc">
        <FilterBar
          actions={(
            <>
              <Btn variant="secondary" size="sm" onClick={() => void report.refetch()}>Lọc</Btn>
              {/* SIL-827 — SIL-728 AC1: the button lives on BOTH surfaces
                  (Phiếu hoàn ứng tab AND this Báo cáo tab). Same role law as
                  the /advances tab (SIL-487): ADMIN/ACCOUNTANT create,
                  MANAGER reads. */}
              {canReview && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={14} aria-hidden="true" /> Lập phiếu hoàn ứng
                </button>
              )}
            </>
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
        </FilterBar>
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
          // SIL-839 — the rail reads the recorded (Đã ghi nhận) gross total: the
          // SAME shared backend number the Quỹ cá nhân table renders. The old
          // netted `advanced` read 0₫ for fully-settled staff while Quỹ cá nhân
          // showed the disbursements (Hoàng 320.000₫, Cường 25.000.000₫).
          { label: 'Tổng số tiền đã ứng', value: `${formatMoney(totals.advancedRecorded)} ₫` },
          // BỔ SUNG CTO 19/11 — tổng cột CÓ DẤU theo luật dấu mới: (+) cá
          // nhân hoàn lại, (−) công ty trả thêm; unscoped = Σ(ĐÃ ỨNG − ĐNTT)
          // khớp 100% bảng Quỹ cá nhân. Âm hiện rõ dấu thay vì ép về 0. The
          // sign is always visible beside the amount — never a bare number (PRD §9.2).
          { label: 'Tổng còn phải hoàn ứng', value: `${totals.remainingSigned > 0 ? '+' : totals.remainingSigned < 0 ? '−' : ''}${formatMoney(Math.abs(totals.remainingSigned))} ₫` },
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
                {/* Card 377 (spec 5.10, Hình 9): the column titles carry the
                    customer's own vocabulary — "Nhân viên ĐNTT" and the note
                    column titled "Ghi chú". */}
                <th>STT</th><th>Nhân viên ĐNTT</th>
                <th className="num">Số tiền ĐNTT</th>
                <th className="num">Số tiền đã ứng</th>
                <th className="num">Còn phải hoàn ứng</th>
                <th>Ghi chú</th>
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
                  onRecover={(target) => setRecovery(target)}
                  onCreateSettlement={canReview ? (row) => setCreateFor({ staffId: row.staffId, staffName: row.staffName, remaining: row.remainingSigned }) : undefined}
                  onDrill={(row) => setDrill({ staffId: row.staffId, staffName: row.staffName, cellValue: row.remainingSigned })}
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
      {recovery && catalog.data && (
        <ExpenseCashDrawer
          catalog={catalog.data}
          recovery={recovery}
          onClose={() => { setRecovery(null); invalidate(); }}
        />
      )}
      {createFor && (
        <AdminAdvanceSettlementCreateDialog
          open
          initialForwarderId={createFor.staffId}
          initialRemaining={createFor.remaining}
          onClose={() => setCreateFor(null)}
        />
      )}
      {drill && (
        <ReportDrillDialog
          staffId={drill.staffId}
          staffName={drill.staffName}
          cellValue={drill.cellValue}
          reconciliationId={lotId ? Number(lotId) : undefined}
          onClose={() => setDrill(null)}
        />
      )}
      {createOpen && canReview && (
        <AdminAdvanceSettlementCreateDialog open onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

function ReportRow({ row, index, actionLot, onVoucher, onRecover, onCreateSettlement, onDrill }: {
  row: OpsReconciliationReportRow;
  index: number;
  /** The scoped đợt, only when its live difference is still open and belongs
   *  to this row's staff — the wrong-direction control is never rendered. */
  actionLot?: ExpenseReconciliation;
  onVoucher: (lot: ExpenseReconciliation) => void;
  /** SIL-728 — present for finance actors: opens the staff-level recovery. */
  onRecover: (target: AdvanceRecoveryTarget) => void;
  /** SIL-728 (QA fail 09/11) — present for ADMIN/ACCOUNTANT (SIL-487 law,
   *  the caller gates it): opens the same "Lập phiếu hoàn ứng" dialog as the
   *  /advances tab, prefilled with this row's staff. */
  onCreateSettlement?: (row: OpsReconciliationReportRow) => void;
  /** SIL-1056 QA bounce #3 (KB K2.117) — the cell opens the transactions that
   *  compose its number. */
  onDrill: (row: OpsReconciliationReportRow) => void;
}) {
  return (
    <tr>
      <td data-label="STT">{index + 1}</td>
      <td data-label="Nhân viên ĐNTT">{row.staffName}</td>
      <td data-label="Số tiền ĐNTT" className="num"><Money value={row.dntt} /></td>
      {/* SIL-839 — the column reads advancedRecorded: the SAME gross
          (Đã ghi nhận) disbursement number the Quỹ cá nhân's Đã ứng column
          reads, so the two surfaces khớp 100% by construction. */}
      <td data-label="Số tiền đã ứng" className="num"><Money value={row.advancedRecorded} /></td>
      {/* BỔ SUNG CTO 19/11 — "Còn phải hoàn ứng" CÓ DẤU: (+) cá nhân hoàn
          lại, (−) công ty trả thêm (âm vẫn tô đỏ — nghĩa vụ chưa tất toán);
          số dư = ĐÃ ỨNG (GỐC) − ĐNTT, khớp 100% cột Số dư quỹ của Quỹ cá
          nhân (scoped đợt = phân bổ − ĐNTT đợt). */}
      {/* SIL-1056 QA bounce #3 (KB K2.117) — "mỗi số tổng mở ra được danh sách
          giao dịch": the cell is a control; clicking opens the drill-down of
          the exact rows that compose the number. */}
      <td data-label="Còn phải hoàn ứng" className="num" style={row.remainingSigned < 0 ? { color: 'var(--danger)' } : undefined}>
        <button
          type="button"
          className="ops-recon-drill__cell"
          aria-label={`Xem giao dịch tạo nên Còn phải hoàn ứng của ${row.staffName}`}
          onClick={() => onDrill(row)}
        >
          <Money value={Math.abs(row.remainingSigned)} sign={row.remainingSigned > 0 ? '+' : row.remainingSigned < 0 ? '−' : undefined} />
        </button>
      </td>
      <td data-label="Ghi chú">
        {/* BỔ SUNG CTO 19/11 — luật dấu: DƯƠNG cần thu = 'Đề nghị thu tiền
            ứng' (danger — tiền phải thu về); ÂM = công ty trả thêm (warning,
            nghĩa vụ chưa tất toán — color law §2 không bao giờ success-toned);
            0 → neutral theo số sổ quỹ. */}
        {row.needsCollection
          ? <StatusText variant="danger">{row.note}</StatusText>
          : (row.remainingSigned < 0 || row.outstandingSigned < 0)
            ? <StatusText variant="warning">{row.note}</StatusText>
            : <StatusText variant={directionVariant(row.remaining)}>{row.note}</StatusText>}
      </td>
      <td data-label="" className="record-table__action">
        {/* CR-011 Task 2.1: Show "Lập phiếu hoàn ứng" for EVERY staff with remainingSigned !== 0
            (both positive + staff returns cash and negative - company reimburses excess spend).
            Opening the unified settlement dialog preselects the staff and prefills the balance. */}
        {row.remainingSigned !== 0 && onCreateSettlement && (
          <Btn
            variant="primary"
            size="sm"
            onClick={() => onCreateSettlement(row)}
          >
            Lập phiếu hoàn ứng
          </Btn>
        )}
        {/* SIL-728 — the staff-level wallet-deficit recovery stays available
            BESIDE the settlement phiếu (both buttons allowed on a negative
            row): bút toán Quỹ công ty + Idempotency-Key. aria-label
            distinguishes it from the same-named settlement button. */}
        {/* SIL-1056 QA bounce #4 — once a phiếu settled the row (canonical
            remainingSigned nets to 0), the recovery affordance hides with the
            rest: đủ số dư → 0đ + tự ẩn nút — a thu-hồi button on a settled
            row offered a second collection against money already paid. */}
        {row.outstandingSigned < 0 && row.remainingSigned < 0 && (
          <Btn
            variant="primary"
            size="sm"
            aria-label="Lập phiếu hoàn ứng — thu hồi chênh lệch"
            onClick={() => onRecover({
              opsUserId: row.staffId,
              staffName: row.staffName,
              deficit: Math.abs(row.outstandingSigned),
            })}
          >
            Lập phiếu hoàn ứng
          </Btn>
        )}
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

// SIL-1056 QA bounce #3 (KB K2.117) — "mỗi số tổng mở ra được danh sách giao
// dịch": the drill-down of ONE staff's 'Còn phải hoàn ứng'. The backend
// decomposes the SAME law the cell reads and returns the authoritative total
// (signedBalance), so the footer can pin the khớp against the clicked cell.
function ReportDrillDialog({ staffId, staffName, cellValue, reconciliationId, onClose }: {
  staffId: number;
  staffName: string;
  /** The cell's remainingSigned at click time — the dialog asserts khớp. */
  cellValue: number;
  reconciliationId?: number;
  onClose: () => void;
}) {
  const drill = useQuery({
    queryKey: opsReconciliationReportKeys.drillDown(staffId, reconciliationId),
    queryFn: () => opsReconciliationReportClient.drillDown({ opsUserId: staffId, reconciliationId }),
  });
  const data: OpsReconciliationDrillDown | undefined = drill.data;
  const scoped = data?.law === 'LOT_ALLOCATION';
  // Scoped law nets allocations against the lot's own ĐNTT only — the
  // returned/settled groups are whole-book concepts and never render there.
  const groups = data
    ? [data.groups.recorded, data.groups.dntt, ...(scoped ? [] : [data.groups.returned, data.groups.settled])]
      .filter((group) => group.items.length > 0)
    : [];
  const matchesCell = data != null && data.signedBalance === cellValue;
  return (
    <Modal
      isOpen
      title={`Còn phải hoàn ứng — ${staffName}`}
      subtitle={scoped && data?.reconciliation
        ? `Đợt ${data.reconciliation.code} · ${formatDate(data.reconciliation.from)} – ${formatDate(data.reconciliation.to)}`
        : 'Danh sách giao dịch tạo nên số trên bảng (KB K2.117)'}
      polished
      ariaLabel={`Chi tiết Còn phải hoàn ứng của ${staffName}`}
      maxWidth={720}
      onClose={onClose}
      footer={(
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Đóng</button>
      )}
    >
      <div className="ops-recon-drill">
        {drill.isPending && <p role="status">Đang tải giao dịch…</p>}
        {drill.isError && (
          <p role="alert">{drill.error.message} <Btn variant="secondary" size="sm" onClick={() => void drill.refetch()}>Thử lại</Btn></p>
        )}
        {data && groups.map((group) => (
          <section key={group.label} className="ops-recon-drill__group">
            <header className="ops-recon-drill__group-head">
              <h4>{group.label}</h4>
              <strong><Money value={Math.abs(group.total)} sign={group.total < 0 ? '−' : undefined} /> ₫</strong>
            </header>
            <table className="ops-recon-drill__table">
              <thead>
                <tr><th>Ngày</th><th>Giao dịch</th><th className="num">Số tiền</th></tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={`${group.label}-${item.id}`}>
                    <td>{item.date ? formatDate(item.date) : '—'}</td>
                    <td>{item.label}{item.code ? ` · ${item.code}` : ''}</td>
                    <td className="num">
                      <Money value={Math.abs(item.amount)} sign={item.amount < 0 ? '−' : undefined} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {data && (
          <footer className="ops-recon-drill__footer">
            <span>
              {scoped
                ? 'Còn phải hoàn ứng = Tạm ứng phân bổ − ĐNTT đợt'
                : 'Còn phải hoàn ứng = Tổng đã ứng − ĐNTT − Đã nộp lại − Đã tất toán qua phiếu'}
            </span>
            <strong>
              <Money value={Math.abs(data.signedBalance)} sign={data.signedBalance > 0 ? '+' : data.signedBalance < 0 ? '−' : undefined} /> ₫
            </strong>
            <span className="ops-recon-drill__match" data-khokhop={matchesCell ? 'yes' : 'no'} role="status">
              {matchesCell ? 'Khớp số trên bảng.' : 'Chưa khớp số trên bảng — cần đối chiếu.'}
            </span>
          </footer>
        )}
      </div>
    </Modal>
  );
}
