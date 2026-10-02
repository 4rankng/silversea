// Card 20260922_56/57 — one route block of the live quotation grid: the
// fuel-parameter strip + the 5×10 class table. Extracted from
// QuotationConfigPage (structure-guard split candidate; page pinned 440).
// D4/D5 (card _57/_62 finish-out): liters derive as km × norm × 2 — raw
// floats leak tails ("33.800000000000004") and the lít row carried the
// currency formatter ("20 đ"). Liters are not money: cap at one decimal,
// no currency suffix; the đồng formatters stay on money columns only.
import { useState } from 'react';
import { QUOTATION_GRID_COLUMNS, type QuotationCellView } from '@tingting/shared';
import { Money } from '../../components/shared/Money';
import { LedgerMatrix } from '../../components/shared/LedgerMatrix';
import { TextField } from '../../design-system';

export const ROW_LABELS = ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí', 'Tổng'] as const;

export function fmtLiters(value: number | null | undefined): string {
  return value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
}

function money(value: number | null | undefined) {
  return value == null ? '—' : <Money value={value} className="data-token" />;
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
      value={drafts[key] ?? String(cell.heSo ?? 1)}
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
          Giá dầu tham chiếu {money(baseFuel)}/lít · Trễ {lag ?? '—'} ngày · Làm tròn từng khoản: từ 5 lên
        </p>
        <p className="quotation-route-block__link">
          <a href="/config/freight-rate-terms">Sửa tham số giá dầu/lag tại Bảng điều kiện giá</a>
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
            const subtitle = index < 6 ? 'Hàng lẻ' : 'Hàng container';
            return {
              key: cellKey(cell), title, subtitle,
              cells: [
                <div><span className="data-token">{title}</span><div className="row-meta">{subtitle}</div></div>,
                coefficient(cell),
                <span className="data-token">{fmtLiters(cell.liters)}</span>,
                cell.missingPrice ? 'Thiếu giá' : money(cell.giaCos),
                money(cell.surcharge), money(cell.total),
              ],
              cellClassNames: [undefined, undefined, undefined, cell.missingPrice ? 'is-missing' : undefined],
            };
          })}
        />
    </section>
  );
}
