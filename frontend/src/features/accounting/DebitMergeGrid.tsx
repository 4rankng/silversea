// Task 2.3 (18/11) — Bảng Ghép bộ Debit: the ONE 6-column-group
// reconciliation grid shared by Kế toán (/accounting/ghep-bo-debit) and CUS
// (/shipments-debit). Props-driven (rows, features, callbacks) — no data
// fetching here; each page owns its query and passes filtered rows in.
//
// Column groups (EXACT headers, per the ticket):
//   1 Thông tin Lô hàng   Ngày | Lô hàng | Khách hàng | Nhà máy | Tuyến đường
//                         (+ NV phụ trách in CUS team mode) + the group's
//                         quick filters (Khách hàng / Tuyến đường) in the toolbar.
//   2 Container           Số cont | Loại cont (BSIU1234567 | 20'DC) — child
//                         rows repeat one container per line via row expansion;
//                         money stays lot-level.
//   3 Cước phải thu       Cước | Lạch Huyện | Phụ phí | Phát sinh | Tổng.
//   4 PHÍ CHI HỘ (Có hóa đơn) — 4 sub-groups from the expense-type catalog's
//                         settlement category.
//   5 PHÍ KHÔNG HÓA ĐƠN   Phí GN OP TC (Thực thu) | Phí PS OP TC (Thực thu) | Tên phí.
//   6 KIỂM SOÁT           Tổng TC | Trạng thái (checkbox per row → Khóa lô /
//                         Chọn Debit).
//
// Money law (debit-summary precedent): a null money cell renders EMPTY —
// never a fabricated 0; a known 0 renders muted '0'. The amber law
// (SIL-801): a known non-zero Tổng TC wears var(--warning-text).
import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DebitMergeInvoiceFee, DebitMergeItem } from '@tingting/shared';
import type { LedgerColumn } from '../../lib/column-visibility';
import { useHiddenColumns } from '../../hooks/useHiddenColumns';
import { ColumnPicker } from '../../components/ColumnPicker';
import { Pagination } from '../../design-system';
import { DisabledActionTip } from '../../components/shared/DisabledActionTip';
import { formatMoney } from '../../lib/format';
import './DebitMergeGrid.css';

export const DEBIT_MERGE_PAGE_SIZES = [20, 50] as const;

/** The visible «Ghép thu cước cùng Lô 1» marker on a rev-group member's
 *  cước cell (SIL-546; the tooltip carries the full F-2 reason). */
export const MERGE_TAG_LABEL = 'Ghép thu cước cùng Lô 1';

interface GridColumnDef extends LedgerColumn {
  /** 1-based column group the leaf belongs to. */
  group: 1 | 2 | 3 | 4 | 5 | 6;
  /** Group 4's sub-group header (null elsewhere). */
  sub?: string;
}

const GROUP_HEADERS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'Thông tin Lô hàng',
  2: 'Container',
  3: 'Cước phải thu',
  4: 'PHÍ CHI HỘ (Có hóa đơn)',
  5: 'PHÍ KHÔNG HÓA ĐƠN',
  6: 'KIỂM SOÁT',
};

/** The base leaf set, in table order. `creator` is appended by the grid when
 *  the page asks for it (CUS team mode). */
const BASE_COLUMNS: GridColumnDef[] = [
  { key: 'ngay', label: 'Ngày', group: 1 },
  { key: 'lot', label: 'Lô hàng', group: 1, pinned: true },
  { key: 'customer', label: 'Khách hàng', group: 1 },
  { key: 'factory', label: 'Nhà máy', group: 1 },
  { key: 'route', label: 'Tuyến đường', group: 1 },
  { key: 'cont', label: 'Số cont', group: 2 },
  { key: 'contType', label: 'Loại cont', group: 2 },
  { key: 'cuoc', label: 'Cước', group: 3 },
  { key: 'lachHuyen', label: 'Lạch Huyện', group: 3 },
  { key: 'phuPhi', label: 'Phụ phí', group: 3 },
  { key: 'phatSinh', label: 'Phát sinh', group: 3 },
  { key: 'tong', label: 'Tổng', group: 3 },
  { key: 'cshtHd', label: 'Số HĐ', group: 4, sub: 'Phí CSHT' },
  { key: 'cshtTien', label: 'Tiền', group: 4, sub: 'Phí CSHT' },
  { key: 'liftHd', label: 'Số HĐ', group: 4, sub: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'liftTien', label: 'Tiền', group: 4, sub: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'liftThucChi', label: 'Thực chi', group: 4, sub: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'dropHd', label: 'Số HĐ', group: 4, sub: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'dropTien', label: 'Tiền', group: 4, sub: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'dropThucChi', label: 'Thực chi', group: 4, sub: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'khacHd', label: 'Số HĐ', group: 4, sub: 'Phí khác' },
  { key: 'khacSoTien', label: 'Số tiền', group: 4, sub: 'Phí khác' },
  { key: 'khacTenPhi', label: 'Tên phí', group: 4, sub: 'Phí khác' },
  { key: 'gnOps', label: 'Phí GN OP TC (Thực thu)', group: 5 },
  { key: 'psOps', label: 'Phí PS OP TC (Thực thu)', group: 5 },
  { key: 'noInvTenPhi', label: 'Tên phí', group: 5 },
  { key: 'tongTc', label: 'Tổng TC', group: 6 },
  { key: 'trangThai', label: 'Trạng thái', group: 6, pinned: true },
];

