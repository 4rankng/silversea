// Card 20260922_56/57 — one route block of the live quotation grid: the
// fuel-parameter strip + the 5×11 class table. Extracted from
// QuotationConfigPage (structure-guard split candidate; page pinned 440).
// D4/D5 (card _57/_62 finish-out): liters derive as km × norm × 2 — raw
// floats leak tails ("33.800000000000004") and the lít row carried the
// currency formatter ("20 đ"). Liters are not money: cap at one decimal,
// no currency suffix; the đồng formatters stay on money columns only.
import { useState } from 'react';
import { QUOTATION_GRID_COLUMNS, QUOTATION_TRUCK_CLASS_COUNT, type QuotationCellView } from '@tingting/shared';
import { Money } from '../../components/shared/Money';
import { LedgerMatrix } from '../../components/shared/LedgerMatrix';
import { TextField } from '../../design-system';

export const ROW_LABELS = ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí', 'Tổng'] as const;

export function fmtLiters(value: number | null | undefined): string {
  return value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
}

/** SIL-1038 (K5.11) — mô tả luật làm tròn PHẢI khớp mode của khung; chuỗi
 *  cứng "từ 5 lên" từng nói dối khi khung đang để 'Không làm tròn'. */
export function roundingRuleLabel(mode: 'NONE' | 'THOUSAND' | 'TEN_THOUSAND'): string {
  if (mode === 'THOUSAND') return 'Làm tròn phụ phí: đến hàng nghìn (từ 5 lên)';
  if (mode === 'TEN_THOUSAND') return 'Làm tròn phụ phí: đến hàng chục nghìn (từ 5 lên)';
  return 'Làm tròn phụ phí: không làm tròn';
}

/** SIL-1038 — ô Hệ số KHÔNG BAO GIỜ trống: giá trị dây lạ (chuỗi rỗng, NaN,
 *  null, undefined) đều quy về hệ số 1 để màn hình luôn hiện số. Hệ số 0 là
 *  giá trị hợp lệ (tắt dòng phụ phí) — hiển thị đúng '0'. */
export function heSoDisplay(value: number | string | null | undefined): string {
  if (value == null) return '1';
  const n = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value)) : value;
  return String(Number.isFinite(n) ? n : 1);
}

function money(value: number | null | undefined) {
  return value == null ? '—' : <Money value={value} className="data-token" />;
}

export interface RouteBlockData {
  routeId: number;
  routeName: string;
  /** SIL-1038 — luật làm tròn của khung; strip hiển thị đúng luật này. */
  surchargeRoundingMode: 'NONE' | 'THOUSAND' | 'TEN_THOUSAND';
  cells: QuotationCellView[];
}

function cellKey(cell: { routeId: number; vehicleSizeClassCode: string }): string {
  return `${cell.routeId}:${cell.vehicleSizeClassCode}`;
}

export function RouteBlock({ block, saving, onSaveHeSo }: {
  block: RouteBlockData;
  saving: boolean;
  onSaveHeSo: (cells: Array<{ routeId: number; vehicleSizeClassCode: string; heSo: number }>) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const head = block.cells[0];
  const baseFuel = head?.baseFuelPrice ?? null;
  const lag = head?.fuelLagDays ?? null;

  function commitHeSo() {
    if (saving) return;
    let changed = false;
    const invalidDrafts: Record<string, string> = {};
    const cells = block.cells.map((cell) => {
      const key = cellKey(cell);
      const raw = drafts[key];
      const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw.replace(',', '.'));
      const valid = Number.isFinite(parsed) && parsed >= 0;
      const heSo = valid ? parsed : cell.heSo;
      if (raw !== undefined && !valid) invalidDrafts[key] = String(cell.heSo);
      if (heSo !== cell.heSo) changed = true;
      return { routeId: cell.routeId, vehicleSizeClassCode: cell.vehicleSizeClassCode, heSo };
    });
    if (Object.keys(invalidDrafts).length) setDrafts((current) => ({ ...current, ...invalidDrafts }));
    if (changed) onSaveHeSo(cells);
  }

  function coefficient(cell: QuotationCellView) {
    const key = cellKey(cell);
    return <TextField
      aria-label={`Hệ số ${block.routeName} ${cell.vehicleSizeClassCode}`}
      value={drafts[key] ?? heSoDisplay(cell.heSo)}
      onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
      onBlur={commitHeSo}
      disabled={saving}
      inputMode="decimal"
      controlSize="sm"
      controlWidth="short-number"
    />;
  }

  return (
    <section className="quotation-route-block" data-route-id={block.routeId}>
      <div className="quotation-route-block__head">
        <h3>{block.routeName}</h3>
        <p className="quotation-route-block__params">
          Giá dầu tham chiếu {money(baseFuel)}/lít · Trễ {lag ?? '—'} ngày (theo khung giá) · {roundingRuleLabel(block.surchargeRoundingMode)}
        </p>
        <p className="quotation-route-block__link">
          <a href="/config/freight-rate-terms">Sửa tham số giá dầu/ngày trễ tại Bảng điều kiện giá</a>
        </p>
      </div>
        <LedgerMatrix framed caption={<span className="sr-only">{block.routeName}</span>}
          className="quotation-grid tt-table table-matrix"
          columns={[
            { key: 'class', label: 'Loại xe', rowHeader: true },
            ...ROW_LABELS.map((label, index) => ({ key: index, label, primary: true, align: 'end' as const })),
          ]}
          rows={block.cells.map((cell) => {
            const index = QUOTATION_GRID_COLUMNS.findIndex(column => column.vehicleSizeClassCode === cell.vehicleSizeClassCode);
            const title = QUOTATION_GRID_COLUMNS[index]?.label ?? cell.vehicleSizeClassCode;
            const subtitle = index < QUOTATION_TRUCK_CLASS_COUNT ? 'Hàng lẻ' : 'Hàng container';
            // K10.39 (SIL-973): the KB's missing-data voice — a price-less
            // 15T cell reads '—' + the named 'Thiếu giá 15T' label (the
            // /trips D2 chip pattern); the other classes keep the ruling-2
            // 'Thiếu giá' text. SIL-1039 (K5.18): a heavy cell whose price
            // was inherited from the light twin shows that value with the
            // 'kế thừa hạng nhẹ / giá tạm' label — never 'Thiếu giá'.
            const giaCos = !cell.missingPrice
              ? (
                <>
                  {money(cell.giaCos)}
                  {cell.giaCosInherited && (
                    <em className="quotation-grid__inherited">kế thừa hạng nhẹ / giá tạm</em>
                  )}
                </>
              )
              : cell.vehicleSizeClassCode === '15T'
                ? (<><span>—</span> <em>Thiếu giá 15T</em></>)
                : 'Thiếu giá';
            return {
              key: cellKey(cell), title, subtitle,
              cells: [
                <div><span className="data-token">{title}</span><div className="row-meta">{subtitle}</div></div>,
                coefficient(cell),
                <span className="data-token">{fmtLiters(cell.liters)}</span>,
                giaCos,
                money(cell.surcharge), money(cell.total),
              ],
              cellClassNames: [undefined, undefined, undefined, cell.missingPrice ? 'is-missing' : undefined],
            };
          })}
        />
    </section>
  );
}
