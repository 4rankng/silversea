import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/UI';
import { EmptyState, UuiSelectField } from '../../design-system';
import { Alert } from '../../components/shared/Alert';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { ListFilterBar } from '../../components/ListFilterBar';
import {
  type QuotationFeeInput,
  type QuotationView,
} from '@tingting/shared';
import { useQuotation, useQuotations, useUpdateQuotation } from '../../hooks/useQuotationQueries';
import { qk } from '../../api/keys';
import { quotationClient, triggerKindLabel, type ImportPreviewPayload } from '../../api/quotationClient';
import { formatCurrency, formatDate } from '../../lib/format';
import { RouteBlock, fmtLiters, type RouteBlockData } from './QuotationRouteBlock';
import { QuotationImportPreview } from './QuotationImportPreview';
import { QuotationFeesSection } from './QuotationFeesSection';
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


export default function QuotationConfigPage() {
  // Card 20260922_57: xlsx import (preview → commit) + export.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<ImportPreviewPayload | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [versionFilterFrom, setVersionFilterFrom] = useState('');
  const [versionFilterTo, setVersionFilterTo] = useState('');
  const [viewingVersion, setViewingVersion] = useState<{ version: number; payload: QuotationView | null } | null>(null);
  // Card _62: version history for the selected quotation (newest first).
  const versionsQuery = useQuery({
    queryKey: qk.catalogs.quotationVersions(selectedId!, versionFilterFrom || undefined, versionFilterTo || undefined),
    queryFn: () => quotationClient.listVersions(selectedId!, {
      from: versionFilterFrom || undefined,
      to: versionFilterTo || undefined,
    }),
    enabled: selectedId != null,
  });

  const handleViewVersion = async (version: number) => {
    const payload = await quotationClient.getVersionPayload(selectedId!, version);
    setViewingVersion({ version, payload });
  };

  const handleExportVersion = async (version: number) => {
    try {
      const blob = await quotationClient.exportVersion(selectedId!, version);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bao-gia-${selectedId}-phien-ban-${version}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Không xuất được phiên bản.');
    }
  };


  const handleImportFile = async (file: File) => {
    setImportFile(file); setImportError(null); setImporting(true);
    try { setImportPreviewData(await quotationClient.importPreview(file)); }
    catch (error) { setImportError(error instanceof Error ? error.message : 'Không đọc được tệp.'); }
    finally { setImporting(false); }
  };

  const handleImportCommit = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const { results } = await quotationClient.importCommit(importFile);
      const failed = results.filter((entry) => entry.errors.length > 0);
      if (failed.length > 0) setImportError(failed.flatMap((entry) => entry.errors).join(' · '));
      else {
        setImportPreviewData(null); setImportFile(null);
        if (importInputRef.current) importInputRef.current.value = '';
      }
      await frames.refetch();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Không ghi nhận được tệp.');
    } finally { setImporting(false); }
  };

  const handleExport = async (quotationId: number) => {
    try {
      const blob = await quotationClient.exportQuotation(quotationId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bao-gia-${quotationId}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Không xuất được tệp.');
    }
  };

  const frames = useQuotations();
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

  // Every save path sends the FULL schema-clean payload: the update is
  // replace-all on both cells and fees, and the .strict() schema rejects the
  // view-only `id` field — with fees present, an id-carrying payload 400s.
  function schemaCleanFees(fees: QuotationView['fees']): QuotationFeeInput[] {
    return fees.map(({ id: _droppedViewId, ...rest }) => rest);
  }

  function saveHeSo(cells: Array<{ routeId: number; vehicleSizeClassCode: string; heSo: number }>) {
    update.mutate({
      id: selectedId!,
      body: {
        templateName: detail.data!.templateName,
        effectiveDate: detail.data!.effectiveDate,
        surchargeRoundingMode: detail.data!.surchargeRoundingMode,
        note: detail.data!.note,
        cells,
        fees: schemaCleanFees(detail.data!.fees),
      },
    });
  }

  function saveFees(fees: QuotationFeeInput[]) {
    update.mutate({
      id: selectedId!,
      body: {
        templateName: detail.data!.templateName,
        effectiveDate: detail.data!.effectiveDate,
        surchargeRoundingMode: detail.data!.surchargeRoundingMode,
        note: detail.data!.note,
        cells: detail.data!.cells.map((cell) => ({
          routeId: cell.routeId,
          vehicleSizeClassCode: cell.vehicleSizeClassCode,
          heSo: cell.heSo,
        })),
        fees,
      },
    });
  }

  return (
    <div className="quotation-page">
      <PageHeader title="Báo giá" description="Lưới giá theo khách hàng — mẫu báo giá 1" />
      {frames.isError && <Alert variant="error" style="soft">{String(frames.error)}</Alert>}

      <ListFilterBar
        actions={(
          <>
          <label className="btn btn--secondary" style={{ cursor: 'pointer' }}>
            Nhập xlsx
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportFile(file);
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={selectedId == null}
            title={selectedId == null ? 'Chọn một khung báo giá để xuất xlsx' : undefined}
            onClick={() => selectedId != null && void handleExport(selectedId)}
          >
            Xuất xlsx
          </button>
          <a className="btn btn--primary" href="#/config/quotations/new" onClick={(event) => event.preventDefault()} title="Thẻ _56 — chưa trong phạm vi thẻ _57">
            ＋ Tạo báo giá
          </a>
          </>
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

      {importError && <Alert variant="error" style="soft">{importError}</Alert>}
      {importPreviewData && (
        <QuotationImportPreview
          preview={importPreviewData}
          committing={importing}
          onCommit={() => void handleImportCommit()}
          onCancel={() => {
            setImportPreviewData(null);
            setImportFile(null);
            setImportError(null);
            if (importInputRef.current) importInputRef.current.value = '';
          }}
        />
      )}
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

      {selectedId != null && detail.data && (
        <QuotationFeesSection
          fees={detail.data.fees}
          saving={update.isPending}
          onSaveFees={saveFees}
        />
      )}

      {selectedId != null && (
        <section className="quotation-versions" aria-label="Lịch sử phiên bản báo giá">
          <h3>Lịch sử phiên bản</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <BufferedUuiDateInput label="Từ ngày (phiên bản)" size="sm" value={versionFilterFrom} onChange={setVersionFilterFrom} />
            <BufferedUuiDateInput label="Đến ngày (phiên bản)" size="sm" value={versionFilterTo} onChange={setVersionFilterTo} />
          </div>
          {versionsQuery.isLoading && <p className="quotation-status">Đang tải phiên bản…</p>}
          {versionsQuery.data && versionsQuery.data.items.length === 0 && (
            <p className="quotation-status">Chưa có phiên bản nào được ghi nhận.</p>
          )}
          <table className="tt-table" style={{ width: '100%', maxWidth: 720 }}>
            <thead>
              <tr>
                <th scope="col">Phiên bản</th>
                <th scope="col">Thao tác</th>
                <th scope="col">Thời điểm</th>
                <th scope="col"><span className="sr-only">Xem / xuất</span></th>
              </tr>
            </thead>
            <tbody>
              {(versionsQuery.data?.items ?? []).map((row) => (
                <tr key={row.version}>
                  <td>Phiên bản {row.version}</td>
                  <td>{triggerKindLabel(row.triggerKind)}</td>
                  <td>{row.releasedAt ? formatDate(row.releasedAt.slice(0, 10)) : '—'}</td>
                  <td>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleViewVersion(row.version)}>Xem</button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleExportVersion(row.version)}>Xuất xlsx</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {viewingVersion && viewingVersion.payload && (
            <div role="group" aria-label={`Phiên bản ${viewingVersion.version} (chỉ đọc)`} style={{ marginTop: 12 }}>
              <p className="quotation-status">Phiên bản {viewingVersion.version} — chỉ đọc.</p>
              <table className="tt-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">Tuyến</th>
                    <th scope="col">Hạng</th>
                    <th scope="col">Hệ số</th>
                    <th scope="col">Lít</th>
                    <th scope="col">Giá cos</th>
                    <th scope="col">Phụ phí</th>
                  </tr>
                </thead>
                <tbody>
                          {viewingVersion.payload.cells.map((cell) => (
                    <tr key={`${cell.routeId}-${cell.vehicleSizeClassCode}`}>
                      <td>{cell.routeName}</td>
                      <td>{cell.vehicleSizeClassCode}</td>
                      <td>{cell.heSo}</td>
                      <td>{cell.liters != null ? fmtLiters(cell.liters) : '—'}</td>
                      <td>{cell.giaCos != null ? formatCurrency(cell.giaCos) : '—'}</td>
                      <td>{cell.surcharge != null ? formatCurrency(cell.surcharge) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
