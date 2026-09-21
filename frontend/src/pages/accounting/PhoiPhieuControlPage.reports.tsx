import { useQuery } from '@tanstack/react-query';
import { getPhoiPhieuReport } from '../../api/phoiPhieuClient';
import { formatCurrency } from '../../lib/format';

export function PhoiPhieuReportTable({ kind, dateFrom, dateTo }: {
  kind: 'THU' | 'TRA'; dateFrom: string; dateTo: string;
}) {
  const report = useQuery({
    queryKey: ['phoi-phieu-report', kind, dateFrom, dateTo],
    queryFn: () => getPhoiPhieuReport(kind, { dateFrom, dateTo }),
  });
  const rows = report.data?.rows ?? [];
  const grand = report.data?.grand;
  return (
    <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)' }}>
      <caption>{kind === 'THU' ? 'Báo cáo Phải thu (theo khách hàng)' : 'Báo cáo Phải trả (theo nhà xe)'}</caption>
      <thead><tr>
        <th>STT</th><th>{kind === 'THU' ? 'Khách hàng' : 'Nhà xe'}</th><th>Tiền nâng</th><th>Tiền hạ</th>
        <th>PS khác</th><th>Tổng phải thu|trả</th><th>Đã thu|trả</th><th>Còn phải thu|trả</th><th>Ghi chú</th>
      </tr></thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.party}>
            <td>{index + 1}</td><td>{row.party}</td>
            <td>{formatCurrency(row.tienNang)}</td><td>{formatCurrency(row.tienHa)}</td>
            <td>{formatCurrency(row.psKhac)}</td><td><strong>{formatCurrency(row.tongPhaiThuTra)}</strong></td>
            <td>{formatCurrency(row.daThuTra)}</td><td>{formatCurrency(row.conLai)}</td>
            <td>{row.daThuTra > row.tongPhaiThuTra && row.tongPhaiThuTra > 0 ? 'Đã thu/trả vượt — cần hoàn lại phần chênh' : row.ghiChu ?? '—'}</td>
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
