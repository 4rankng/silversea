// SIL-1073 (KB Ch3 §3.5.4, Lớp 2) — the "Nợ chứng từ" screen.
//
// One row per visible lot whose ORIGINAL document set is not 'Đã đủ': the
// latest set fact's status, the missing-document NAMES (KB: nêu tên tài liệu
// thiếu, không đồng nhất hóa đơn/biên lai/thuế), and the receiver + actual
// received date when the set already landed. Lot-less facts (no record at
// all) arrive as 'Còn thiếu' — the KB default state. CUS actors see their own
// scope through the server's one visibility law; the writer gate lives on the
// lot's review page (DocumentSetCard), not here.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShipmentDocumentSetStatus } from '@tingting/shared';
import { qk } from '../api/keys';
import { getShipmentDocumentDebt } from '../api/shipmentClient';
import './DocumentDebtPage.css';

function formatReceivedOn(value: string | null): string {
  if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function toneClass(status: ShipmentDocumentSetStatus): string {
  if (status === ShipmentDocumentSetStatus.COMPLETE) return 'doc-debt__tone-complete';
  if (status === ShipmentDocumentSetStatus.SUPPLEMENTING) return 'doc-debt__tone-progress';
  return 'doc-debt__tone-debt';
}

export default function DocumentDebtPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.shipmentDocumentDebt,
    queryFn: getShipmentDocumentDebt,
  });

  return (
    <div className="doc-debt">
      <header className="doc-debt__head">
        <h1>Nợ chứng từ</h1>
        <p className="doc-debt__hint">
          Lô còn thiếu bộ hồ sơ chứng từ gốc (Lớp 2): từ Còn thiếu, Đang bổ sung đến Đã đủ —
          "Đã đủ" chỉ khi ghi đủ Người nhận + Ngày nhận thực tế. Ghi nhận trạng thái tại Chi tiết lô.
        </p>
      </header>

      {isLoading && <p className="doc-debt__quiet">Đang tải danh sách nợ chứng từ…</p>}
      {isError && (
        <div className="doc-debt__error">
          <p>Không tải được danh sách nợ chứng từ. Vui lòng thử lại.</p>
          <button type="button" onClick={() => void refetch()}>Thử lại</button>
        </div>
      )}

      {data != null && data.length === 0 && (
        <p className="doc-debt__quiet doc-debt__empty">Không có lô nào nợ chứng từ.</p>
      )}

      {data != null && data.length > 0 && (
        <div className="doc-debt__scroll">
          <table className="doc-debt__table">
            <thead>
              <tr>
                <th>Số Bill/Booking</th>
                <th>Khách hàng</th>
                <th>Trạng thái hồ sơ</th>
                <th>Tài liệu còn thiếu</th>
                <th>Người nhận</th>
                <th>Ngày nhận thực tế</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.shipmentId}>
                  <td>{row.billOrBookNumber ?? row.shipmentCode ?? '—'}</td>
                  <td>{row.customerName ?? '—'}</td>
                  <td>
                    <span className={`doc-debt__status ${toneClass(row.status)}`} data-status={row.status}>
                      {row.label}
                    </span>
                  </td>
                  <td className="doc-debt__missing">
                    {row.missingDocuments.length > 0
                      ? row.missingDocuments.join(', ')
                      : (row.status === ShipmentDocumentSetStatus.MISSING ? 'Chưa ghi nhận danh mục' : '—')}
                  </td>
                  <td>{row.receiverName ?? '—'}</td>
                  <td>{formatReceivedOn(row.receivedOn)}</td>
                  <td>
                    <Link className="doc-debt__open" to={`/shipments/${row.shipmentId}`}>Mở lô</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
