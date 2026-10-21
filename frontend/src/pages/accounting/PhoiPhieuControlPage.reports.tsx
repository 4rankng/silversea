import { useMemo, useState } from 'react';
import { round2dp } from '@tingting/shared';
import { LedgerRecordList, type LedgerRecord } from '../../components/shared/LedgerRecordList';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPhoiPhieuReport } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { overpayAnnotationOf } from '../../features/accounting/overpayAnnotation';
import { formatCurrency } from '../../lib/format';
import { Money } from '../../components/shared/Money';
import { businessDateISO } from '../../lib/format';
import { DateRangeFields, UuiSelectField } from '../../design-system';
import { PhoiPhieuPartyLotsDrawer } from './PhoiPhieuPartyLotsDrawer';

/** Card 20260928_173 AC3 — "Với khách hàng có phát sinh cả thu / trả 1 tháng …
 *  Ưu tiên hiển thị tổng hợp trên cùng 1 dòng: cả cước phải thu / phải trả, số
 *  lượng". A subject moving on BOTH ledger sides in the period shows one row
 *  carrying both figures and the count; a one-sided subject returns null and
 *  keeps the plain report look. Shared by both tables — that is the point of
 *  criterion 5. */
export function aggregateOf(row: { phaiThu: number; phaiTra: number; soLuong: number }): string | null {
  if (row.phaiThu <= 0 || row.phaiTra <= 0) return null;
  return `Phải thu ${formatCurrency(row.phaiThu)} · Phải trả ${formatCurrency(row.phaiTra)} · ${row.soLuong} lượt`;
}

