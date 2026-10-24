/**
 * Tab Rate Engine (SIL-161, spec PHÂN HỆ 4.3): hai ma trận editable —
 * (a) phí Nâng/Hạ tại cảng/bãi: hàng = cảng, cột = [20′/40′ × Xuất/Nhập ×
 *     Nâng/Hạ]; (b) giá cước vận chuyển: khách hàng × tuyến × cỡ cont.
 * Hover (hoặc focus bàn phím) tô sáng chéo hàng + cột; nhấp vào ô để sửa —
 * commit (Enter/blur) lưu vào state fixtures của phiên demo.
 */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/untitled-ui/base/badges/badges';
import {
  DEMO_PORT_RATE_COLUMNS,
  demoCustomers,
  demoFreightRates,
  demoPortRateMatrix,
  demoPorts,
  portRateCellKey,
  type DemoCargoFlow,
  type DemoContainerSize,
  type DemoPortRateCellKey,
} from '../data';
import { EditableMoneyCell } from './EditableMoneyCell';

/** Trạng thái tô sáng chéo: hàng nào + cột nào đang được trỏ tới. */
interface Crosshair {
  rowIndex: number;
  colKey: string;
}

const BAND_CELL = 'bg-brand-50';
const FOCUS_CELL = 'bg-brand-100';

function cellHighlight(hover: Crosshair | null, rowIndex: number, colKey: string): string {
  if (!hover) return '';
  const row = hover.rowIndex === rowIndex;
  const col = hover.colKey === colKey;
  if (row && col) return FOCUS_CELL;
  if (row || col) return BAND_CELL;
  return '';
}

const FLOW_TEXT: Record<DemoCargoFlow, string> = { export: 'Xuất', import: 'Nhập' };

