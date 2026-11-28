import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import {
  getPhoiPhieuPartyLots,
  getPhoiPhieuReport,
  type PhoiPhieuPartyLot,
} from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { billBookingReference } from '../../lib/business-reference';
import { formatCurrency } from '../../lib/format';
import { PhoiPhieuPartyLotsDrawer } from '../../pages/accounting/PhoiPhieuPartyLotsDrawer';
import './AccountingWorkInbox.css';

/**
 * 'Công việc kế toán' (K6.42) — ba thẻ Phải thu / Phải trả / Đối chiếu, mỗi
 * dòng mang nút [Tạo phiếu thanh toán] (thu tiền khách hàng) và [Tạo phiếu chi]
 * (chi trả nhà cung cấp). Số liệu tổng hợp theo thời gian thực từ lô hàng và
 * chứng từ đã ghi nhận: hai thẻ tiền đọc báo cáo phơi phiếu theo đối tượng,
 * thẻ Đối chiếu liệt kê các lô mở cả hai chiều (còn phải thu lẫn còn phải trả).
 *
 * Nút theo dòng mở đúng ngăn lập phiếu của đối tượng đó —
 * `PhoiPhieuPartyLotsDrawer`, nơi chọn lô và ghi phiếu qua engine entries —
 * cùng cửa vào với nút 'Lập phiếu thu'/'Lập phiếu chi' màn Kiểm soát phơi
 * phiếu; không có đường ghi phiếu mới nào ở đây.
 */
export function AccountingWorkInbox({ from, to }: { from: string; to: string }) {
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<{ kind: 'THU' | 'TRA'; party: string } | null>(null);

  const thuReport = useQuery({
    queryKey: qk.phoiPhieu.report('THU', from, to),
    queryFn: () => getPhoiPhieuReport('THU', { dateFrom: from, dateTo: to }),
  });
  const traReport = useQuery({
    queryKey: qk.phoiPhieu.report('TRA', from, to),
    queryFn: () => getPhoiPhieuReport('TRA', { dateFrom: from, dateTo: to }),
  });
  const thuLots = useQuery({
    queryKey: qk.phoiPhieu.partyLots('THU', null, from, to),
    queryFn: () => getPhoiPhieuPartyLots('THU', null, { dateFrom: from, dateTo: to }),
  });
  const traLots = useQuery({
    queryKey: qk.phoiPhieu.partyLots('TRA', null, from, to),
    queryFn: () => getPhoiPhieuPartyLots('TRA', null, { dateFrom: from, dateTo: to }),
  });

  const thuRows = useMemo(
    () => (thuReport.data?.rows ?? []).filter((row) => row.conLai > 0),
    [thuReport.data],
  );
  const traRows = useMemo(
    () => (traReport.data?.rows ?? []).filter((row) => row.conLai > 0),
    [traReport.data],
  );
  // Đối chiếu — lô mở cả hai chiều: phía khách còn phải thu và phía nhà xe /
  // nhà cung cấp còn phải trả, nên từng dòng tạo được CẢ hai loại phiếu.
  const doiChieuRows = useMemo(() => {
    const traByLot = new Map((traLots.data?.items ?? []).map((lot) => [lot.shipmentId, lot]));
    return (thuLots.data?.items ?? [])
      .filter((lot) => traByLot.has(lot.shipmentId))
      .map((lot) => ({ thu: lot, tra: traByLot.get(lot.shipmentId) as PhoiPhieuPartyLot }));
  }, [thuLots.data, traLots.data]);

  // The drawer's 'Lập phiếu' postings change both reports and both lot sets —
  // the broad prefixes of the qk.phoiPhieu factories refresh every window.
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.reportAll() });
    void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.partyLotsAll() });
  };

  return (
    <section className="accounting-work-inbox" aria-label="Công việc kế toán">
      <WorkLane
        title="Phải thu"
        summary={thuReport.isError
          ? 'Chưa tải được số liệu.'
          : thuReport.data
            ? `Tổng còn phải thu: ${formatCurrency(thuReport.data.grand.conLai)}`
            : 'Đang tải số liệu…'}
        loading={thuReport.isLoading}
        error={thuReport.isError}
        count={thuRows.length}
        onRefresh={() => void thuReport.refetch()}
        columns={[{ label: 'Đối tượng' }, { label: 'Số lô' }, { label: 'Còn phải thu', className: 'num' }, { label: 'Hành động', className: 'record-table__action' }]}
      >
        {thuRows.map((row) => (
          <tr key={`thu-${row.partyId ?? row.party}`}>
            <td data-label="Đối tượng"><strong>{row.partyShortName ?? row.party}</strong></td>
            <td data-label="Số lô">{row.soLuong}</td>
            <td data-label="Còn phải thu" className="num"><strong>{formatCurrency(row.conLai)}</strong></td>
            <td data-label="" className="record-table__action">
              <RowVoucherButtons
                thuParty={row.party}
                traParty={row.party}
                onOpen={(kind, party) => setDrawer({ kind, party })}
              />
            </td>
          </tr>
        ))}
      </WorkLane>

      <WorkLane
        title="Phải trả"
        summary={traReport.isError
          ? 'Chưa tải được số liệu.'
          : traReport.data
            ? `Tổng còn phải trả: ${formatCurrency(traReport.data.grand.conLai)}`
            : 'Đang tải số liệu…'}
        loading={traReport.isLoading}
        error={traReport.isError}
        count={traRows.length}
        onRefresh={() => void traReport.refetch()}
        columns={[{ label: 'Đối tượng' }, { label: 'Số lô' }, { label: 'Còn phải trả', className: 'num' }, { label: 'Hành động', className: 'record-table__action' }]}
      >
        {traRows.map((row) => (
          <tr key={`tra-${row.partyId ?? row.party}`}>
            <td data-label="Đối tượng"><strong>{row.partyShortName ?? row.party}</strong></td>
            <td data-label="Số lô">{row.soLuong}</td>
            <td data-label="Còn phải trả" className="num"><strong>{formatCurrency(row.conLai)}</strong></td>
            <td data-label="" className="record-table__action">
              <RowVoucherButtons
                thuParty={row.party}
                traParty={row.party}
                onOpen={(kind, party) => setDrawer({ kind, party })}
              />
            </td>
          </tr>
        ))}
      </WorkLane>

      <WorkLane
        title="Đối chiếu"
        summary={thuLots.isError || traLots.isError
          ? 'Chưa tải được số liệu.'
          : thuLots.isLoading || traLots.isLoading
            ? 'Đang tải số liệu…'
            : `${doiChieuRows.length} lô mở cả hai chiều — còn phải thu lẫn còn phải trả`}
        loading={thuLots.isLoading || traLots.isLoading}
        error={thuLots.isError || traLots.isError}
        count={doiChieuRows.length}
        onRefresh={() => { void thuLots.refetch(); void traLots.refetch(); }}
        columns={[{ label: 'Số Bill / Booking' }, { label: 'Khách hàng' }, { label: 'Nhà xe / NCC' }, { label: 'Còn phải thu', className: 'num' }, { label: 'Còn phải trả', className: 'num' }, { label: 'Hành động', className: 'record-table__action' }]}
      >
        {doiChieuRows.map((row) => (
          <tr key={`dc-${row.thu.shipmentId}`}>
            <td data-label="Số Bill / Booking">
              <strong>{billBookingReference(row.thu.billOrBooking) || 'Chưa có số Bill/Booking'}</strong>
            </td>
            <td data-label="Khách hàng">{row.thu.party ?? '—'}</td>
            <td data-label="Nhà xe / NCC">{row.tra.party ?? '—'}</td>
            <td data-label="Còn phải thu" className="num">{formatCurrency(row.thu.conLai)}</td>
            <td data-label="Còn phải trả" className="num">{formatCurrency(row.tra.conLai)}</td>
            <td data-label="" className="record-table__action">
              <RowVoucherButtons
                thuParty={row.thu.party ?? ''}
                traParty={row.tra.party ?? ''}
                onOpen={(kind, party) => setDrawer({ kind, party })}
              />
            </td>
          </tr>
        ))}
      </WorkLane>

      {drawer && (
        <PhoiPhieuPartyLotsDrawer
          kind={drawer.kind}
          party={drawer.party}
          dateFrom={from}
          dateTo={to}
          onClose={() => setDrawer(null)}
          onIssued={refreshAll}
        />
      )}
    </section>
  );
}