export interface DebitMergeGridProps {
  rows: DebitMergeItem[];
  /** useHiddenColumns storage key — each surface keeps its own choice. */
  storageKey: string;
  /** CUS team mode: appends the NV phụ trách column to group 1. */
  showCreator?: boolean;
  selection: ReadonlySet<number>;
  onSelectionChange: (id: number, next: boolean) => void;
  /** ShipmentDebitWorkspace's canLock law (ADMIN | ACCOUNTANT | CUS). */
  canLock: boolean;
  /** The office trio only — createSettlementRound is OFFICE_ROLES-gated. */
  canChooseDebit: boolean;
  lockPending?: boolean;
  onLockSelected: (shipmentIds: number[]) => void;
  onChooseDebit: (rows: DebitMergeItem[]) => void;
  /** Row-identity click (the CUS page's Chốt giá bán drawer). */
  onOpenLot?: (row: DebitMergeItem) => void;
  /** The group-1 quick filters (Khách hàng / Tuyến đường), page-owned. */
  quickFilters?: React.ReactNode;
}

/** Money-state cell: null/absent → EMPTY (chưa xác định, never a fabricated
 *  0); 0 → muted '0'; known → formatted. `warn` = the SIL-801 amber tone on
 *  a known NON-zero value (a settled 0 stays muted). */
function MoneyCell({ value, warn, mergeTag }: {
  value: string | null | undefined;
  warn?: boolean;
  mergeTag?: { label: string; title: string } | null;
}) {
  const num = value == null || value === '' ? null : Number(value);
  if (num == null || !Number.isFinite(num)) {
    return <span className="debit-merge-money" />;
  }
  return (
    <span className="debit-merge-money">
      <span className={`debit-merge-money__value${num === 0 ? ' debit-merge-money__zero' : ''}${num !== 0 && warn ? ' debit-merge-money__warn' : ''}`}>
        {formatMoney(num)}
      </span>
      {mergeTag != null && (
        <span className="debit-merge-money__mergetag" title={mergeTag.title}>{mergeTag.label}</span>
      )}
    </span>
  );
}

/** One stacked fee line per invoiced chi-hộ row (money stays lot-level;
 *  several HĐ render as stacked lines inside the cell). */
function FeeStack({ fees, mode }: {
  fees: DebitMergeInvoiceFee[];
  mode: 'hd' | 'amount' | 'actual' | 'name';
}) {
  if (fees.length === 0) return <span className="debit-merge-cell" />;
  return (
    <span className="debit-merge-cell debit-merge-cell--stack">
      {fees.map((fee, index) => (
        <span className="debit-merge-cell__line" key={`${fee.invoiceNumber ?? 'no-hd'}-${index}`}>
          {mode === 'hd' && (fee.invoiceNumber ?? '—')}
          {mode === 'amount' && formatMoney(Number(fee.amount))}
          {mode === 'actual' && (fee.actualAmount == null ? '' : formatMoney(Number(fee.actualAmount)))}
          {mode === 'name' && (fee.feeName ?? '—')}
        </span>
      ))}
    </span>
  );
}

const EMPTY_SET: ReadonlySet<number> = new Set();

