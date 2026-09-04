import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Upload, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/UI';
import { TextField } from '../../design-system';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import {
  analyzeMasterData,
  applyMasterData,
  rejectMasterData,
  type MasterImportBatch,
  type MasterImportClassification,
} from '../../api/masterDataImportClient';

const classificationLabels: Record<MasterImportClassification, string> = {
  ACCEPTED: 'Hợp lệ', BLOCKED: 'Cần sửa', TEMPLATE: 'Dòng mẫu', EXAMPLE: 'Ví dụ',
};

const classificationColors: Record<MasterImportClassification, string> = {
  ACCEPTED: '#047857', BLOCKED: '#b91c1c', TEMPLATE: '#475569', EXAMPLE: '#475569',
};

export default function MasterDataImportPage() {
  const navigate = useNavigate();
  const [legacyFile, setLegacyFile] = useState<File | null>(null);
  const [dataFormFile, setDataFormFile] = useState<File | null>(null);
  const [userRoleFile, setUserRoleFile] = useState<File | null>(null);
  const hasAnyFile = Boolean(legacyFile || dataFormFile || userRoleFile);
  const [batch, setBatch] = useState<MasterImportBatch | null>(null);
  const [busy, setBusy] = useState<'ANALYZE' | 'APPLY' | 'REJECT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const blockedCount = batch?.summary.BLOCKED ?? batch?.rows.filter((row) => row.classification === 'BLOCKED').length ?? 0;
  // The preview rows are an in-memory batch result (never paginated), so each
  // sheet's table sorts client-side under one shared sort state — every sheet
  // orders by the same clicked column, empty cells last, row id tiebreaker.
  const groups = useMemo(() => {
    if (!batch) return [];
    const sorted = sortClientSide(batch.rows, sort, {
      rowNumber: (row) => row.rowNumber,
      entityType: (row) => row.entityType,
      classification: (row) => classificationLabels[row.classification],
      reason: (row) => row.redactedReason,
    }, (a, b) => a.rowNumber - b.rowNumber);
    const grouped = new Map<string, typeof batch.rows>();
    for (const row of sorted) grouped.set(row.sheetName, [...(grouped.get(row.sheetName) ?? []), row]);
    return [...grouped.entries()];
  }, [batch, sort]);
  const applySort = (key: string) => setSort((current) => nextTableSort(current, key));

  async function analyze() {
    if (!hasAnyFile) { setError('Vui lòng chọn ít nhất một tệp Excel (.xlsx)'); return; }
    setBusy('ANALYZE'); setError(null);
    try {
      setBatch((await analyzeMasterData({
        file: legacyFile ?? undefined,
        dataForm: dataFormFile ?? undefined,
        userRole: userRoleFile ?? undefined,
      })).batch);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể kiểm tra tệp dữ liệu'); }
    finally { setBusy(null); }
  }

  async function apply() {
    if (!batch || blockedCount > 0) return;
    setBusy('APPLY'); setError(null);
    try { setBatch((await applyMasterData(batch)).batch); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể áp dụng dữ liệu'); }
    finally { setBusy(null); }
  }

  async function reject() {
    if (!batch) return;
    if (!rejectReason.trim()) { setError('Vui lòng nhập lý do từ chối đợt dữ liệu'); return; }
    if (!window.confirm('Từ chối đợt nhập này? Dữ liệu danh mục sẽ không được cập nhật.')) return;
    setBusy('REJECT'); setError(null);
    try { setBatch((await rejectMasterData(batch, rejectReason.trim())).batch); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể từ chối đợt nhập'); }
    finally { setBusy(null); }
  }

  function downloadRedactedReport() {
    if (!batch) return;
    const escapeCell = (value: string | number | null | undefined) => {
      const text = String(value ?? '');
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      ['Sheet', 'Dòng', 'Nhóm dữ liệu', 'Kết quả', 'Lý do đã ẩn dữ liệu nhạy cảm'],
      ...batch.rows.map((row) => [
        row.sheetName,
        row.rowNumber,
        row.entityType,
        classificationLabels[row.classification],
        row.redactedReason ?? '',
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bao-cao-du-lieu-nen-tang-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', minWidth: 0 }}>
      <button type="button" onClick={() => navigate('/config')} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'none', color: 'var(--fg-2)', cursor: 'pointer' }}><ArrowLeft size={18} />Quay lại cấu hình</button>
      <PageHeader title="Nạp dữ liệu nền tảng" iconName="settings" description="Kiểm tra trước, xử lý các dòng chưa hợp lệ, rồi mới cập nhật danh mục hệ thống." />

      <section style={{ border: '1px solid var(--border-2)', borderRadius: 10, padding: 18, display: 'grid', gap: 14, background: 'var(--surface-1)' }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="master-data-file-form" style={{ fontWeight: 700 }}>Data form.xlsx (khách hàng, nhà máy, tuyến, cảng, xe)</label>
          <input id="master-data-file-form" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={(event) => { setDataFormFile(event.target.files?.[0] ?? null); setBatch(null); setError(null); }} style={{ minHeight: 44, width: '100%', border: '1px solid var(--border-2)', borderRadius: 8, padding: 8 }} />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="master-data-file-role" style={{ fontWeight: 700 }}>User & Role.xlsx (nhân sự, tài xế)</label>
          <input id="master-data-file-role" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={(event) => { setUserRoleFile(event.target.files?.[0] ?? null); setBatch(null); setError(null); }} style={{ minHeight: 44, width: '100%', border: '1px solid var(--border-2)', borderRadius: 8, padding: 8 }} />
        </div>
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--fg-3)', fontSize: 14 }}>Tệp Master Data cũ (một tệp duy nhất)</summary>
          <input id="master-data-file-legacy" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={(event) => { setLegacyFile(event.target.files?.[0] ?? null); setBatch(null); setError(null); }} style={{ minHeight: 44, width: '100%', border: '1px solid var(--border-2)', borderRadius: 8, padding: 8, marginTop: 8 }} />
        </details>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void analyze()} disabled={!hasAnyFile || Boolean(busy)} style={{ minHeight: 44, padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 8, background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}><Upload size={17} />{busy === 'ANALYZE' ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu'}</button>
          {batch && <span style={{ alignSelf: 'center', color: 'var(--fg-3)', fontSize: 14 }}><FileSpreadsheet size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />{batch.sourceFileName}</span>}
        </div>
      </section>

      {error && <div role="alert" style={{ marginTop: 14, padding: 12, borderRadius: 8, background: 'var(--danger-bg, #fef2f2)', color: 'var(--danger)' }}>{error}</div>}

      {batch && (
        <section style={{ marginTop: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10 }}>
            {(['ACCEPTED', 'BLOCKED', 'TEMPLATE', 'EXAMPLE'] as const).map((classification) => {
              const count = batch.summary[classification] ?? batch.rows.filter((row) => row.classification === classification).length;
              return <div key={classification} style={{ border: '1px solid var(--border-2)', borderRadius: 8, padding: 14, background: 'var(--surface-1)' }}><div style={{ color: 'var(--fg-3)', fontSize: 13 }}>{classificationLabels[classification]}</div><strong style={{ color: classificationColors[classification], fontSize: 24 }}>{count}</strong></div>;
            })}
          </div>

          <div>
            <button type="button" onClick={downloadRedactedReport} style={{ minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-1)', color: 'var(--fg-2)', fontWeight: 700 }}>
              <Download size={17} /> Tải báo cáo lỗi đã ẩn dữ liệu nhạy cảm
            </button>
          </div>

          {blockedCount > 0 && <div style={{ padding: 14, borderLeft: '4px solid #b91c1c', background: '#fef2f2', color: '#991b1b' }}>Có {blockedCount} dòng cần sửa. Hãy sửa tệp nguồn và tải lại; hệ thống sẽ không áp dụng một phần dữ liệu chưa rõ.</div>}
          {batch.status === 'APPLIED' && <div style={{ padding: 14, borderLeft: '4px solid #047857', background: '#ecfdf5', color: '#065f46' }}><CheckCircle2 size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Đã cập nhật danh mục thành công.</div>}
          {batch.status === 'REJECTED' && <div style={{ padding: 14, borderLeft: '4px solid #475569', background: '#f8fafc', color: '#334155' }}>Đợt nhập đã bị từ chối; không có dữ liệu nào được áp dụng.</div>}

          <div style={{ border: '1px solid var(--border-2)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-1)' }}>
            {groups.map(([sheetName, rows]) => (
              <details key={sheetName} open={rows.some((row) => row.classification === 'BLOCKED')} style={{ borderBottom: '1px solid var(--border-2)' }}>
                <summary style={{ minHeight: 48, padding: '12px 14px', cursor: 'pointer', fontWeight: 700 }}>{sheetName} · {rows.length} dòng</summary>
                <div style={{ overflowX: 'auto' }}>
                  <div className="record-table-wrap">
                    <table className="record-table ops-table">
                      <thead>
                        <tr>
                          <SortHeader label="Dòng" sortKey="rowNumber" sort={sort} onSortChange={applySort} />
                          <SortHeader label="Nhóm dữ liệu" sortKey="entityType" sort={sort} onSortChange={applySort} />
                          <SortHeader label="Kết quả" sortKey="classification" sort={sort} onSortChange={applySort} />
                          <SortHeader label="Lý do" sortKey="reason" sort={sort} onSortChange={applySort} />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td data-label="Dòng">{row.rowNumber}</td>
                            <td data-label="Nhóm dữ liệu">{row.entityType}</td>
                            <td data-label="Kết quả" style={{ color: classificationColors[row.classification], fontWeight: 700 }}>{classificationLabels[row.classification]}</td>
                            <td data-label="Lý do">{row.redactedReason ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>

          {batch.status === 'ANALYZED' && <>
          <TextField label="Lý do từ chối" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Nhập lý do khi không sử dụng đợt dữ liệu này" maxLength={2000} disabled={Boolean(busy)} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10 }}>
            <button type="button" onClick={() => { setBatch(null); setLegacyFile(null); setDataFormFile(null); setUserRoleFile(null); }} disabled={Boolean(busy)} style={{ minHeight: 48, border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-1)', fontWeight: 700 }}><RotateCcw size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />Chọn tệp đã sửa</button>
            <button type="button" onClick={() => void reject()} disabled={Boolean(busy)} style={{ minHeight: 48, border: '1px solid var(--danger)', borderRadius: 8, background: 'var(--surface-1)', color: 'var(--danger)', fontWeight: 700 }}><XCircle size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />{busy === 'REJECT' ? 'Đang từ chối…' : 'Từ chối đợt nhập'}</button>
            <button type="button" onClick={() => void apply()} disabled={Boolean(busy) || blockedCount > 0} title={blockedCount > 0 ? 'Cần sửa tất cả dòng chưa hợp lệ trước khi áp dụng' : undefined} style={{ minHeight: 48, border: 0, borderRadius: 8, background: blockedCount > 0 ? 'var(--fg-3)' : '#047857', color: '#fff', fontWeight: 700 }}><CheckCircle2 size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />{busy === 'APPLY' ? 'Đang áp dụng…' : 'Áp dụng dữ liệu hợp lệ'}</button>
          </div></>}
        </section>
      )}
    </div>
  );
}