export function PhoiPhieuReportTable({ kind, dateFrom, dateTo, scope, onOpenParty }: {
  kind: 'THU' | 'TRA'; dateFrom: string; dateTo: string;
  /** Card 20260921_8: omitted = server default (accountant → self). */
  scope?: 'SELF' | 'ALL' | 'UNASSIGNED';
  /** Card 191026160000 — a party name is a drill-down control: clicking it
   *  opens that party's not-yet-paid lots. Absent (old callers/tests) keeps
   *  the plain text cell. */
  onOpenParty?: (party: string) => void;
}) {
  // Card 374 — the two summary tables are the "bảng con tổng hợp thu/trả" the
  // spec names: a settled party (Còn phải thu/trả = 0) hides by default and the
  // toggle below is the way back. Only an exact 0 hides — an overpaid party
  // (negative remaining, the overpay annotation) always stays visible.
  const [showZero, setShowZero] = useState(false);
  const report = useQuery({
    queryKey: qk.phoiPhieu.report(kind, dateFrom, dateTo, scope),
    queryFn: () => getPhoiPhieuReport(kind, { dateFrom, dateTo, scope }),
  });
  const allRows = report.data?.rows ?? [];
  const zeroRemaining = allRows.filter((row) => round2dp(row.conLai) === 0);
  const rows = showZero ? allRows : allRows.filter((row) => round2dp(row.conLai) !== 0);
  const grand = report.data?.grand;
  const caption = kind === 'THU' ? 'Báo cáo Phải thu (theo khách hàng)' : 'Báo cáo Phải trả (theo nhà xe)';
  const zeroTerm = kind === 'THU' ? 'còn phải thu' : 'còn phải trả';
  const recordOf = (row: NonNullable<typeof grand>, title: string): LedgerRecord => ({
    key: row === grand ? 'grand' : `party:${title}`, title, subtitle: caption, facts: [
      { key: 'total', label: kind === 'THU' ? 'Tổng phải thu' : 'Tổng phải trả', value: <Money value={row.tongPhaiThuTra} />, primary: true },
      { key: 'paid', label: kind === 'THU' ? 'Đã thu' : 'Đã trả', value: <Money value={row.daThuTra} />, primary: true },
      { key: 'remaining', label: kind === 'THU' ? 'Còn phải thu' : 'Còn phải trả', value: <Money value={row.conLai} />, primary: true },
      { key: 'lift', label: 'Tiền nâng', value: <Money value={row.tienNang} /> },
      { key: 'drop', label: 'Tiền hạ', value: <Money value={row.tienHa} /> },
      { key: 'extra', label: 'PS khác', value: <Money value={row.psKhac} /> },
      { key: 'aggregate', label: 'Tổng hợp', value: aggregateOf(row) ?? '—' },
      { key: 'notes', label: 'Ghi chú', value: [overpayAnnotationOf({ tongPhaiThuTra: row.tongPhaiThuTra, daThuTra: row.daThuTra }), row.ghiChu].filter(Boolean).join(' · ') || '—' },
    ],
  });
  const partyHeading = kind === 'THU' ? 'Khách hàng' : 'Nhà xe';
  return (<>
    <p style={{ margin: '8px 0' }}>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        aria-pressed={showZero}
        aria-label={showZero
          ? `Ẩn các dòng ${zeroTerm} = 0`
          : `Hiện các dòng ${zeroTerm} = 0 đã ẩn (${zeroRemaining.length})`}
        title={zeroRemaining.length === 0 ? `Không có dòng ${zeroTerm} = 0 trong kỳ này` : undefined}
        disabled={zeroRemaining.length === 0}
        onClick={() => setShowZero((current) => !current)}
      >
        {showZero ? 'Ẩn các dòng còn 0' : `Hiện dòng đã ẩn (${zeroRemaining.length})`}
      </button>
    </p>
    <LedgerRecordList rows={[...rows.map((row) => recordOf(row, row.party)), ...(grand ? [recordOf(grand, 'TỔNG CỘNG')] : [])]} />
    <div className="ppc-board-wrap ledger-desktop" role="region" aria-label={caption} tabIndex={0}>
    <table className="tt-table ops-table ppc-report">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" rowSpan={2} className="ppc-report__ordinal">STT</th>
          <th scope="col" rowSpan={2} className="ppc-report__party">{partyHeading}</th>
          <th scope="col" rowSpan={2} className="ppc-report__money">Tiền nâng</th>
          <th scope="col" rowSpan={2} className="ppc-report__money">Tiền hạ</th>
          <th scope="col" rowSpan={2} className="ppc-report__money">PS khác</th>
          {/* Card 20260924_1 (image11): one direction per table — a tier-1
              group spans three tier-2 sub-columns; the old "thu|trả" cells
              crammed both directions into a single header. */}
          <th scope="col" colSpan={3}>{kind === 'THU' ? 'Phải thu' : 'Phải trả'}</th>
          {/* Card 20260928_173 AC3 — the aggregated row for a subject that moved
              on both ledger sides. The header names no direction so the
              card-20260924_1 contract (no cell mixing thu|trả) still holds. */}
          <th scope="col" rowSpan={2} className="ppc-report__note">Tổng hợp</th>
          <th scope="col" rowSpan={2} className="ppc-report__note">Ghi chú</th>
        </tr>
        <tr>
          <th scope="col" className="ppc-report__money">Tổng</th>
          <th scope="col" className="ppc-report__money">{kind === 'THU' ? 'Đã thu' : 'Đã trả'}</th>
          <th scope="col" className="ppc-report__money">{kind === 'THU' ? 'Còn phải thu' : 'Còn phải trả'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.party}>
            <td className="ppc-report__ordinal">{index + 1}</td>
            <td className="ppc-report__party">
              {/* Card 191026160000 — the party label IS the drill-down
                  control when the section can open the drawer. */}
              {onOpenParty
                ? <button type="button" className="btn btn--ghost btn--sm ppc-report__party-link" onClick={() => onOpenParty(row.party)}>{row.party}</button>
                : row.party}
            </td>
            <td className="num ppc-report__money"><Money value={row.tienNang} /></td><td className="num ppc-report__money"><Money value={row.tienHa} /></td>
            <td className="num ppc-report__money"><Money value={row.psKhac} /></td><td className="num ppc-report__money"><strong><Money value={row.tongPhaiThuTra} /></strong></td>
            <td className="num ppc-report__money"><Money value={row.daThuTra} /></td><td className="num ppc-report__money"><Money value={row.conLai} /></td>
            <td className="ppc-report__note">{aggregateOf(row) ?? '—'}</td>
            <td className="ppc-report__note">{[overpayAnnotationOf({ tongPhaiThuTra: row.tongPhaiThuTra, daThuTra: row.daThuTra }), row.ghiChu].filter(Boolean).join(' · ') || '—'}</td>
          </tr>
        ))}
        {grand && (
          <tr>
            <td colSpan={2} className="ppc-report__party"><strong>TỔNG CỘNG</strong></td>
            <td className="num ppc-report__money"><strong><Money value={grand.tienNang} /></strong></td><td className="num ppc-report__money"><strong><Money value={grand.tienHa} /></strong></td>
            <td className="num ppc-report__money"><strong><Money value={grand.psKhac} /></strong></td><td className="num ppc-report__money"><strong><Money value={grand.tongPhaiThuTra} /></strong></td>
            <td className="num ppc-report__money"><strong><Money value={grand.daThuTra} /></strong></td><td className="num ppc-report__money"><strong><Money value={grand.conLai} /></strong></td>
            <td className="ppc-report__note">{aggregateOf(grand) ?? '—'}</td>
            <td className="ppc-report__note" />
          </tr>
        )}
      </tbody>
    </table>
    </div>
  </>);
}

