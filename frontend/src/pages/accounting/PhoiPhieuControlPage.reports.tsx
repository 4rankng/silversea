import { useQuery } from '@tanstack/react-query';
import { getPhoiPhieuReport } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { overpayAnnotationOf } from '../../features/accounting/overpayAnnotation';
import { formatCurrency } from '../../lib/format';

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
  return (
    <table className="tt-table ppc-report" style={{ fontSize: 'var(--text-caption-size)' }}>
      <caption>{kind === 'THU' ? 'Báo cáo Phải thu (theo khách hàng)' : 'Báo cáo Phải trả (theo nhà xe)'}</caption>
      <thead>
        <tr>
          <th scope="col" rowSpan={2}>STT</th>
          <th scope="col" rowSpan={2}>{kind === 'THU' ? 'Khách hàng' : 'Nhà xe'}</th>
          <th scope="col" rowSpan={2}>Tiền nâng</th>
          <th scope="col" rowSpan={2}>Tiền hạ</th>
          <th scope="col" rowSpan={2}>PS khác</th>
          {/* Card 20260924_1 (image11): one direction per table — a tier-1
              group spans three tier-2 sub-columns; the old "thu|trả" cells
              crammed both directions into a single header. */}
          <th scope="col" colSpan={3}>{kind === 'THU' ? 'Phải thu' : 'Phải trả'}</th>
          <th scope="col" rowSpan={2}>Ghi chú</th>
        </tr>
        <tr>
          <th scope="col">Tổng</th>
          <th scope="col">{kind === 'THU' ? 'Đã thu' : 'Đã trả'}</th>
          <th scope="col">{kind === 'THU' ? 'Còn phải thu' : 'Còn phải trả'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.party}>
            <td>{index + 1}</td><td>{row.party}</td>
            <td>{formatCurrency(row.tienNang)}</td><td>{formatCurrency(row.tienHa)}</td>
            <td>{formatCurrency(row.psKhac)}</td><td><strong>{formatCurrency(row.tongPhaiThuTra)}</strong></td>
            <td>{formatCurrency(row.daThuTra)}</td><td>{formatCurrency(row.conLai)}</td>
            <td>{[overpayAnnotationOf({ tongPhaiThuTra: row.tongPhaiThuTra, daThuTra: row.daThuTra }), row.ghiChu].filter(Boolean).join(' · ') || '—'}</td>
          </tr>
        ))}
        {grand && (
          <tr>
            <td colSpan={2}><strong>TỔNG CỘNG</strong></td>
            <td><strong>{formatCurrency(grand.tienNang)}</strong></td><td><strong>{formatCurrency(grand.tienHa)}</strong></td>
            <td><strong>{formatCurrency(grand.psKhac)}</strong></td><td><strong>{formatCurrency(grand.tongPhaiThuTra)}</strong></td>
            <td><strong>{formatCurrency(grand.daThuTra)}</strong></td><td><strong>{formatCurrency(grand.conLai)}</strong></td>
            <td />
          </tr>
        )}
      </tbody>
    </table>
  );
}
