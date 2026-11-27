// SIL-1073 (KB Ch3 §3.5.4, Lớp 2) + SIL-1107 (KB Ch3 §3.5.4, 3 lớp) — the
// "Nợ chứng từ" screen.
//
// One row per visible lot that still OWES a document. The KB's three
// document-status layers are INDEPENDENT, so the screen shows all three side
// by side and never merges them:
//
//   Lớp 1 · e-POD              — Chưa có / Đã lưu
//   Lớp 2 · Bộ hồ sơ gốc       — Còn thiếu / Đang bổ sung / Đã đủ
//   Lớp 3 · Phiếu phơi          — Chưa nhận phơi / Đã nhận phơi
//
// Every layer names the documents it still owes (KB: nêu tên tài liệu thiếu,
// không đồng nhất hóa đơn/biên lai/thuế). A layer that applies to the lot
// and owes nothing renders its tick; a layer that does not apply to the lot
// at all (no trip → no phơi, no e-POD) renders '—' instead of a false tick.
// Lot-less facts (no record at all) arrive as 'Còn thiếu' — the KB default
// state. CUS actors see their own scope through the server's one visibility
// law; the writer gate lives on the lot's review page (DocumentSetCard),
// not here.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShipmentDocumentDebtLayer, type ShipmentDocumentDebtLayerItem } from '@tingting/shared';
import { qk } from '../api/keys';
import { getShipmentDocumentDebt } from '../api/shipmentClient';
import './DocumentDebtPage.css';

/** The three layers, always in this order — a column per layer, whatever the
 *  wire carries. */
const LAYER_ORDER = [
  ShipmentDocumentDebtLayer.EPOD,
  ShipmentDocumentDebtLayer.DOCUMENT_SET,
  ShipmentDocumentDebtLayer.PHOI,
] as const;

function formatReceivedOn(value: string | null): string {
  if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function toneClass(layer: ShipmentDocumentDebtLayerItem): string {
  if (!layer.applicable) return 'doc-debt__tone-none';
  if (layer.ok) return 'doc-debt__tone-complete';
  return 'doc-debt__tone-debt';
}

/** ONE layer cell: the layer's own state chip + the NAMES of the documents it
 *  still owes. The three layers never share a cell — a complete bộ hồ sơ gốc
 *  never hides an open e-POD. */
function LayerCell({ layer }: { layer: ShipmentDocumentDebtLayerItem }) {
  return (
    <td className="doc-debt__layer" data-layer={layer.layer}>
      <span className={`doc-debt__status ${toneClass(layer)}`}>{layer.status}</span>
      {layer.missingDocuments.length > 0 ? (
        <p className="doc-debt__missing">{layer.missingDocuments.join(', ')}</p>
      ) : !layer.applicable ? (
        <span className="doc-debt__not-applicable">—</span>
      ) : (
        <span className="doc-debt__ok" role="img" aria-label="Đủ">✓</span>
      )}
      {layer.detail != null && <p className="doc-debt__detail">{layer.detail}</p>}
    </td>
  );
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
          Lô còn thiếu tài liệu — ba lớp trạng thái chứng từ độc lập theo KB §3.5.4:
          Lớp 1 e-POD · Lớp 2 bộ hồ sơ chứng từ gốc · Lớp 3 phiếu phơi.
          Mỗi lớp nêu tên tài liệu còn thiếu; bộ hồ sơ gốc chỉ "Đã đủ" khi ghi đủ
          Người nhận + Ngày nhận thực tế. Ghi nhận trạng thái tại Chi tiết lô.
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
                <th>Lớp 1 · e-POD</th>
                <th>Lớp 2 · Bộ hồ sơ chứng từ gốc</th>
                <th>Lớp 3 · Phiếu phơi</th>
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
                  {LAYER_ORDER.map((layerKey) => {
                    const layer = row.layers?.find((item) => item.layer === layerKey);
                    // A lagging wire carries no breakdown: the column reads '—',
                    // the screen never fails (same law as the lot-status block).
                    return layer
                      ? <LayerCell key={layerKey} layer={layer} />
                      : (
                        <td key={layerKey} className="doc-debt__layer">
                          <span className="doc-debt__not-applicable">—</span>
                        </td>
                      );
                  })}
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