function RowVoucherButtons({ thuParty, traParty, onOpen }: {
  thuParty: string;
  traParty: string;
  onOpen: (kind: 'THU' | 'TRA', party: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={() => onOpen('THU', thuParty)}
      >
        Tạo phiếu thanh toán
      </button>{' '}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onOpen('TRA', traParty)}
      >
        Tạo phiếu chi
      </button>
    </>
  );
}

function WorkLane({ title, summary, loading, error, count, onRefresh, columns, children }: {
  title: string;
  summary: string;
  loading: boolean;
  error: boolean;
  count: number;
  onRefresh: () => void;
  /** SIL-1276 — header cells mirror their data cells' alignment classes
   *  (`num` right, `record-table__action` right): a money header left of a
   *  right-aligned value, or 'Hành động' left of the right-aligned button
   *  group, reads as a column it does not belong to (QA 28/11). */
  columns: { label: string; className?: string }[];
  children: ReactNode;
}) {
  return (
    <section className="accounting-work-inbox__lane" aria-label={title}>
      <header>
        <div>
          <h2>{title}</h2>
          <p>{summary}</p>
        </div>
        <button type="button" onClick={onRefresh} aria-label={`Tải lại ${title}`}>
          <RotateCw size={14} aria-hidden="true" />
        </button>
      </header>
      {loading ? (
        <p className="accounting-work-inbox__state">Đang tải {title.toLowerCase()}…</p>
      ) : error ? (
        <p className="accounting-work-inbox__state is-error" role="alert">Không thể tải {title.toLowerCase()}.</p>
      ) : count === 0 ? (
        <p className="accounting-work-inbox__state is-empty">Chưa có khoản nào.</p>
      ) : (
        <div className="record-table-wrap accounting-work-inbox__table-wrap">
          <table className="record-table ops-table accounting-work-inbox__table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.label} scope="col" className={column.className}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {children}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