/** Card 191026160000 (mockup image7/image8) — the whole "BÁO CÁO THU / TRẢ
 *  PHƠI" surface: the old stacked Báo cáo tháng tables become ONE section with
 *  its own date range and a PHẢI THU / PHẢI TRẢ tab pair, and every party row
 *  drills down into its not-yet-paid lots. */
export function PhoiPhieuReportSection() {
  const queryClient = useQueryClient();
  // The section owns its window: the board's hẹn-date filters are a different
  // question, and the mockup puts a range picker ON this report. Default =
  // the running month (the surface it replaces was the monthly report).
  const [range, setRange] = useState(() => {
    const today = businessDateISO();
    return { from: `${today.slice(0, 7)}-01`, to: today };
  });
  const [kind, setKind] = useState<'THU' | 'TRA'>('THU');
  const [scope, setScope] = useState<'' | 'SELF' | 'ALL' | 'UNASSIGNED'>('');
  const [drillParty, setDrillParty] = useState<string | null>(null);
  const scopeOptions = useMemo(() => [
    { value: '', label: 'Mặc định (của tôi với kế toán)' },
    { value: 'SELF', label: 'Của tôi' },
    { value: 'ALL', label: 'Tất cả' },
    { value: 'UNASSIGNED', label: 'Chưa gán' },
  ], []);
  return (
    <div style={{ margin: '16px 0' }}>
      {/* Spec 19/10 (2.2): the block renamed from "Báo cáo tháng" carries its
       *  window in the title — "BÁO CÁO THU / TRẢ PHƠI — Ngày … – …". */}
      <h2 style={{ fontSize: 'var(--text-body-size)' }}>
        Báo cáo thu / trả phơi{range.from || range.to ? ` — Ngày ${range.from || '…'} – ${range.to || '…'}` : ''}
      </h2>
      <div className="ppc-report-controls">
        <DateRangeFields
          id="phoi-phieu-report-range"
          ariaLabel="Khoảng ngày báo cáo"
          from={range.from}
          to={range.to}
          onChange={({ from, to }) => setRange({ from, to })}
        />
        <UuiSelectField
          label="Phạm vi báo cáo"
          hideLabel
          ariaLabel="Phạm vi báo cáo"
          value={scope}
          onChange={(event) => setScope(event.target.value as typeof scope)}
          options={scopeOptions}
          width="content"
        />
        <div className="ppc-report-tabs" role="tablist" aria-label="Loại báo cáo">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'THU'}
            className={kind === 'THU' ? 'ppc-report-tab is-active' : 'ppc-report-tab'}
            onClick={() => setKind('THU')}
          >
            Phải thu
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'TRA'}
            className={kind === 'TRA' ? 'ppc-report-tab is-active' : 'ppc-report-tab'}
            onClick={() => setKind('TRA')}
          >
            Phải trả
          </button>
        </div>
      </div>
      <PhoiPhieuReportTable
        key={kind}
        kind={kind}
        dateFrom={range.from}
        dateTo={range.to}
        scope={scope || undefined}
        onOpenParty={setDrillParty}
      />
      {drillParty != null && (
        <PhoiPhieuPartyLotsDrawer
          kind={kind}
          party={drillParty}
          dateFrom={range.from}
          dateTo={range.to}
          scope={scope || undefined}
          onClose={() => setDrillParty(null)}
          onIssued={() => { void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.report(kind, range.from, range.to, scope || undefined) }); void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll }); }}
        />
      )}
    </div>
  );
}
