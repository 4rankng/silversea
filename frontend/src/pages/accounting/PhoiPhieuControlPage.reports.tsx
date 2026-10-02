import { LedgerRecordList, type LedgerRecord } from '../../components/shared/LedgerRecordList';
import { useQuery } from '@tanstack/react-query';
import { getPhoiPhieuReport } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { overpayAnnotationOf } from '../../features/accounting/overpayAnnotation';
import { formatCurrency } from '../../lib/format';
import { Money } from '../../components/shared/Money';

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

export function PhoiPhieuReportTable({ kind, dateFrom, dateTo, scope }: {
  kind: 'THU' | 'TRA'; dateFrom: string; dateTo: string;
  /** Card 20260921_8: omitted = server default (accountant → self). */
  scope?: 'SELF' | 'ALL' | 'UNASSIGNED';
}) {
  const report = useQuery({
    queryKey: qk.phoiPhieu.report(kind, dateFrom, dateTo, scope),
    queryFn: () => getPhoiPhieuReport(kind, { dateFrom, dateTo, scope }),
  });
  const rows = report.data?.rows ?? [];
  const grand = report.data?.grand;
  const caption = kind === 'THU' ? 'Báo cáo Phải thu (theo khách hàng)' : 'Báo cáo Phải trả (theo nhà xe)';
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
  return (<>
    <LedgerRecordList rows={[...rows.map((row) => recordOf(row, row.party)), ...(grand ? [recordOf(grand, 'TỔNG CỘNG')] : [])]} />
    <div className="ppc-board-wrap ledger-desktop" role="region" aria-label={caption} tabIndex={0}>
    <table className="tt-table ops-table ppc-report">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" rowSpan={2} className="ppc-report__ordinal">STT</th>
          <th scope="col" rowSpan={2} className="ppc-report__party">{kind === 'THU' ? 'Khách hàng' : 'Nhà xe'}</th>
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
            <td className="ppc-report__ordinal">{index + 1}</td><td className="ppc-report__party">{row.party}</td>
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
