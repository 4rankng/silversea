// Card 20260922_56/57 — one route block of the live quotation grid: the
// fuel-parameter strip + the 5×10 class table. Extracted from
// QuotationConfigPage (structure-guard split candidate; page pinned 440).
// D4/D5 (card _57/_62 finish-out): liters derive as km × norm × 2 — raw
// floats leak tails ("33.800000000000004") and the lít row carried the
// currency formatter ("20 đ"). Liters are not money: cap at one decimal,
// no currency suffix; the đồng formatters stay on money columns only.
import { useState } from 'react';
import { QUOTATION_GRID_COLUMNS, type QuotationCellView } from '@tingting/shared';
import { formatCurrency } from '../../lib/format';

export const ROW_LABELS = ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí', 'Tổng'] as const;

export function fmtLiters(value: number | null | undefined): string {
  return value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
}

function fmt(value: number | null | undefined): string {
  return value == null ? '—' : formatCurrency(value);
}

export interface RouteBlockData {
  routeId: number;
  routeName: string;
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
    const cells = block.cells.map((cell) => {
      const raw = drafts[cellKey(cell)];
      const parsed = raw === undefined ? NaN : Number(raw.replace(',', '.'));
      const heSo = Number.isFinite(parsed) && parsed >= 0 ? parsed : cell.heSo;
      return { routeId: cell.routeId, vehicleSizeClassCode: cell.vehicleSizeClassCode, heSo };
    });
    onSaveHeSo(cells);
  }

  return (
    <section className="quotation-route-block" data-route-id={block.routeId}>
      <div className="quotation-route-block__head">
        <h3>{block.routeName}</h3>
        <p className="quotation-route-block__params">
          Giá dầu tham chiếu {fmt(baseFuel)} đ/lít · Lag {lag ?? '—'} ngày · Làm tròn: HALF_UP từng thành phần (cố định)
        </p>
        <p className="quotation-route-block__link">
          <a href="/config/freight-rate-terms">Sửa tham số giá dầu/lag tại Bảng điều kiện giá</a>
        </p>
      </div>
      <div className="quotation-route-block__table-wrap">
        <table className="quotation-grid tt-table">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="quotation-grid__row-label">Nội dung</th>
              <th colSpan={6} scope="colgroup">HÀNG LẺ</th>
              <th colSpan={4} scope="colgroup">HÀNG CONTAINER</th>
            </tr>
            <tr>
              {QUOTATION_GRID_COLUMNS.map((column) => (
                <th scope="col" key={column.vehicleSizeClassCode}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROW_LABELS.map((label, rowIndex) => (
              <tr key={label}>
                <th scope="row" className="quotation-grid__row-label">{label}</th>
                {block.cells.map((cell, _cellIndex) => {
                  const key = cellKey(cell);
                  if (rowIndex === 0) {
                    return (
                      <td key={key}>
                        <input
                          aria-label={`Hệ số ${block.routeName} ${cell.vehicleSizeClassCode}`}
                          value={drafts[key] ?? String(cell.heSo ?? 1)}
                          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                          onBlur={commitHeSo}
                          disabled={saving}
                          inputMode="decimal"
                        />
                      </td>
                    );
                  }
                  if (rowIndex === 1) return <td key={key}>{fmtLiters(cell.liters)}</td>;
                  if (rowIndex === 2) {
                    return <td key={key} className={cell.missingPrice ? 'is-missing' : undefined}>{cell.missingPrice ? 'Thiếu giá' : fmt(cell.giaCos)}</td>;
                  }
                  if (rowIndex === 3) return <td key={key}>{fmt(cell.surcharge)}</td>;
                  return <td key={key}>{fmt(cell.total)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
