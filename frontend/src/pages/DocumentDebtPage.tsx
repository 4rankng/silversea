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

/** SIL-1189 — each column's full th label, also stamped on the column's th
 *  AND td as `data-label`: the key the per-column floors in
 *  DocumentDebtPage.css are pinned to (the DebtListPage attribute-keyed
 *  pattern), so a column can never be crushed below its floor. */
const LAYER_COLUMN_LABELS: Record<ShipmentDocumentDebtLayer, string> = {
  [ShipmentDocumentDebtLayer.EPOD]: 'Lớp 1 · e-POD',
  [ShipmentDocumentDebtLayer.DOCUMENT_SET]: 'Lớp 2 · Bộ hồ sơ chứng từ gốc',
  [ShipmentDocumentDebtLayer.PHOI]: 'Lớp 3 · Phiếu phơi',
};

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
function LayerCell({ layer, columnLabel }: { layer: ShipmentDocumentDebtLayerItem; columnLabel: string }) {
  return (
    <td className="doc-debt__layer" data-layer={layer.layer} data-label={columnLabel}>
      <span className={`doc-debt__status ${toneClass(layer)}`}>{layer.status}</span>
      {layer.missingDocuments.length > 0 ? (
        <p className="doc-debt__missing">{layer.missingDocuments.join(', ')}</p>
      ) : !layer.applicable ? (
        <span className="doc-debt__not-applicable">—</span>
      ) : (
        <span className="doc-debt__ok" role="img" aria-label="Đủ">✓</span>
      )}
      {/* The document-set layer's detail merely restates its own status chip
          ('Còn thiếu') — the cell already names what it owes above, so the
          word would appear twice for one fact. The other layers' details add
          per-trip counts the status chip does not carry. */}
      {layer.detail != null && layer.layer !== ShipmentDocumentDebtLayer.DOCUMENT_SET && (
        <p className="doc-debt__detail">{layer.detail}</p>
      )}
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
          Lô còn thiếu tài liệu — ba nhóm trạng thái chứng từ độc lập:
          e-POD · bộ hồ sơ chứng từ gốc · phiếu phơi.
          Mỗi nhóm nêu tên tài liệu còn thiếu; bộ hồ sơ gốc chỉ "Đã đủ" khi ghi đủ
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
                <th data-label="Số Bill/Booking">Số Bill/Booking</th>
                <th data-label="Khách hàng">Khách hàng</th>
                {LAYER_ORDER.map((layerKey) => (
                  <th key={layerKey} data-label={LAYER_COLUMN_LABELS[layerKey]}>
                    {LAYER_COLUMN_LABELS[layerKey]}
                  </th>
                ))}
                <th data-label="Người nhận">Người nhận</th>
                <th data-label="Ngày nhận thực tế">Ngày nhận thực tế</th>
                <th data-label="Thao tác" aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.shipmentId}>
                  <td data-label="Số Bill/Booking">{row.billOrBookNumber ?? row.shipmentCode ?? '—'}</td>
                  <td data-label="Khách hàng">{row.customerName ?? '—'}</td>
                  {LAYER_ORDER.map((layerKey) => {
                    const layer = row.layers?.find((item) => item.layer === layerKey);
                    // A lagging wire carries no breakdown: the column reads '—',
                    // the screen never fails (same law as the lot-status block).
                    return layer
                      ? <LayerCell key={layerKey} layer={layer} columnLabel={LAYER_COLUMN_LABELS[layerKey]} />
                      : (
                        <td key={layerKey} className="doc-debt__layer" data-label={LAYER_COLUMN_LABELS[layerKey]}>
                          <span className="doc-debt__not-applicable">—</span>
                        </td>
                      );
                  })}
                  <td data-label="Người nhận">{row.receiverName ?? '—'}</td>
                  <td data-label="Ngày nhận thực tế">{formatReceivedOn(row.receivedOn)}</td>
                  <td data-label="Thao tác">
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
