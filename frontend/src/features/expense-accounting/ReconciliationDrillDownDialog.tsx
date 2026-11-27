// SIL-1056 QA bounce #3 (KB K2.117) — "mỗi số tổng mở ra được danh sách giao
// dịch": the drill-down of ONE staff's 'Còn phải hoàn ứng'. The backend
// decomposes the SAME law the cell reads and returns the authoritative total
// (signedBalance), so the footer can pin the khớp against the clicked cell.
// SIL-1146 — extracted from OpsReconciliationReportPage so the Quỹ cá nhân
// 'Số dư quỹ' cell (bảng đối soát chi phí, /accounting/hoan-ung) opens the
// SAME dialog: one detail view, one law, no second surface.
import { useQuery } from '@tanstack/react-query';

import { Btn, Modal } from '../../components/UI';
import { Money } from '../../components/shared/Money';
import {
  opsReconciliationReportClient,
  opsReconciliationReportKeys,
  type OpsReconciliationDrillDown,
} from '../../api/opsReconciliationReportClient';
import { formatDate } from '../../lib/format';
import './ReconciliationDrillDownDialog.css';

export interface ReconciliationDrillTarget {
  staffId: number;
  staffName: string;
  /** The cell's remainingSigned at click time — the dialog asserts khớp. */
  cellValue: number;
}

export function ReconciliationDrillDownDialog({ staffId, staffName, cellValue, reconciliationId, onClose }: {
  staffId: number;
  staffName: string;
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