/** Ma trận (a): phí nâng/hạ theo cảng × [cỡ × xuất/nhập × nâng/hạ]. */
function PortFeeMatrix() {
  const [rates, setRates] = useState(demoPortRateMatrix);
  const [hover, setHover] = useState<Crosshair | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const commit = (portId: string, key: DemoPortRateCellKey, next: number) => {
    setRates((current) =>
      current.map((row) =>
        row.portId === portId ? { ...row, rates: { ...row.rates, [key]: next } } : row,
      ),
    );
    const port = demoPorts.find((entry) => entry.id === portId);
    const column = DEMO_PORT_RATE_COLUMNS.find((entry) => entry.key === key);
    setLastSaved(
      `${port?.name ?? portId} — ${column?.groupLabel ?? key} · ${column?.operationLabel ?? ''}: ${next.toLocaleString('vi-VN')} ₫`,
    );
  };

  return (
    <section aria-label="Ma trận phí nâng hạ" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-md font-semibold text-primary">Ma trận phí Nâng / Hạ — Cảng · Bãi</h3>
        <p className="text-sm text-tertiary">
          Hàng = cảng/bãi · cột = cỡ cont × loại hình × thao tác. Đơn vị VND.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
        <table
          className="w-full min-w-[960px] border-collapse text-left"
          data-testid="rate-matrix-ports"
          onMouseLeave={() => setHover(null)}
        >
          <thead>
            <tr className="border-b border-secondary_alt bg-secondary text-tertiary">
              <th rowSpan={3} className="px-4 py-2 align-middle">Cảng / Bãi</th>
              <th colSpan={4} className="border-l border-secondary_alt px-4 py-2 text-center">Cont 20′</th>
              <th colSpan={4} className="border-l border-secondary_alt px-4 py-2 text-center">Cont 40′</th>
            </tr>
            <tr className="border-b border-secondary_alt bg-secondary text-tertiary">
              {[20, 40].map((size) => (
                (['export', 'import'] as const).map((flow) => (
                  <th
                    key={`${size}-${flow}`}
                    colSpan={2}
                    className={`px-4 py-2 text-center ${flow === 'import' ? 'border-l border-secondary_alt' : size === 40 && flow === 'export' ? 'border-l border-secondary_alt' : ''}`}
                  >
                    {size}′ · {FLOW_TEXT[flow]}
                  </th>
                ))
              ))}
            </tr>
            <tr className="border-b border-secondary_alt bg-secondary text-tertiary">
              {[20, 40].map((size) => (
                (['export', 'import'] as const).map((flow) => (
                  (['lift', 'drop'] as const).map((operation) => (
                    <th
                      key={portRateCellKey(size as DemoContainerSize, flow, operation)}
                      className={`px-3 py-1.5 text-center text-xs font-medium ${operation === 'drop' || (size === 40 && flow === 'export' && operation === 'lift') ? 'border-l border-secondary_alt' : ''}`}
                    >
                      {operation === 'lift' ? 'Nâng' : 'Hạ'}
                    </th>
                  ))
                ))
              ))}
            </tr>
          </thead>
          <tbody>
            {rates.map((row, rowIndex) => {
              const port = demoPorts.find((entry) => entry.id === row.portId);
              return (
                <tr key={row.portId} className="border-b border-secondary_alt last:border-b-0">
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-semibold text-primary">
                        <span className="tabular-nums">{port?.code}</span> · {port?.name}
                      </span>
                      <span className="text-xs text-tertiary">{port?.area}</span>
                    </div>
                  </td>
                  {DEMO_PORT_RATE_COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={`px-2 py-1 ${column.key.endsWith('-drop') || column.key === '40-export-lift' ? 'border-l border-secondary_alt' : ''} ${cellHighlight(hover, rowIndex, column.key)}`}
                      onMouseEnter={() => setHover({ rowIndex, colKey: column.key })}
                    >
                      <EditableMoneyCell
                        value={row.rates[column.key]}
                        onCommit={(next) => commit(row.portId, column.key, next)}
                        label={`${port?.name ?? row.portId} — ${column.groupLabel} — ${column.operationLabel}`}
                        testId={`rate-cell-${row.portId}-${column.key}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-quaternary" aria-live="polite" data-testid="rate-save-live">
        {lastSaved ? `Đã lưu — ${lastSaved}` : 'Nhấp vào ô phí để sửa — lưu vào dữ liệu demo của phiên.'}
      </p>
    </section>
  );
}

/** Ma trận (b): giá cước khách hàng × tuyến × cỡ cont. */
function FreightRateMatrix() {
  const [rates, setRates] = useState(demoFreightRates);
  const [hover, setHover] = useState<Crosshair | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const customerById = useMemo(
    () => new Map(demoCustomers.map((customer) => [customer.id, customer])),
    [],
  );

  const commit = (rowId: string, size: DemoContainerSize, next: number) => {
    setRates((current) =>
      current.map((row) =>
        row.id === rowId
          ? size === 20 ? { ...row, rate20Vnd: next } : { ...row, rate40Vnd: next }
          : row,
      ),
    );
    const row = rates.find((entry) => entry.id === rowId);
    const customer = customerById.get(row?.customerId ?? '');
    setLastSaved(`${customer?.name ?? rowId} — ${row?.route ?? ''} — ${size}′: ${next.toLocaleString('vi-VN')} ₫`);
  };

  return (
    <section aria-label="Ma trận giá cước vận chuyển" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-md font-semibold text-primary">Ma trận giá cước vận chuyển</h3>
        <p className="text-sm text-tertiary">Khách hàng × tuyến × cỡ cont. Đơn vị VND.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
        <table
          className="w-full min-w-[720px] border-collapse text-left"
          data-testid="rate-matrix-freight"
          onMouseLeave={() => setHover(null)}
        >
          <thead>
            <tr className="border-b border-secondary_alt bg-secondary text-tertiary">
              <th className="px-4 py-2.5">Khách hàng</th>
              <th className="px-4 py-2.5">Tuyến</th>
              <th className="w-40 border-l border-secondary_alt px-4 py-2.5 text-right">Cont 20′</th>
              <th className="w-40 border-l border-secondary_alt px-4 py-2.5 text-right">Cont 40′</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((row, rowIndex) => {
              const customer = customerById.get(row.customerId);
              return (
                <tr key={row.id} className="border-b border-secondary_alt last:border-b-0">
                  <td
                    className={`px-4 py-2.5 ${cellHighlight(hover, rowIndex, 'customer')}`}
                    onMouseEnter={() => setHover({ rowIndex, colKey: 'customer' })}
                  >
                    <div className="flex items-center gap-2">
                      <Badge type="pill-color" color="brand" size="sm">{customer?.code ?? row.customerId}</Badge>
                      <span className="font-semibold text-primary">{customer?.name ?? row.customerId}</span>
                    </div>
                  </td>
                  <td
                    className={`px-4 py-2.5 text-secondary ${cellHighlight(hover, rowIndex, 'route')}`}
                    onMouseEnter={() => setHover({ rowIndex, colKey: 'route' })}
                  >
                    {row.route}
                  </td>
                  {([20, 40] as const).map((size) => (
                    <td
                      key={size}
                      className={`border-l border-secondary_alt px-2 py-1 ${cellHighlight(hover, rowIndex, `rate-${size}`)}`}
                      onMouseEnter={() => setHover({ rowIndex, colKey: `rate-${size}` })}
                    >
                      <EditableMoneyCell
                        value={size === 20 ? row.rate20Vnd : row.rate40Vnd}
                        onCommit={(next) => commit(row.id, size, next)}
                        label={`${customer?.name ?? row.customerId} — ${row.route} — ${size}′`}
                        testId={`freight-cell-${row.id}-${size}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-quaternary" aria-live="polite" data-testid="freight-save-live">
        {lastSaved ? `Đã lưu — ${lastSaved}` : 'Nhấp vào ô giá cước để sửa — lưu vào dữ liệu demo của phiên.'}
      </p>
    </section>
  );
}

export function RateEngineTab() {
  return (
    <div className="flex flex-col gap-8">
      <PortFeeMatrix />
      <FreightRateMatrix />
    </div>
  );
}
