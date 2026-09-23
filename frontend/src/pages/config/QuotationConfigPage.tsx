import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/UI';
import { EmptyState, UuiSelectField } from '../../design-system';
import { Alert } from '../../components/shared/Alert';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { ListFilterBar } from '../../components/ListFilterBar';
import { QUOTATION_GRID_COLUMNS, type QuotationCellView } from '@tingting/shared';
import { useQuotation, useQuotations, useUpdateQuotation } from '../../hooks/useQuotationQueries';
import { formatCurrency } from '../../lib/format';
import './QuotationConfigPage.css';

// ─── Báo giá (card 20260922_56) — quotation live-view screen ───────────────
// Consumes card _66's landed contract: LIST returns frames; the detail route
// assembles the live grid server-side (Giá cos = J, lít, phụ phí = MAX(0,Δ)
// × lít × heSo). The quotation owns only heSo per cell — the only editable
// grid datum. Missing prices render "Thiếu giá" and drop out of row totals
// (ruling 2: never light-fallback). Layout follows the customer file: one
// block per route (its fuel-parameter strip rides the block head), rows =
// Hệ số / Tổng lít / Giá cos / Phụ phí / Tổng, columns = the 10 classes
// under HÀNG LẺ / HÀNG CONTAINER (labels from QUOTATION_GRID_COLUMNS).

const ROW_LABELS = ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí', 'Tổng'] as const;

function fmt(value: number | null | undefined): string {
  return value == null ? '—' : formatCurrency(value);
}

interface RouteBlockData {
  routeId: number;
  routeName: string;
  cells: QuotationCellView[];
}

function cellKey(cell: { routeId: number; vehicleSizeClassCode: string }): string {
  return `${cell.routeId}:${cell.vehicleSizeClassCode}`;
}

function RouteBlock({
  block,
  saving,
  onSaveHeSo,
}: {
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
                {block.cells.map((cell, cellIndex) => {
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
                  if (rowIndex === 1) return <td key={key}>{fmt(cell.liters)}</td>;
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

export default function QuotationConfigPage() {
  const frames = useQuotations();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [customer, setCustomer] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const detail = useQuotation(selectedId);
  const update = useUpdateQuotation();

  const customerOptions = useMemo(
    () => Array.from(new Set((frames.data ?? []).map((frame) => frame.customerName))).sort(),
    [frames.data],
  );

  const filteredFrames = useMemo(
    () => (frames.data ?? []).filter((frame) =>
      (!customer || frame.customerName === customer) &&
      (!dateFrom || frame.effectiveDate >= dateFrom) &&
      (!dateTo || frame.effectiveDate <= dateTo)),
    [frames.data, customer, dateFrom, dateTo],
  );

  const routeBlocks = useMemo(() => {
    const byRoute = new Map<number, RouteBlockData>();
    for (const cell of detail.data?.cells ?? []) {
      const block = byRoute.get(cell.routeId) ?? { routeId: cell.routeId, routeName: cell.routeName, cells: [] };
      block.cells.push(cell);
      byRoute.set(cell.routeId, block);
    }
    return Array.from(byRoute.values());
  }, [detail.data]);

  function saveHeSo(cells: Array<{ routeId: number; vehicleSizeClassCode: string; heSo: number }>) {
    update.mutate({
      id: selectedId!,
      body: {
        templateName: detail.data!.templateName,
        effectiveDate: detail.data!.effectiveDate,
        note: detail.data!.note,
        cells,
      },
    });
  }

  return (
    <div className="quotation-page">
      <PageHeader title="Báo giá" description="Lưới giá theo khách hàng — mẫu báo giá 1" />
      {frames.isError && <Alert variant="error" style="soft">{String(frames.error)}</Alert>}

      <ListFilterBar
        actions={(
          <a className="btn btn--primary" href="#/config/quotations/new" onClick={(event) => event.preventDefault()} title="Thẻ _57 — chưa trong phạm vi thẻ _56">
            ＋ Tạo báo giá
          </a>
        )}
      >
        <UuiSelectField
          label="Khách hàng"
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
          options={[{ value: '', label: 'Tất cả khách hàng' }, ...customerOptions.map((name) => ({ value: name, label: name }))]}
        />
        <BufferedUuiDateInput label="Từ ngày" size="sm" value={dateFrom} onChange={setDateFrom} />
        <BufferedUuiDateInput label="Đến ngày" size="sm" value={dateTo} onChange={setDateTo} />
      </ListFilterBar>

      {frames.isLoading && <p className="quotation-status">Đang tải danh sách báo giá…</p>}

      <div className="quotation-layout">
        <section className="quotation-frames" aria-label="Danh sách báo giá">
          <table className="quotation-frames__table tt-table">
            <thead>
              <tr>
                <th scope="col">Khách hàng</th>
                <th scope="col">Mẫu báo giá</th>
                <th scope="col">Ngày hiệu lực</th>
                <th scope="col">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {filteredFrames.map((frame) => (
                <tr
                  key={frame.id}
                  className={frame.id === selectedId ? 'is-selected' : undefined}
                  onClick={() => setSelectedId(frame.id)}
                >
                  <td>{frame.customerName}</td>
                  <td>{frame.templateName}</td>
                  <td>{frame.effectiveDate}</td>
                  <td>{frame.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!frames.isLoading && filteredFrames.length === 0 && (
            <EmptyState context="trips" title="Không có báo giá khớp bộ lọc." />
          )}
        </section>

        <section className="quotation-detail" aria-label="Lưới giá">
          {selectedId == null && <EmptyState context="trips" title="Chọn một báo giá để xem lưới giá." />}
          {selectedId != null && detail.isError && <Alert variant="error" style="soft">{String(detail.error)}</Alert>}
          {selectedId != null && detail.isLoading && <p className="quotation-status">Đang tải lưới giá…</p>}
          {detail.data && routeBlocks.map((block) => (
            <RouteBlock key={block.routeId} block={block} saving={update.isPending} onSaveHeSo={saveHeSo} />
          ))}
        </section>
      </div>
    </div>
  );
}