export function DebitMergeGrid({
  rows,
  storageKey,
  showCreator = false,
  selection = EMPTY_SET,
  onSelectionChange,
  canLock,
  canChooseDebit,
  lockPending = false,
  onLockSelected,
  onChooseDebit,
  onOpenLot,
  quickFilters,
}: DebitMergeGridProps) {
  const columns = useMemo<GridColumnDef[]>(() => (
    showCreator
      ? [...BASE_COLUMNS.slice(0, 5), { key: 'creator', label: 'NV phụ trách', group: 1 }, ...BASE_COLUMNS.slice(5)]
      : BASE_COLUMNS
  ), [showCreator]);
  const columnsApi = useHiddenColumns({
    storageKey,
    columns,
    hasData: () => true,
  });
  const visibleColumns = useMemo(
    () => columns.filter((column) => !columnsApi.isHidden(column.key)),
    [columns, columnsApi],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEBIT_MERGE_PAGE_SIZES[0]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );
  const [expandedLotId, setExpandedLotId] = useState<number | null>(null);

  // Totals foot (owner redesign 23/10 law — a settlement board MUST show its
  // totals): the sums EQUAL the rendered page's money cells (knowns-sum; a
  // column with no known value reads '—', never a fabricated 0). The Tổng TC
  // sum carries the SIL-801 amber tone when known and non-zero.
  const pageTotals = useMemo(() => {
    const sumKnown = (pick: (row: DebitMergeItem) => string | null): string | null => {
      let sum = 0;
      let any = false;
      for (const row of pageRows) {
        const raw = pick(row);
        if (raw != null && raw !== '') {
          const num = Number(raw);
          if (Number.isFinite(num)) {
            any = true;
            sum += num;
          }
        }
      }
      return any ? String(sum) : null;
    };
    return {
      cuoc: sumKnown((row) => row.revenue.cuoc),
      lachHuyen: sumKnown((row) => row.revenue.lachHuyen),
      phuPhi: sumKnown((row) => row.revenue.phuPhi),
      phatSinh: sumKnown((row) => row.revenue.phatSinh),
      tong: sumKnown((row) => row.revenue.tong),
      tongTc: sumKnown((row) => row.control.tongTc),
    };
  }, [pageRows]);

  const selectedRows = rows.filter((row) => selection.has(row.shipmentId));
  const unlockedSelected = selectedRows.filter((row) => row.control.lockStatus !== 'LOCKED');
  const incompleteLabels = unlockedSelected
    .map((row) => row.billOrBookNumber || row.code || `#${row.shipmentId}`)
    .slice(0, 3);
  const lockDisabledReason = lockPending
    ? 'Đang khóa lô…'
    : !canLock
      ? 'Cần quyền khóa lô hàng.'
      : selectedRows.length === 0
        ? 'Chọn ít nhất một lô chưa khóa.'
        : unlockedSelected.length === 0
          ? 'Các lô đã chọn đều đã khóa.'
          : null;
  const chooseDebitDisabledReason = !canChooseDebit
    ? 'Tài khoản không có quyền chọn Debit.'
    : selectedRows.length === 0
      ? 'Chọn ít nhất một lô.'
      : unlockedSelected.length > 0
        ? `Chọn Debit cần lô đã hoàn tất chi phí (đã khóa): ${incompleteLabels.join(', ')}`
        : null;

  // Header geometry: per group, the visible leaf count + sub-group buckets.
  const groupSpan = (group: 1 | 2 | 3 | 4 | 5 | 6) =>
    visibleColumns.filter((column) => column.group === group).length;

  return (
    <div className="debit-merge" data-component="debit-merge-grid">
      <div className="debit-merge__toolbar">
        <div className="debit-merge__filters" data-testid="debit-merge-quick-filters">{quickFilters}</div>
        <div className="debit-merge__toolbar-actions">
          <DisabledActionTip id="debit-merge-lock" reason={lockDisabledReason}>
            <button
              type="button"
              className="debit-merge__action"
              aria-disabled={lockDisabledReason != null || undefined}
              onClick={() => { if (lockDisabledReason == null) onLockSelected(unlockedSelected.map((row) => row.shipmentId)); }}
            >
              Khóa lô
            </button>
          </DisabledActionTip>
          <DisabledActionTip id="debit-merge-choose" reason={chooseDebitDisabledReason}>
            <button
              type="button"
              className="debit-merge__action debit-merge__action--primary"
              aria-disabled={chooseDebitDisabledReason != null || undefined}
              onClick={() => { if (chooseDebitDisabledReason == null) onChooseDebit(selectedRows); }}
            >
              Chọn Debit
            </button>
          </DisabledActionTip>
          <ColumnPicker
            columns={columns}
            hidden={columnsApi.hidden}
            customized={columnsApi.customized}
            onToggle={columnsApi.toggle}
            onReset={columnsApi.reset}
          />
        </div>
      </div>
      <div className="debit-merge__pane">
        <table className="debit-merge__table">
          <thead>
            <tr className="debit-merge__groups-row">
              {([1, 2, 3, 4, 5, 6] as const).map((group) => {
                const span = groupSpan(group);
                if (span === 0) return null;
                return <th key={group} colSpan={span} scope="colgroup" className="debit-merge__group">{GROUP_HEADERS[group]}</th>;
              })}
            </tr>
            <tr className="debit-merge__subs-row">
              {([1, 2, 3, 4, 5, 6] as const).flatMap((group) => {
                const groupColumns = visibleColumns.filter((column) => column.group === group);
                if (groupColumns.length === 0) return [];
                if (group !== 4) {
                  return [<th key={`sub-${group}`} colSpan={groupColumns.length} aria-hidden="true" className="debit-merge__sub debit-merge__sub--blank" />];
                }
                // Group 4's sub-groups, in their fixed order.
                const subs = [...new Set(groupColumns.map((column) => column.sub!))];
                return subs.map((sub) => (
                  <th key={`sub-${sub}`} colSpan={groupColumns.filter((column) => column.sub === sub).length} scope="colgroup" className="debit-merge__sub">{sub}</th>
                ));
              })}
            </tr>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key} scope="col" data-col={column.key} className={`debit-merge-col--${column.key}`}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const isSelected = selection.has(row.shipmentId);
              const containers = row.containers;
              const expanded = expandedLotId === row.shipmentId && containers.length > 0;
              const lotLabel = row.billOrBookNumber || row.code || `#${row.shipmentId}`;
              const mergeTag = row.revGroupId != null && (row.revGroupOrder ?? 1) > 1 && row.revenue.cuocReason
                ? { label: MERGE_TAG_LABEL, title: row.revenue.cuocReason }
                : null;
              const renderCell = (key: string) => {
                switch (key) {
                  case 'ngay': return <td key={key} data-col={key}>{row.deliveryDate ?? ''}</td>;
                  case 'lot':
                    return (
                      <td key={key} data-col={key} className="debit-merge-cell--lot">
                        {onOpenLot != null ? (
                          <button type="button" className="debit-merge__lot-link" onClick={() => onOpenLot(row)} aria-label={`Mở lô ${lotLabel}`}>{lotLabel}</button>
                        ) : lotLabel}
                        <small className="debit-merge__lot-code">{row.code ?? ''}</small>
                      </td>
                    );
                  case 'customer': return <td key={key} data-col={key}>{row.customerName ?? ''}</td>;
                  case 'factory': return <td key={key} data-col={key}>{row.factoryName ?? ''}</td>;
                  case 'route': return <td key={key} data-col={key}>{row.routeName ?? ''}</td>;
                  case 'creator': return <td key={key} data-col={key}>{row.creatorName ?? ''}</td>;
                  case 'cont':
                    return (
                      <td key={key} data-col={key}>
                        {containers.length > 0 ? (
                          <span className="debit-merge__cont">
                            {containers[0]?.containerNumber ?? '—'}
                            {containers.length > 1 && (
                              <button
                                type="button"
                                className="debit-merge__cont-toggle"
                                aria-expanded={expanded}
                                aria-label={`Containers của lô ${lotLabel}`}
                                onClick={() => setExpandedLotId((current) => (current === row.shipmentId ? null : row.shipmentId))}
                              >
                                {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                                {containers.length}
                              </button>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                    );
                  case 'contType': return <td key={key} data-col={key}>{containers[0]?.containerType ?? ''}</td>;
                  case 'cuoc': return <td key={key} data-col={key}><MoneyCell value={row.revenue.cuoc} mergeTag={mergeTag} /></td>;
                  case 'lachHuyen': return <td key={key} data-col={key}><MoneyCell value={row.revenue.lachHuyen} /></td>;
                  case 'phuPhi': return <td key={key} data-col={key}><MoneyCell value={row.revenue.phuPhi} /></td>;
                  case 'phatSinh': return <td key={key} data-col={key}><MoneyCell value={row.revenue.phatSinh} /></td>;
                  case 'tong': return <td key={key} data-col={key}><MoneyCell value={row.revenue.tong} /></td>;
                  case 'cshtHd': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.csht} mode="hd" /></td>;
                  case 'cshtTien': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.csht} mode="amount" /></td>;
                  case 'liftHd': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.lift} mode="hd" /></td>;
                  case 'liftTien': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.lift} mode="amount" /></td>;
                  case 'liftThucChi': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.lift} mode="actual" /></td>;
                  case 'dropHd': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.drop} mode="hd" /></td>;
                  case 'dropTien': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.drop} mode="amount" /></td>;
                  case 'dropThucChi': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.drop} mode="actual" /></td>;
                  case 'khacHd': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.other} mode="hd" /></td>;
                  case 'khacSoTien': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.other} mode="amount" /></td>;
                  case 'khacTenPhi': return <td key={key} data-col={key}><FeeStack fees={row.chiHo.other} mode="name" /></td>;
                  case 'gnOps': return <td key={key} data-col={key}><MoneyCell value={row.noInvoice.gnOps} /></td>;
                  case 'psOps': return <td key={key} data-col={key}><MoneyCell value={row.noInvoice.psOps} /></td>;
                  case 'noInvTenPhi':
                    return (
                      <td key={key} data-col={key}>
                        {row.noInvoice.fees.length === 0
                          ? <span className="debit-merge-cell" />
                          : (
                            <span className="debit-merge-cell debit-merge-cell--stack">
                              {row.noInvoice.fees.map((fee, index) => (
                                <span className="debit-merge-cell__line" key={`${fee.name ?? 'khong-ten'}-${index}`}>{fee.name ?? '—'}</span>
                              ))}
                            </span>
                          )}
                      </td>
                    );
                  case 'tongTc': return <td key={key} data-col={key}><MoneyCell value={row.control.tongTc} warn /></td>;
                  case 'trangThai':
                    return (
                      <td key={key} data-col={key} className="debit-merge-cell--status">
                        <label className="debit-merge__pick">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => onSelectionChange(row.shipmentId, event.target.checked)}
                            aria-label={`Chọn lô ${lotLabel}`}
                          />
                        </label>
                        <span className={`debit-merge__lock-state${row.control.lockStatus === 'LOCKED' ? ' debit-merge__lock-state--locked' : ''}`}>
                          {row.control.lockStatus === 'LOCKED' ? 'Đã khóa' : 'Mở'}
                        </span>
                      </td>
                    );
                  default: return <td key={key} data-col={key} />;
                }
              };
              return (
                <Fragment key={row.shipmentId}>
                  <tr className="debit-merge__row" data-shipment-id={row.shipmentId}>
                    {visibleColumns.map((column) => renderCell(column.key))}
                  </tr>
                  {expanded && containers.map((container) => (
                    <tr key={`${row.shipmentId}-${container.id}`} className="debit-merge__child-row" aria-label={`Lô ${lotLabel} — container ${container.containerNumber ?? ''}`}>
                      {visibleColumns.map((column) => (
                        <td key={column.key} data-col={column.key} className="debit-merge__child-cell">
                          {column.key === 'cont' ? (container.containerNumber ?? '—')
                            : column.key === 'contType' ? (container.containerType ?? '')
                              : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={visibleColumns.length} className="debit-merge__empty">Không có lô nào khớp bộ lọc hiện tại.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="debit-merge__totals-row" aria-label="Tổng cộng trang">
              {visibleColumns.map((column) => {
                const total = pageTotals[column.key as keyof typeof pageTotals];
                const isMoney = total !== undefined;
                return (
                  <td
                    key={column.key}
                    data-col={column.key}
                    className={`debit-merge__totals-cell debit-merge__totals-cell--${column.key}${column.key === 'tongTc' && total != null && Number(total) !== 0 ? ' debit-merge__totals-cell--warn' : ''}`}
                  >
                    {isMoney ? (total == null ? '—' : formatMoney(Number(total))) : column.key === 'lot' ? 'Tổng cộng' : ''}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={rows.length}
        pageSize={pageSize}
        onChange={setPage}
        pageSizeOptions={DEBIT_MERGE_PAGE_SIZES}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />
    </div>
  );
}
